"""
fit_model.py
Replaces every hand-picked constant in game_predictions.py with a coefficient
regressed against real NFL outcomes, and measures how much (if at all) our
model adds on top of the market once blended with it.

WHY THIS EXISTS: game_predictions.py's original constants (home field = 1.5
points, EPA-to-points scaling via a flat 65 plays/game, a fixed 13.5-point
margin std-dev, hand-typed secondary-factor weights) were "reasonable
industry-standard approximations" per its own docstring - never checked
against this project's own data. You cannot get sharp by guessing; you get
sharp by fitting coefficients to outcomes and validating out-of-sample.

DATA: nflverse's games.csv (via nfldata) carries the CLOSING Vegas
spread/total/moneyline for every game back to 1999 - no paid historical odds
subscription needed. That's the market benchmark this script fits and grades
against.

METHOD:
  1. Pull play-by-play for TRAIN_START_SEASON..present, rebuild the same
     per-game team/defense stats build_features.py computes, then re-derive
     them WALK-FORWARD (historical_features.py) so every game's features only
     ever see strictly prior games - no leakage from the outcome being fit.
  2. Split into a TRAIN window and a held-out VALIDATION window (the most
     recent two seasons). Fit margin/total regressions on TRAIN only.
  3. On the untouched VALIDATION window, compare: our model alone, Vegas
     alone, and a grid of model/Vegas blends - by mean absolute error against
     the actual final margin/total, and win-probability calibration (Brier
     score) for straight-up outcomes. Pick the blend weight that wins on
     held-out data, not on the data it was fit to.
  4. Refit final coefficients on the FULL dataset (train+validation) for
     production use, but keep the blend weight and error metrics from the
     honest holdout evaluation - a model shouldn't grade its own homework.
  5. Write everything to src/models/fitted_coefficients.json, versioned in
     git, loaded by game_predictions.py at prediction time.

Run this occasionally (see .github/workflows/refit-model.yml), NOT on every
weekly picks run - it downloads a decade-plus of play-by-play, which is slow
and unnecessary to redo twice a week.
"""

import pandas as pd
import numpy as np
import requests
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fetch_data import download_csv_gz, current_nfl_season
from build_features import build_team_game_stats, build_team_defense_game_stats
from historical_features import compute_walkforward_features
from build_features import RECENCY_HALF_LIFE_GAMES
import model_guard as guard
import fit_common as fc
from fit_common import fit_ols, recipe_extras, window  # fit_props_model uses fm.fit_ols
import moneyline
import team_ratings
import game_context

HISTORICAL_RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "historical_raw")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(HISTORICAL_RAW_DIR, exist_ok=True)

BASE = "https://github.com/nflverse/nflverse-data/releases/download"

TRAIN_START_SEASON = 2013          # modern EPA-era data, ~13 seasons by default

# Recipe search (see model_guard.py): how fast the opponent-adjusted team
# ratings forget old games (team_ratings.py, in weeks), how many seasons to
# fit on, and which game-day context inputs (game_context.py) the spread adds
# on top of the ratings. team_half_life is the raw team-form half-life the
# totals model and build_features.py use; it stays fixed. Scored on the most
# recent RECENT_HOLDOUT_GAMES games (about a season).
#
# The 16-week half-life tryouts were dropped on 2026-10-14: they finished last
# at every retrain. Their places went to two tryouts with new inputs: players
# out on the injury report, and that plus rest and travel. (Rest and travel on
# their own lost to the live recipe in 2 of 4 held-out tests, 2023-26.)
RECENT_HOLDOUT_GAMES = 256
DEFAULT_RECIPE = {"team_half_life": RECENCY_HALF_LIFE_GAMES,
                  "rating_half_life": team_ratings.RATING_HALF_LIFE_WEEKS, "seasons": "all"}
# Ten versions (Anthony, 2026-10-17: ten per sport). Elo and Pythagorean are
# published rating methods: FiveThirtyEight-style Elo and Pythagorean
# expectation (game_context.py).
#
# 2026-10-19 (Anthony: keep ten, drop the bottom two and add new ones each
# time): the 8-week ratings half-life recipes went, after finishing behind the
# 4-week ones at every retrain. In came home field learned from this season
# (home teams won 47% of 2026 games through Week 6), alone and with injuries.
# 2026-10-26 (Anthony: use the best free data): Elo alone and injuries + Elo +
# Pythagorean, last on the recent games, made way for kickoff weather from
# Open-Meteo (weather.py), alone and with injuries.
RECIPES = ([{"team_half_life": RECENCY_HALF_LIFE_GAMES, "rating_half_life": 4, "seasons": n} for n in ("all", 8)]
           + [{"team_half_life": RECENCY_HALF_LIFE_GAMES, "rating_half_life": 4, "seasons": "all", "extras": extras}
              for extras in (["injuries"], ["injuries", "rest"], ["pyth"], ["injuries", "elo"],
                             ["home"], ["injuries", "home"], ["weather"], ["injuries", "weather"])])
EXTRA_FEATURES = [c for cols in game_context.FEATURES.values() for c in cols]
COEFFICIENTS_PATH = os.path.join(MODELS_DIR, "fitted_coefficients.json")

def rating_half_life(r):
    return r.get("rating_half_life", team_ratings.RATING_HALF_LIFE_WEEKS)

def recipe_name(r):
    return fc.recipe_name(r, f"ratings half-life {rating_half_life(r)} weeks")

OFF_METRICS = ["epa_per_play", "third_down_rate", "redzone_td_rate", "explosive_rate", "sack_rate"]
DEF_METRICS = ["def_epa_per_play_allowed"]

def fetch_historical_pbp(seasons):
    frames = []
    for season in seasons:
        dest = os.path.join(HISTORICAL_RAW_DIR, f"pbp_{season}.csv.gz")
        if not os.path.exists(dest):
            url = f"{BASE}/pbp/play_by_play_{season}.csv.gz"
            try:
                download_csv_gz(url, dest)
            except requests.exceptions.HTTPError as e:
                # Between the Super Bowl and week 1 the new season's file
                # doesn't exist yet - fit on the seasons that do.
                print(f"  Skipping {season} (not published yet): {e}")
                continue
        df = pd.read_csv(dest, compression="gzip", low_memory=False)
        df["season"] = season
        frames.append(df)
    return pd.concat(frames, ignore_index=True)

def fetch_historical_schedules():
    url = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
    return pd.read_csv(url)

def load_pbp_offense_defense(pbp):
    pbp = pbp[pbp["play_type"].isin(["pass", "run"])]
    pbp = pbp[pbp["posteam"].notna()]
    off = build_team_game_stats(pbp)
    defn = build_team_defense_game_stats(pbp)
    return off, defn

def build_dataset(off_walk, def_walk, schedules):
    """
    One row per completed REG/POST game with actual results, closing Vegas
    lines, and both teams' pre-game (walk-forward) features.
    """
    off_cols = ["season", "week", "team"] + [f"{c}_asof" for c in OFF_METRICS] + [f"{c}_asof_season_avg" for c in OFF_METRICS]
    def_cols = ["season", "week", "team"] + [f"{c}_asof" for c in DEF_METRICS] + [f"{c}_asof_season_avg" for c in DEF_METRICS]
    off = off_walk[off_cols]
    defn = def_walk[def_cols]

    games = schedules[schedules["result"].notna()].copy()
    games = games[games["spread_line"].notna() & games["total_line"].notna()]

    games = fc.merge_side(games, off, "home")
    games = fc.merge_side(games, off, "away")
    games = fc.merge_side(games, defn, "home")
    games = fc.merge_side(games, defn, "away")

    games["actual_margin"] = games["home_score"] - games["away_score"]
    games["actual_total"] = games["home_score"] + games["away_score"]
    # nflverse's games.csv "spread_line" is the home team's expected margin
    # directly (positive = home favored) - NOT the traditional bookmaker
    # "-3 favorite" notation that fetch_odds.py's the-odds-api integration
    # uses. Verified empirically: spread_line correlates +0.43 with actual
    # home margin; -spread_line correlates -0.43 (confirms the sign).
    games["vegas_home_favored_by"] = games["spread_line"]
    games["vegas_total"] = games["total_line"]
    games["vegas_home_ml_prob"] = games["home_moneyline"].apply(moneyline.implied_prob)
    games["vegas_away_ml_prob"] = games["away_moneyline"].apply(moneyline.implied_prob)
    vig_sum = games["vegas_home_ml_prob"] + games["vegas_away_ml_prob"]
    games["vegas_home_win_prob"] = games["vegas_home_ml_prob"] / vig_sum
    games["home_won"] = (games["actual_margin"] > 0).astype(float)

    return games

def attach_ratings(dataset, pbp, schedules, half_life=team_ratings.RATING_HALF_LIFE_WEEKS):
    """Adds team_ratings.FEATURES (opponent-adjusted ratings and starting-QB
    gap, each built only from earlier games) to every game in dataset."""
    feats = team_ratings.game_features(pbp, schedules[schedules["season"] >= pbp["season"].min()],
                                       from_season=int(dataset["season"].min()), half_life=half_life)
    return dataset.merge(feats, on=["season", "week", "home_team", "away_team"], how="left")

def make_features(games, suffix="_asof"):
    """Build the exact feature set predict_game() uses, for every row."""
    home_off = games[f"home_epa_per_play{suffix}"]
    away_def = games[f"away_def_epa_per_play_allowed{suffix}"]
    away_off = games[f"away_epa_per_play{suffix}"]
    home_def = games[f"home_def_epa_per_play_allowed{suffix}"]

    home_exp_eff = (home_off + away_def) / 2
    away_exp_eff = (away_off + home_def) / 2

    feats = pd.DataFrame({
        "epa_diff": home_exp_eff - away_exp_eff,
        "third_down_diff": games[f"home_third_down_rate{suffix}"] - games[f"away_third_down_rate{suffix}"],
        "redzone_diff": games[f"home_redzone_td_rate{suffix}"] - games[f"away_redzone_td_rate{suffix}"],
        "explosive_diff": games[f"home_explosive_rate{suffix}"] - games[f"away_explosive_rate{suffix}"],
        "sack_diff": games[f"home_sack_rate{suffix}"] - games[f"away_sack_rate{suffix}"],
    })
    feats["combined_exp_eff"] = home_exp_eff + away_exp_eff
    for col in team_ratings.FEATURES:
        feats[col] = games[col] if col in games.columns else np.nan
    # Context inputs only exist on a recipe's dataset when the recipe uses them.
    if "wind10" in games.columns:
        feats["wind_shrink"] = games["wind10"].fillna(0) * feats["points_rating_diff"]
    for col in EXTRA_FEATURES:
        if col in games.columns:
            feats[col] = games[col]
    return feats

def spread_columns(feats):
    return team_ratings.FEATURES + [c for c in EXTRA_FEATURES if c in feats.columns]

def fit_margin_and_total(feats, games):
    valid = feats.notna().all(axis=1) & games["actual_margin"].notna() & games["actual_total"].notna()
    feats, games = feats[valid], games[valid]

    n = len(feats)
    ones = np.ones(n)

    # Spread: opponent-adjusted ratings + starting-QB gap (+ the recipe's
    # context inputs). home_field is 1 for a true home game and 0 at a neutral
    # site, so its weight is home field.
    cols = spread_columns(feats)
    X_margin = feats[cols].values
    X_total = np.column_stack([feats["combined_exp_eff"], ones])
    if "_fit_weight" in games.columns:  # season_decay: weighted least squares
        sw = np.sqrt(games["_fit_weight"].values)
        bm, _ = fit_ols(X_margin * sw[:, None], games["actual_margin"].values * sw)
        bt, _ = fit_ols(X_total * sw[:, None], games["actual_total"].values * sw)
        beta_margin, resid_margin = bm, games["actual_margin"].values - X_margin @ bm
        beta_total, resid_total = bt, games["actual_total"].values - X_total @ bt
    else:
        beta_margin, resid_margin = fit_ols(X_margin, games["actual_margin"].values)
        beta_total, resid_total = fit_ols(X_total, games["actual_total"].values)

    coefs = {
        "points_rating_weight": float(beta_margin[0]),
        "success_rating_weight": float(beta_margin[1]),
        "qb_weight": float(beta_margin[2]),
        "home_field_advantage": float(beta_margin[3]),
    }
    coefs.update({f"{c}_weight": float(b) for c, b in zip(cols[4:], beta_margin[4:])})
    coefs.update({
        "margin_std_dev": float(np.std(resid_margin, ddof=X_margin.shape[1])),
        "total_coef": float(beta_total[0]),
        "total_intercept": float(beta_total[1]),
        "total_std_dev": float(np.std(resid_total, ddof=X_total.shape[1])),
        "n_games": int(n),
    })
    return coefs, valid

def model_predict(feats, coefs):
    total = feats["combined_exp_eff"] * coefs["total_coef"] + coefs["total_intercept"]
    if "points_rating_weight" in coefs:
        spread = (feats["points_rating_diff"] * coefs["points_rating_weight"]
                  + feats["success_rating_diff"] * coefs["success_rating_weight"]
                  + feats["qb_diff"] * coefs["qb_weight"]
                  + feats["home_field"] * coefs["home_field_advantage"])
        for col in EXTRA_FEATURES:
            if f"{col}_weight" in coefs:
                spread = spread + feats[col] * coefs[f"{col}_weight"]
        return spread, total
    # Coefficients fit before team_ratings.py (raw EPA and rate gaps), so the
    # refit's guard can still score the live model it may replace.
    spread = (
        feats["epa_diff"] * coefs["epa_diff_coef"]
        + feats["third_down_diff"] * coefs["third_down_weight"]
        + feats["redzone_diff"] * coefs["redzone_weight"]
        + feats["explosive_diff"] * coefs["explosive_weight"]
        + feats["sack_diff"] * coefs["sack_weight"]
        + coefs["home_field_advantage"]
    )
    return spread, total

def validate_and_fit(dataset):
    """Fit on all but the last VALIDATION_SEASONS seasons, pick blend weights
    on those held-out seasons, then refit on everything (fit_common.py)."""
    return fc.validate_and_fit(dataset, make_features, lambda feats, games: fit_margin_and_total(feats, games)[0],
                               model_predict, verbose=True)

def run():
    current_season = current_nfl_season()
    seasons = list(range(TRAIN_START_SEASON, current_season + 1))
    print(f"Fetching play-by-play for {len(seasons)} seasons ({seasons[0]}-{seasons[-1]})...")
    pbp = fetch_historical_pbp(seasons)
    print(f"  {len(pbp):,} rows loaded")

    print("Rebuilding per-game team/defense stats...")
    off_game, def_game = load_pbp_offense_defense(pbp)

    print("Fetching historical schedules + closing Vegas lines...")
    schedules = fetch_historical_schedules()

    datasets = {}
    injury_inputs = []  # loaded once, the first time an injuries recipe needs them

    def dataset_for(recipe):
        """Completed games with walk-forward (no-leakage) features at this
        recipe's half-lives, plus its context inputs."""
        key = (recipe["team_half_life"], rating_half_life(recipe))
        if key not in datasets:
            hl = recipe["team_half_life"]
            off_walk = compute_walkforward_features(off_game, OFF_METRICS, half_life=hl)
            def_walk = compute_walkforward_features(def_game, DEF_METRICS, half_life=hl)
            dataset = build_dataset(off_walk, def_walk, schedules)
            dataset = dataset[dataset["season"] >= TRAIN_START_SEASON]
            datasets[key] = attach_ratings(dataset, pbp, schedules, half_life=rating_half_life(recipe))
        extras = recipe_extras(recipe)
        if not extras:
            return datasets[key]
        full = key + tuple(extras)
        if full not in datasets:
            if "injuries" in extras and not injury_inputs:
                injury_inputs.append(game_context.load_injury_inputs(seasons, HISTORICAL_RAW_DIR))
            ctx = game_context.context_features(schedules, extras, injury_inputs[0] if injury_inputs else None)
            datasets[full] = datasets[key].merge(ctx, on=game_context.KEY, how="left")
        return datasets[full]

    live = guard.load_json(COEFFICIENTS_PATH)
    live_recipe = live.get("recipe", DEFAULT_RECIPE)
    base = dataset_for(live_recipe)
    print(f"  {len(base)} completed games with usable Vegas lines")
    if guard.nothing_new(live, base):
        print(f"No games since the live model's last fit ({live['trained_through']}) - keeping it.")
        return

    print(f"\nScoring recipes on the most recent {RECENT_HOLDOUT_GAMES} games (each fit only on earlier games)...")
    fit = lambda feats, games: fit_margin_and_total(feats, games)[0]  # noqa: E731
    chosen, report = guard.search(RECIPES, live_recipe, dataset_for, window, fit, make_features, model_predict,
                                  RECENT_HOLDOUT_GAMES, recipe_name)
    dataset = window(chosen, dataset_for(chosen))
    print(f"\nRecipe: {recipe_name(chosen)}{' (switched)' if report['switched'] else ''}")

    output = validate_and_fit(dataset)
    if output is None:
        return
    trained_through = guard.latest_gameday(dataset)
    output.update({"recipe": chosen, "team_half_life_games": chosen["team_half_life"],
                   "rating_half_life_weeks": rating_half_life(chosen), "context_inputs": recipe_extras(chosen),
                   "trained_through": trained_through})
    ok, why, new, live_score = guard.deploy_ok(output["coefficients"], live.get("coefficients"), live_recipe, chosen,
                                               dataset_for, make_features, model_predict, report)
    if ok:
        with open(COEFFICIENTS_PATH, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nSaved fitted coefficients + holdout validation report to {COEFFICIENTS_PATH}")
    reason = why or ("new recipe beat the live one on recent games" if report["switched"]
                     else "kept the recipe, refit with the newest games")
    guard.log_run("nfl", live_recipe, report, ok, reason, new, live_score, trained_through,
                  {"holdout_validation": output["holdout_validation"],
                   "weights_before": guard.weights_snapshot(live),
                   "weights_after": guard.weights_snapshot(output if ok else live)})
    guard.summary([f"### NFL game model refit ({trained_through})",
                   f"- Recipe: {'switched to ' if report['switched'] else 'kept '}{recipe_name(chosen)}",
                   f"- Deployed: {'yes' if ok else 'no - ' + why}"])

if __name__ == "__main__":
    run()
