"""
game_predictions.py
Predicts game winners, spreads, and totals for upcoming NFL games.

APPROACH:
The spread comes from team_ratings.py: schedule-adjusted power and
success-rate ratings for both teams plus the gap between the two starting
QBs, rebuilt from play-by-play before each week. The total still comes from
each team's recency-weighted EPA/play (team_stats.csv): each team's expected
efficiency in THIS game = average of (their own offensive efficiency) and
(their opponent's defensive efficiency allowed).

MANUAL OVERRIDES: team_stats gets adjusted by team_overrides.py and
auto_defense_adjustments.py for personnel changes this season's data can't
fully see yet. Those adjust the EPA columns, so they now move the total and
the legacy spread only; the ratings see trades through the games played.

CALIBRATION: every point/probability conversion below (EPA-to-points scaling,
spread-to-win% curve, home field edge, secondary-factor weights) is a
coefficient regressed against this project's own historical outcomes by
fit_model.py, not a hand-picked guess - see src/models/fitted_coefficients.json
and that script's holdout-validation report for how well it actually performs.
If that file is missing (e.g. first run before fit_model.py has ever been
run), we fall back to the original hand-picked constants so the pipeline
still produces something, but sharpness depends on running the refit.

MARKET BLENDING: the market (Vegas closing lines) is, empirically, very hard
to beat outright. Rather than pretend our standalone model is the sharpest
number in the building, we blend it with the current market line using
weights fit_model.py validated on held-out seasons to minimize error. That
blended "sharp" line is the headline prediction; the pure, unblended model
output is kept alongside it specifically so compare_to_vegas.py can still
flag real model/market disagreements (a blended number can't disagree with
itself).
"""

import pandas as pd
from scipy.stats import norm
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from team_overrides import apply_overrides
from auto_defense_adjustments import apply_auto_adjustments
import team_ratings
import game_context
from fetch_data import current_nfl_season
import predict_common as pc

PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "processed")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw")
COEFFICIENTS_PATH = os.path.join(os.path.dirname(__file__), "fitted_coefficients.json")

# Fallback constants, used ONLY if fitted_coefficients.json doesn't exist yet
# (run src/fit_model.py to generate it). These are the original hand-picked
# starting points - kept purely so the pipeline degrades gracefully instead
# of crashing, not because they're a good source of sharpness.
DEFAULT_COEFFICIENTS = {
    "epa_diff_coef": 65.0,
    "third_down_weight": 8.0,
    "redzone_weight": 6.0,
    "explosive_weight": 10.0,
    "sack_weight": -6.0,
    "home_field_advantage": 1.5,
    "margin_std_dev": 13.5,
    "total_coef": 65.0,
    "total_intercept": 45.0,
    "total_std_dev": 10.0,
}
DEFAULT_BLEND_WEIGHTS = {
    "blend_weight_on_model_spread": 1.0,
    "blend_weight_on_model_winprob": 1.0,
    "blend_weight_on_model_total": 1.0,
}

def load_coefficients():
    return pc.load_coefficients(COEFFICIENTS_PATH, DEFAULT_COEFFICIENTS, DEFAULT_BLEND_WEIGHTS, "fit_model.py")

def load_rating_half_life():
    if not os.path.exists(COEFFICIENTS_PATH):
        return team_ratings.RATING_HALF_LIFE_WEEKS
    with open(COEFFICIENTS_PATH) as f:
        return json.load(f).get("rating_half_life_weeks", team_ratings.RATING_HALF_LIFE_WEEKS)

def load_team_stats():
    team_stats = pd.read_csv(os.path.join(PROCESSED_DIR, "team_stats.csv")).set_index("team")
    team_stats = apply_overrides(team_stats)
    team_stats = apply_auto_adjustments(team_stats)
    return team_stats

def load_upcoming_games():
    schedules = pd.read_csv(os.path.join(RAW_DIR, "schedules.csv"))
    upcoming = schedules[schedules["result"].isna()]
    # A game from a past season with no result (cancelled, never made up)
    # isn't upcoming - without this it would sort ahead of the real next week.
    recent = (pd.Timestamp.now() - pd.Timedelta(days=14)).strftime("%Y-%m-%d")
    return upcoming[upcoming["gameday"].astype(str).str[:10] >= recent]

def context_kinds(coefs):
    """The game_context.py inputs the live recipe's spread uses."""
    return [kind for kind, cols in game_context.FEATURES.items() if any(f"{c}_weight" in coefs for c in cols)]

def load_rating_features(half_life, kinds=()):
    """team_ratings.FEATURES (plus any game_context.py inputs in kinds) for
    every game of the current season, indexed by (season, week, home_team,
    away_team)."""
    cols = ["game_id", "season", "week", "posteam", "defteam", "play_type", "epa", "success",
            "pass", "qb_dropback", "passer_player_id"]
    pbp = pd.read_parquet(os.path.join(RAW_DIR, "pbp_combined.parquet"), columns=cols)
    schedules = pd.read_csv(os.path.join(RAW_DIR, "schedules.csv"))
    feats = team_ratings.game_features(pbp, schedules, from_season=int(schedules["season"].max()),
                                       half_life=half_life)
    if kinds:
        season = current_nfl_season()
        inputs = (game_context.load_injury_inputs([season - 1, season], os.path.join(RAW_DIR, "context"), season)
                  if "injuries" in kinds else None)
        history = game_context.full_history(schedules, os.path.join(RAW_DIR, "context")) if "elo" in kinds else None
        feats = feats.merge(game_context.context_features(schedules, kinds, inputs, history), on=game_context.KEY, how="left")
        feats = game_context.add_weather_terms(feats)
    return feats.set_index(["season", "week", "home_team", "away_team"])

def load_vegas_odds():
    return pc.load_vegas_odds(os.path.join(RAW_DIR, "odds.csv"))

def matchup_expected_efficiency(offense_row, defense_row, use_current_form=True):
    return pc.matchup_expected_efficiency(offense_row, defense_row, "epa_per_play", "def_epa_per_play_allowed",
                                          use_current_form)

def secondary_adjustment(home_row, away_row, coefs, use_current_form=True):
    weights = {
        "third_down_rate": coefs["third_down_weight"],
        "redzone_td_rate": coefs["redzone_weight"],
        "explosive_rate": coefs["explosive_weight"],
        "sack_rate": coefs["sack_weight"],
    }
    return pc.secondary_adjustment(home_row, away_row, weights, use_current_form)

def ratings_spread(rating_row, coefs):
    spread = (rating_row["points_rating_diff"] * coefs["points_rating_weight"]
              + rating_row["success_rating_diff"] * coefs["success_rating_weight"]
              + rating_row["qb_diff"] * coefs["qb_weight"]
              + rating_row["home_field"] * coefs["home_field_advantage"])
    for cols in game_context.FEATURES.values():
        for c in cols:
            if f"{c}_weight" in coefs:
                spread += (0.0 if pd.isna(rating_row.get(c)) else rating_row[c]) * coefs[f"{c}_weight"]
    return spread

def predict_game(home_team, away_team, team_stats, coefs, blend_weights, vegas_odds=None, use_current_form=True,
                 rating_row=None):
    if home_team not in team_stats.index or away_team not in team_stats.index:
        return None

    home_row = team_stats.loc[home_team]
    away_row = team_stats.loc[away_team]

    home_expected_eff = matchup_expected_efficiency(home_row, away_row, use_current_form)
    away_expected_eff = matchup_expected_efficiency(away_row, home_row, use_current_form)

    if "points_rating_weight" in coefs:
        if rating_row is None:
            return None
        model_spread = ratings_spread(rating_row, coefs)
    else:
        epa_diff = home_expected_eff - away_expected_eff
        base_spread = epa_diff * coefs["epa_diff_coef"]
        adjustment = secondary_adjustment(home_row, away_row, coefs, use_current_form)
        model_spread = base_spread + adjustment + coefs["home_field_advantage"]
    model_home_win_prob = norm.cdf(model_spread / coefs["margin_std_dev"])

    combined_expected_eff = home_expected_eff + away_expected_eff
    model_total = coefs["total_intercept"] + (combined_expected_eff * coefs["total_coef"])

    return pc.blend_with_market(home_team, away_team, model_spread, model_total, model_home_win_prob,
                                blend_weights, vegas_odds)

def predict_all_upcoming(use_current_form=True):
    coefs, blend_weights, holdout = load_coefficients()
    team_stats = load_team_stats()
    upcoming = load_upcoming_games()
    vegas_odds = load_vegas_odds()
    ratings = None
    if "points_rating_weight" in coefs:
        ratings = load_rating_features(load_rating_half_life(), context_kinds(coefs))

    if vegas_odds is None:
        print("  No Vegas odds available yet - predictions will be model-only "
              "(run fetch_odds.py before this step to enable market blending).")

    predictions = []
    for _, game in upcoming.iterrows():
        key = (game["season"], game["week"], game["home_team"], game["away_team"])
        rating_row = ratings.loc[key] if ratings is not None and key in ratings.index else None
        pred = predict_game(game["home_team"], game["away_team"], team_stats, coefs, blend_weights, vegas_odds,
                            use_current_form, rating_row)
        if pred:
            pred["season"] = game["season"]
            pred["week"] = game["week"]
            pred["gameday"] = game["gameday"]
            pred["gametime"] = game.get("gametime")
            pred["weekday"] = game.get("weekday")
            pred["game_type"] = game.get("game_type")
            predictions.append(pred)

    return pd.DataFrame(predictions), holdout

def main():
    print("Loading team stats, upcoming schedule, and fitted coefficients...")
    predictions, holdout = predict_all_upcoming()

    if predictions.empty:
        print("No upcoming games found.")
        return

    predictions = predictions.sort_values("favored_by", ascending=False)
    out_path = os.path.join(PROCESSED_DIR, "game_predictions.csv")
    predictions.to_csv(out_path, index=False)

    if holdout:
        print(f"\nModel calibration (holdout seasons {holdout['seasons']}, {holdout['n_games']} games):")
        print(f"  Spread MAE  - model: {holdout['model_only_spread_mae']:.2f} pts | "
              f"blended: {holdout['blended_spread_mae']:.2f} pts | Vegas: {holdout['vegas_only_spread_mae']:.2f} pts")
        print(f"  Win Brier   - model: {holdout['model_only_brier']:.4f} | "
              f"blended: {holdout['blended_brier']:.4f} | Vegas: {holdout['vegas_only_brier']:.4f}")

    print(f"\nGenerated {len(predictions)} game predictions "
          f"({predictions['has_market_line'].sum()} with a live market line to blend against).")
    print("\nTop 5 most confident predictions:")
    print(predictions[["week", "home_team", "away_team", "favored_team", "favored_by", "home_win_prob", "projected_total"]].head(5).to_string(index=False))
    print(f"\nSaved full results to {out_path}")

if __name__ == "__main__":
    main()
