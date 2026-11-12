"""
fit_cfb_model.py
College football's version of fit_model.py: same architecture (fit margin/
total regressions on team-efficiency diffs, validate the blend against
Vegas on held-out seasons, refit on the full dataset for production), applied
to CFBD's advanced-stats metrics (PPA, success rate, explosiveness) instead
of nflverse's play-by-play EPA.

Pulls several seasons of history using EACH season's own Power-conference
membership (see fetch_cfb_data.fetch_team_info), rather than today's
alignment, since conference realignment (USC/UCLA to the Big Ten,
Oklahoma/Texas to the SEC, the Pac-12's collapse) means "who's Power
conference" has genuinely changed year to year - filtering every season by
the current season's membership would silently drop teams from their own
historical seasons.

Run this the same way as fit_model.py (see .github/workflows/refit-model.yml),
not on every weekly picks run.
"""

import pandas as pd
import numpy as np
import json
import os
import sys
import requests
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from fetch_cfb_data import (fetch_team_info, fetch_games, fetch_lines, merge_lines, fetch_advanced_stats, current_cfb_season,
                            _headers, neutral_flags, running_week)
from historical_features import compute_walkforward_features
from build_features import RECENCY_HALF_LIFE_GAMES
import model_guard as guard
import fit_common as fc
from fit_common import fit_ols, recipe_extras, window
import cfb_context
import cfb_ratings

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

TRAIN_SEASONS_BACK = 5   # seasons of history to pull, ending at the current season

# Recipe search (see model_guard.py): team-form recency half-life (used by
# build_cfb_features.py for the live stats) and how many seasons to fit on,
# scored on the most recent RECENT_HOLDOUT_GAMES lined games (about a season).
RECENT_HOLDOUT_GAMES = 350
DEFAULT_RECIPE = {"team_half_life": RECENCY_HALF_LIFE_GAMES, "seasons": "all"}
# 2026-11-01 (Anthony: 10 versions per sport, using methods others use): four
# tryouts add one input on top of the live settings (see cfb_context.py): our
# power ratings, power ratings + rest/bye weeks, Elo, and Pythagorean record.
# 2026-11-11 (weekly swap): Pythagorean and half-life 2 on all seasons, last
# on the recent games, made way for power + bye + Elo and the live power +
# bye on the last 3 seasons.
RECIPES = ([{"team_half_life": 2, "seasons": 3}]
           + [{"team_half_life": h, "seasons": n} for h in (4, 8) for n in ("all", 3)]
           + [{"team_half_life": RECENCY_HALF_LIFE_GAMES, "seasons": "all", "extras": extras}
              for extras in (["power"], ["power", "bye"], ["elo"], ["power", "bye", "elo"])]
           + [{"team_half_life": RECENCY_HALF_LIFE_GAMES, "seasons": 3, "extras": ["power", "bye"]}])
COEFFICIENTS_PATH = os.path.join(MODELS_DIR, "fitted_cfb_coefficients.json")
EXTRA_FEATURES = cfb_context.COLUMNS

def recipe_name(r):
    return fc.recipe_name(r, f"half-life {r['team_half_life']} games")

METRICS = ["off_ppa_per_play", "off_success_rate", "off_explosiveness",
           "def_ppa_per_play_allowed", "def_success_rate_allowed", "def_explosiveness_allowed"]

def fetch_historical(seasons):
    all_games, all_stats = [], []
    for season in seasons:
        print(f"  Fetching {season}...")
        teams = fetch_team_info(season)
        covered = set(teams["team"]) if not teams.empty else set()

        games = fetch_games(season)
        if not games.empty and covered:
            games = games[games["home_team"].isin(covered) | games["away_team"].isin(covered)]
        games = merge_lines(games, fetch_lines(season))
        if not games.empty:
            all_games.append(games)

        stats = fetch_advanced_stats(season)
        if not stats.empty and covered:
            stats = stats[stats["team"].isin(covered)]
        if not stats.empty:
            all_stats.append(stats)

    games = pd.concat(all_games, ignore_index=True) if all_games else pd.DataFrame()
    stats = pd.concat(all_stats, ignore_index=True) if all_stats else pd.DataFrame()
    # Postseason weeks restart at 1: shift them past the regular season so the
    # walk-forward features sort bowls last and the (season, week, team) joins
    # below don't match a bowl to week 1.
    if not games.empty:
        games["week"] = running_week(games)
    if not stats.empty:
        stats["week"] = running_week(stats)
    return games, stats

def build_dataset(stats_walk, games):
    cols = ["season", "week", "team"] + [f"{c}_asof" for c in METRICS]
    stats = stats_walk[cols]

    games = games[games["home_score"].notna() & games["away_score"].notna()].copy()
    games = games[games["vegas_home_favored_by"].notna() & games["vegas_total"].notna()]

    games = fc.merge_side(games, stats, "home")
    games = fc.merge_side(games, stats, "away")

    games["actual_margin"] = games["home_score"] - games["away_score"]
    games["actual_total"] = games["home_score"] + games["away_score"]
    games["home_won"] = (games["actual_margin"] > 0).astype(float)
    # CFBD closing lines don't reliably carry a moneyline the way nflverse's
    # games.csv does for the NFL side - approximate the market's implied
    # win probability from its own spread via the same normal-distribution
    # conversion the model itself uses (a standard, well-documented approx).
    from scipy.stats import norm
    games["vegas_home_win_prob"] = norm.cdf(games["vegas_home_favored_by"] / 13.5)

    return games

def make_features(games, suffix="_asof"):
    home_off = games[f"home_off_ppa_per_play{suffix}"]
    away_def = games[f"away_def_ppa_per_play_allowed{suffix}"]
    away_off = games[f"away_off_ppa_per_play{suffix}"]
    home_def = games[f"home_def_ppa_per_play_allowed{suffix}"]

    home_exp_eff = (home_off + away_def) / 2
    away_exp_eff = (away_off + home_def) / 2

    feats = pd.DataFrame({
        "ppa_diff": home_exp_eff - away_exp_eff,
        "success_rate_diff": games[f"home_off_success_rate{suffix}"] - games[f"away_off_success_rate{suffix}"],
        "explosiveness_diff": games[f"home_off_explosiveness{suffix}"] - games[f"away_off_explosiveness{suffix}"],
    })
    feats["combined_exp_eff"] = home_exp_eff + away_exp_eff
    # 1 for a true home game, 0 at a neutral site (bowls, kickoff classics).
    feats["home_field"] = (~neutral_flags(games)).astype(float).values
    # Context inputs only exist on a recipe's dataset when the recipe uses them.
    for col in EXTRA_FEATURES:
        if col in games.columns:
            feats[col] = games[col].values
    return feats

def extra_columns(feats):
    return [c for c in EXTRA_FEATURES if c in feats.columns]

def fit_margin_and_total(feats, games):
    valid = feats.notna().all(axis=1) & games["actual_margin"].notna() & games["actual_total"].notna()
    feats, games = feats[valid], games[valid]

    n = len(feats)
    ones = np.ones(n)

    extras = extra_columns(feats)
    X_margin = np.column_stack([feats["ppa_diff"], feats["success_rate_diff"], feats["explosiveness_diff"]]
                               + [feats[c] for c in extras] + [feats["home_field"]])
    beta_margin, resid_margin = fit_ols(X_margin, games["actual_margin"].values)

    X_total = np.column_stack([feats["combined_exp_eff"], ones])
    beta_total, resid_total = fit_ols(X_total, games["actual_total"].values)

    return {
        "ppa_diff_coef": float(beta_margin[0]),
        "success_rate_weight": float(beta_margin[1]),
        "explosiveness_weight": float(beta_margin[2]),
        **{f"{c}_weight": float(b) for c, b in zip(extras, beta_margin[3:-1])},
        "home_field_advantage": float(beta_margin[-1]),
        "margin_std_dev": float(np.std(resid_margin, ddof=X_margin.shape[1])),
        "total_coef": float(beta_total[0]),
        "total_intercept": float(beta_total[1]),
        "total_std_dev": float(np.std(resid_total, ddof=X_total.shape[1])),
        "n_games": int(n),
    }

def model_predict(feats, coefs):
    spread = (
        feats["ppa_diff"] * coefs["ppa_diff_coef"]
        + feats["success_rate_diff"] * coefs["success_rate_weight"]
        + feats["explosiveness_diff"] * coefs["explosiveness_weight"]
        + coefs["home_field_advantage"] * feats["home_field"]
    )
    for col in EXTRA_FEATURES:
        if f"{col}_weight" in coefs:
            spread = spread + feats[col] * coefs[f"{col}_weight"]
    total = feats["combined_exp_eff"] * coefs["total_coef"] + coefs["total_intercept"]
    return spread, total

def validate_and_fit(dataset):
    """Fit on all but the last VALIDATION_SEASONS seasons, pick blend weights
    on those held-out seasons, then refit on everything (fit_common.py)."""
    return fc.validate_and_fit(dataset, make_features, fit_margin_and_total, model_predict)

def skip(reason):
    """Logs a refit the data source stopped (model_guard.log_skip) and returns;
    the workflow step still passes."""
    print(f"{reason} - keeping the live CFB model.")
    guard.log_skip("cfb", reason, guard.load_json(COEFFICIENTS_PATH))

def run():
    if _headers() is None:
        print("Get a free key at https://collegefootballdata.com/key and add it as a repo secret.")
        return skip("skipped: CFBD_API_KEY not set")

    current_season = current_cfb_season()
    seasons = list(range(current_season - TRAIN_SEASONS_BACK, current_season + 1))
    print(f"Fetching {len(seasons)} seasons of CFB data ({seasons[0]}-{seasons[-1]})...")
    games, stats = fetch_historical(seasons)
    if games.empty or stats.empty:
        return skip("skipped: CFBD returned no games or advanced stats")
    print(f"  {len(games)} games, {len(stats)} team-game stat rows")

    datasets = {}
    context = {}

    def context_for(kind):
        """One extra input (cfb_context.py) for every game id, built once.
        Loads CFBD's full game lists from a season earlier, so week 1 has a
        preseason rating and Elo has a season to settle."""
        if "games" not in context:
            years = range(seasons[0] - 1, current_season + 1)
            context["games"] = pd.concat([cfb_ratings.season_games(y) for y in years], ignore_index=True)
            context["fbs"] = {y: set(cfb_ratings.fbs_teams(y)["team"]) for y in years}
        if kind not in context:
            all_games, fbs = context["games"], context["fbs"]
            print(f"  Building the {kind} input...")
            if kind == "bye":
                context[kind] = cfb_context.rest_features(all_games)
            elif kind == "pyth":
                context[kind] = cfb_context.pyth_features(all_games)
            elif kind == "elo":
                context[kind], context["elo_start"] = cfb_context.elo_walk(all_games, set().union(*fbs.values()))
            elif kind == "power":
                eff = {}
                for y in fbs:
                    eff.update(cfb_ratings.season_efficiency(y))
                returning = {y: cfb_ratings.team_values("/player/returning", y, "team", ("percentPPA", "percent_ppa"))
                             for y in seasons}
                talent = {y: cfb_ratings.team_values("/talent", y, "team", ("talent",)) for y in seasons}
                context[kind] = cfb_context.power_features(all_games, seasons, fbs, eff, returning, talent)
        return context[kind]

    def dataset_for(recipe):
        """Completed lined games with walk-forward (no-leakage) features at
        this recipe's half-life, plus its extra inputs."""
        hl = recipe["team_half_life"]
        if hl not in datasets:
            datasets[hl] = build_dataset(compute_walkforward_features(stats, METRICS, half_life=hl), games)
        extras = recipe_extras(recipe)
        if not extras:
            return datasets[hl]
        full = (hl,) + tuple(extras)
        if full not in datasets:
            d = datasets[hl]
            for kind in extras:
                d = d.merge(context_for(kind).drop_duplicates("id"), on="id", how="left")
            # A game CFBD's full list somehow lacks gets a neutral 0, so every
            # version is scored on the same games.
            cols = [c for c in EXTRA_FEATURES if c in d.columns]
            d[cols] = d[cols].fillna(0.0)
            datasets[full] = d
        return datasets[full]

    live = guard.load_json(COEFFICIENTS_PATH)
    live_recipe = live.get("recipe", DEFAULT_RECIPE)
    base = dataset_for(live_recipe)
    print(f"  {len(base)} completed games with usable lines")
    if len(base) < 100:
        print("  Not enough graded games with lines to fit a reliable model yet - aborting.")
        return
    if guard.nothing_new(live, base):
        print(f"No games since the live model's last fit ({live['trained_through']}) - keeping it.")
        # Mid-season that means the cached CFBD data is stale (quota used up),
        # not the offseason: log it so the Model tab says why.
        if datetime.now(timezone.utc).month in (9, 10, 11, 12, 1):
            return skip(f"skipped: CFBD data has no games after {live['trained_through']} (quota used up or cache stale)")
        return

    print(f"\nScoring recipes on the most recent {RECENT_HOLDOUT_GAMES} games (each fit only on earlier games)...")
    chosen, report = guard.search(RECIPES, live_recipe, dataset_for, window, fit_margin_and_total, make_features,
                                  model_predict, RECENT_HOLDOUT_GAMES, recipe_name)
    dataset = window(chosen, dataset_for(chosen))
    print(f"\nRecipe: {recipe_name(chosen)}{' (switched)' if report['switched'] else ''}")

    output = validate_and_fit(dataset)
    if output is None:
        return
    trained_through = guard.latest_gameday(dataset)
    output.update({"recipe": chosen, "team_half_life_games": chosen["team_half_life"],
                   "context_inputs": recipe_extras(chosen), "trained_through": trained_through})
    if "elo" in recipe_extras(chosen):
        output["elo_start"] = context["elo_start"]  # the live picks walk this season's games from here
    ok, why, new, live_score = guard.deploy_ok(output["coefficients"], live.get("coefficients"), live_recipe, chosen,
                                               dataset_for, make_features, model_predict, report)
    if ok:
        with open(COEFFICIENTS_PATH, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nSaved fitted CFB coefficients + holdout validation report to {COEFFICIENTS_PATH}")
    reason = why or ("new recipe beat the live one on recent games" if report["switched"]
                     else "kept the recipe, refit with the newest games")
    guard.log_run("cfb", live_recipe, report, ok, reason, new, live_score, trained_through,
                  {"holdout_validation": output["holdout_validation"],
                   "weights_before": guard.weights_snapshot(live),
                   "weights_after": guard.weights_snapshot(output if ok else live)})
    guard.summary([f"### CFB game model refit ({trained_through})",
                   f"- Recipe: {'switched to ' if report['switched'] else 'kept '}{recipe_name(chosen)}",
                   f"- Deployed: {'yes' if ok else 'no - ' + why}"])

if __name__ == "__main__":
    try:
        run()
    except requests.exceptions.RequestException as e:  # quota used up, CFBD down
        skip(f"skipped: CFBD couldn't be reached ({str(e)[:120]})")
