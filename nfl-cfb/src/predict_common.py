"""
predict_common.py
The parts of the NFL and CFB weekly game predictions
(models/game_predictions.py, models/cfb_game_predictions.py) that are the
same for both sports: reading the fitted coefficients, the Vegas odds file
and one game's line, each side's expected efficiency in a matchup, the
secondary-stat adjustment, and blending the model's numbers with the market.
"""

import json
import os

import numpy as np
import pandas as pd

def load_coefficients(path, defaults, default_blend, fit_script):
    """(coefficients, blend weights, holdout report) from a fitted
    coefficients file, or the hand-picked fallbacks when it doesn't exist."""
    if not os.path.exists(path):
        print(f"  WARNING: {os.path.basename(path)} not found - using un-backtested "
              f"fallback constants. Run src/{fit_script} to fit real coefficients.")
        return defaults, default_blend, None
    with open(path) as f:
        fitted = json.load(f)
    coefs = fitted["coefficients"]
    blend = {
        "blend_weight_on_model_spread": fitted.get("blend_weight_on_model_spread", 1.0),
        "blend_weight_on_model_winprob": fitted.get("blend_weight_on_model_winprob", 1.0),
        "blend_weight_on_model_total": fitted.get("blend_weight_on_model_total", 1.0),
    }
    return coefs, blend, fitted.get("holdout_validation")

def load_vegas_odds(odds_path):
    if not os.path.exists(odds_path):
        return None
    odds = pd.read_csv(odds_path)
    if odds.empty:
        return None
    return odds.set_index(["home_team", "away_team"])

def matchup_expected_efficiency(offense_row, defense_row, off_col, def_col, use_current_form=True):
    """A side's expected efficiency in this game: the average of its own
    offense and the opponent's defense allowed."""
    suffix = "" if use_current_form else "_season_avg"
    return (offense_row[f"{off_col}{suffix}"] + defense_row[f"{def_col}{suffix}"]) / 2

def secondary_adjustment(home_row, away_row, weights, use_current_form=True):
    """Sum of (home - away) * weight over weights {stat column: weight},
    skipping a stat either side lacks."""
    suffix = "" if use_current_form else "_season_avg"
    adjustment = 0.0
    for factor, weight in weights.items():
        home_val = home_row.get(f"{factor}{suffix}", np.nan)
        away_val = away_row.get(f"{factor}{suffix}", np.nan)
        if pd.notna(home_val) and pd.notna(away_val):
            adjustment += (home_val - away_val) * weight
    return adjustment

def get_vegas_line(vegas_odds, home_team, away_team):
    if vegas_odds is None or (home_team, away_team) not in vegas_odds.index:
        return None
    row = vegas_odds.loc[(home_team, away_team)]
    return {
        "home_favored_by": row.get("vegas_home_favored_by"),
        "total": row.get("total_line"),
        "home_win_prob": row.get("vegas_home_win_prob"),
    }

def blend_with_market(home_team, away_team, model_spread, model_total, model_home_win_prob, blend_weights, vegas_odds=None):
    """One game's prediction row: the model's own numbers plus the "sharp"
    ones blended with the market line at the fitted weights (the model's
    alone when there's no line)."""
    vegas = get_vegas_line(vegas_odds, home_team, away_team)
    has_market = vegas is not None and pd.notna(vegas.get("home_favored_by"))

    if has_market:
        w_spread = blend_weights["blend_weight_on_model_spread"]
        sharp_spread = w_spread * model_spread + (1 - w_spread) * vegas["home_favored_by"]

        w_total = blend_weights["blend_weight_on_model_total"]
        sharp_total = (w_total * model_total + (1 - w_total) * vegas["total"]
                       if pd.notna(vegas.get("total")) else model_total)

        w_wp = blend_weights["blend_weight_on_model_winprob"]
        sharp_home_win_prob = (w_wp * model_home_win_prob + (1 - w_wp) * vegas["home_win_prob"]
                                if pd.notna(vegas.get("home_win_prob")) else model_home_win_prob)
    else:
        sharp_spread, sharp_total, sharp_home_win_prob = model_spread, model_total, model_home_win_prob

    return {
        "home_team": home_team, "away_team": away_team, "has_market_line": has_market,
        "model_home_win_prob": round(model_home_win_prob, 3),
        "model_spread": round(model_spread, 1), "model_total": round(model_total, 1),
        "home_win_prob": round(sharp_home_win_prob, 3), "away_win_prob": round(1 - sharp_home_win_prob, 3),
        "projected_spread": round(sharp_spread, 1), "projected_total": round(sharp_total, 1),
        "favored_team": home_team if sharp_spread > 0 else away_team,
        "favored_by": round(abs(sharp_spread), 1),
    }
