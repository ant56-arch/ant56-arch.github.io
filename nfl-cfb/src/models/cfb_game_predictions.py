"""
cfb_game_predictions.py
College football's version of game_predictions.py - same architecture (own
model anchored on team efficiency, blended with the market using weights
fit_cfb_model.py validated on held-out seasons), applied to CFBD's PPA/
success-rate/explosiveness metrics instead of nflverse's EPA-based ones, and
scoped to Power-conference + independent FBS teams only (see fetch_cfb_data.py).

No team_overrides/auto_defense_adjustments layer here - those exist on the
NFL side for known personnel changes the current season's data can't fully
see yet; college football's much larger team count and higher roster
turnover make an equivalent by-hand override list impractical for a first
pass.

Degrades gracefully at every step: if CFBD_API_KEY hasn't been added yet (so
none of the upstream cfb_*.csv files exist), this produces no predictions
rather than crashing.
"""

import pandas as pd
from scipy.stats import norm
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import predict_common as pc
from predict_common import blend_with_market

PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "processed")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw")
TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "tracking")
COEFFICIENTS_PATH = os.path.join(os.path.dirname(__file__), "fitted_cfb_coefficients.json")

DEFAULT_COEFFICIENTS = {
    "ppa_diff_coef": 30.0, "success_rate_weight": 10.0, "explosiveness_weight": 5.0,
    "home_field_advantage": 2.0, "margin_std_dev": 16.0,
    "total_coef": 30.0, "total_intercept": 50.0, "total_std_dev": 13.0,
}
DEFAULT_BLEND_WEIGHTS = {
    "blend_weight_on_model_spread": 1.0, "blend_weight_on_model_winprob": 1.0, "blend_weight_on_model_total": 1.0,
}

def load_coefficients():
    return pc.load_coefficients(COEFFICIENTS_PATH, DEFAULT_COEFFICIENTS, DEFAULT_BLEND_WEIGHTS, "fit_cfb_model.py")

def load_team_stats():
    path = os.path.join(PROCESSED_DIR, "cfb_team_stats.csv")
    if not os.path.exists(path):
        return None
    stats = pd.read_csv(path)
    return stats.set_index("team") if not stats.empty else None

def load_upcoming_games():
    path = os.path.join(RAW_DIR, "cfb_games.csv")
    if not os.path.exists(path):
        return pd.DataFrame()
    games = pd.read_csv(path)
    return games[games["home_score"].isna()]

def load_vegas_odds():
    return pc.load_vegas_odds(os.path.join(RAW_DIR, "cfb_odds.csv"))

def matchup_expected_efficiency(offense_row, defense_row, use_current_form=True):
    return pc.matchup_expected_efficiency(offense_row, defense_row, "off_ppa_per_play", "def_ppa_per_play_allowed",
                                          use_current_form)

def secondary_adjustment(home_row, away_row, coefs, use_current_form=True):
    weights = {"off_success_rate": coefs["success_rate_weight"], "off_explosiveness": coefs["explosiveness_weight"]}
    return pc.secondary_adjustment(home_row, away_row, weights, use_current_form)

def load_context(upcoming):
    """The live recipe's extra inputs (power ratings, rest/bye, Elo,
    Pythagorean; see cfb_context.py) for each upcoming game id, from this
    season's CFBD game list (already cached by the fetch step). None when the
    recipe has none or CFBD can't be read, so those inputs count as 0."""
    if not os.path.exists(COEFFICIENTS_PATH) or upcoming.empty or "id" not in upcoming.columns:
        return None
    with open(COEFFICIENTS_PATH) as f:
        fitted = json.load(f)
    kinds = fitted.get("context_inputs") or []
    if not kinds:
        return None
    import cfb_context
    import cfb_ratings
    season = int(upcoming["season"].max())
    out = upcoming[["id"]].drop_duplicates("id")
    try:
        games = cfb_ratings.season_games(season)
        for kind in kinds:
            if kind == "bye":
                part = cfb_context.rest_features(games)
            elif kind == "pyth":
                part = cfb_context.pyth_features(games)
            elif kind == "elo":
                fbs = set(cfb_ratings.fbs_teams(season)["team"])
                part = cfb_context.elo_walk(games, fbs, start=fitted.get("elo_start"))[0]
            elif kind == "power":
                part = cfb_context.power_live(upcoming)
            else:
                continue
            out = out.merge(part.drop_duplicates("id"), on="id", how="left")
    except Exception as e:  # noqa: BLE001 - the picks still go out on the efficiency model
        print(f"  WARNING: couldn't build the extra inputs {kinds} ({e}) - they count as 0 this run.")
        return None
    print(f"  Extra inputs: {', '.join(kinds)}")
    return out.set_index("id").fillna(0.0)

def context_points(game_id, context, coefs):
    """Points the recipe's extra inputs add to the home side's margin."""
    if context is None or game_id not in context.index:
        return 0.0
    row = context.loc[game_id]
    return float(sum(row[c] * coefs[f"{c}_weight"] for c in context.columns if f"{c}_weight" in coefs))

def predict_game(home_team, away_team, team_stats, coefs, blend_weights, vegas_odds=None, use_current_form=True,
                 extra_points=0.0, neutral=False):
    if home_team not in team_stats.index or away_team not in team_stats.index:
        return None

    home_row = team_stats.loc[home_team]
    away_row = team_stats.loc[away_team]

    home_expected_eff = matchup_expected_efficiency(home_row, away_row, use_current_form)
    away_expected_eff = matchup_expected_efficiency(away_row, home_row, use_current_form)

    ppa_diff = home_expected_eff - away_expected_eff
    base_spread = ppa_diff * coefs["ppa_diff_coef"]
    adjustment = secondary_adjustment(home_row, away_row, coefs, use_current_form)

    home_field = 0.0 if neutral else coefs["home_field_advantage"]  # none at a neutral site
    model_spread = base_spread + adjustment + home_field + extra_points
    model_home_win_prob = norm.cdf(model_spread / coefs["margin_std_dev"])

    combined_expected_eff = home_expected_eff + away_expected_eff
    model_total = coefs["total_intercept"] + (combined_expected_eff * coefs["total_coef"])
    return blend_with_market(home_team, away_team, model_spread, model_total, model_home_win_prob,
                             blend_weights, vegas_odds)

def load_ratings():
    """Power ratings (cfb_ratings.py) for the picks while CFBD's advanced
    stats are out (see espn_cfb.py), limited to the teams the efficiency
    model covers so the slate stays the same."""
    path = os.path.join(TRACKING_DIR, "cfb_ratings.json")
    teams_path = os.path.join(RAW_DIR, "cfb_teams.csv")
    if not os.path.exists(path) or not os.path.exists(teams_path):
        return None
    with open(path) as f:
        data = json.load(f)
    ratings = pd.DataFrame(data.get("teams", []))
    if ratings.empty:
        return None
    covered = set(pd.read_csv(teams_path)["team"])
    ratings = ratings[ratings["team"].isin(covered)].set_index("team")
    return {"teams": ratings, "home_field": data.get("home_field", 0.0),
            "average": float(pd.DataFrame(data["teams"])["offense"].mean())}

def is_neutral(v):
    return str(v).lower() in ("true", "1", "1.0") if pd.notna(v) else False

def ratings_game(game, ratings):
    """Model numbers from the power ratings: margin = overall gap + home field
    (none at a neutral site); each side's points = its offense + the other
    side's defense - the average FBS team's level."""
    r = ratings["teams"]
    home, away = game["home_team"], game["away_team"]
    if home not in r.index or away not in r.index:
        return None
    neutral = bool(game.get("neutral")) if pd.notna(game.get("neutral")) else False
    spread = r.at[home, "overall"] - r.at[away, "overall"] + (0.0 if neutral else ratings["home_field"])
    avg = ratings["average"]
    total = (r.at[home, "offense"] + r.at[away, "defense"] - avg) + (r.at[away, "offense"] + r.at[home, "defense"] - avg)
    return spread, total

def predict_game_from_ratings(game, ratings, coefs, blend_weights, vegas_odds=None):
    numbers = ratings_game(game, ratings)
    if numbers is None:
        return None
    spread, total = numbers
    win_prob = norm.cdf(spread / coefs["margin_std_dev"])
    return blend_with_market(game["home_team"], game["away_team"], spread, total, win_prob, blend_weights, vegas_odds)

def predict_all_upcoming(use_current_form=True):
    coefs, blend_weights, holdout = load_coefficients()
    team_stats = load_team_stats()
    upcoming = load_upcoming_games()
    vegas_odds = load_vegas_odds()

    ratings = load_ratings() if team_stats is None else None
    if (team_stats is None and ratings is None) or upcoming.empty:
        return pd.DataFrame(), holdout
    if ratings is not None:
        print("  No advanced stats this run (CFBD out) - using the power ratings for the model numbers.")
    context = load_context(upcoming) if ratings is None else None

    predictions = []
    for _, game in upcoming.iterrows():
        if ratings is not None:
            pred = predict_game_from_ratings(game, ratings, coefs, blend_weights, vegas_odds)
        else:
            pred = predict_game(game["home_team"], game["away_team"], team_stats, coefs, blend_weights, vegas_odds,
                                use_current_form, context_points(game.get("id"), context, coefs),
                                is_neutral(game.get("neutral")))
        if pred:
            pred["season"] = game["season"]
            pred["week"] = game["week"]
            pred["gameday"] = game.get("gameday")
            pred["gametime"] = game.get("gametime")
            pred["weekday"] = game.get("weekday")
            pred["game_type"] = game.get("game_type")
            predictions.append(pred)

    return pd.DataFrame(predictions), holdout

def main():
    print("Loading CFB team stats, upcoming schedule, and fitted coefficients...")
    predictions, holdout = predict_all_upcoming()

    if predictions.empty:
        print("No upcoming CFB games found (or CFBD_API_KEY not set yet / no team stats).")
        return

    predictions = predictions.sort_values("favored_by", ascending=False)
    out_path = os.path.join(PROCESSED_DIR, "cfb_game_predictions.csv")
    predictions.to_csv(out_path, index=False)

    if holdout:
        print(f"\nModel calibration (holdout seasons {holdout['seasons']}, {holdout['n_games']} games):")
        print(f"  Spread MAE - model: {holdout['model_only_spread_mae']:.2f} | "
              f"blended: {holdout['blended_spread_mae']:.2f} | Vegas: {holdout['vegas_only_spread_mae']:.2f}")

    print(f"\nGenerated {len(predictions)} CFB game predictions ({predictions['has_market_line'].sum()} with a live market line).")
    print(f"Saved full results to {out_path}")

if __name__ == "__main__":
    main()
