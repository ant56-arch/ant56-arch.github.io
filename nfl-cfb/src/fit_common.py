"""
fit_common.py
The parts of the NFL and CFB game-model refits (fit_model.py,
fit_cfb_model.py) that are the same for both sports: joining each team's
stats onto a game, plain least squares, the recipe helpers model_guard.py
calls, and the holdout check that picks the model/Vegas blend weights. Each
sport passes in its own make_features / fit / model_predict.
"""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

VALIDATION_SEASONS = 2             # most recent N completed seasons held out
BLEND_GRID = np.round(np.arange(0.0, 1.01, 0.05), 2)


def recipe_extras(r):
    return list(r.get("extras", []))


def recipe_name(r, head):
    """head is the sport's half-life part, e.g. 'half-life 4 games'."""
    extras = "".join(f" + {kind}" for kind in recipe_extras(r))
    if r.get("season_decay"):
        extras += f", older seasons x{r['season_decay']}"
    return f"{head}, {r['seasons']} seasons{extras}"


def window(recipe, dataset):
    if recipe["seasons"] != "all" and not dataset.empty:
        dataset = dataset[dataset["season"] > dataset["season"].max() - recipe["seasons"]]
    # season_decay (Anthony, 2026-10-26: keep learning from this season): each
    # older season counts this much as much as the one after it when the
    # weights are fit, so 0.5 makes this season count double last season.
    decay = recipe.get("season_decay")
    if decay and not dataset.empty:
        dataset = dataset.copy()
        dataset["_fit_weight"] = decay ** (dataset["season"].max() - dataset["season"])
    return dataset


def merge_side(games, stats, side):
    """Rename a per-team stats frame's team/metric columns to home_/away_
    and merge onto games on (season, week, <side>_team)."""
    rename = {"team": f"{side}_team"}
    rename.update({c: f"{side}_{c}" for c in stats.columns if c not in ("season", "week", "team")})
    renamed = stats.rename(columns=rename)
    return games.merge(renamed, on=["season", "week", f"{side}_team"], how="left")


def fit_ols(X, y):
    """Plain OLS via lstsq (no sklearn dependency): y = X @ beta, X's last
    column is a constant 1s column so beta[-1] is the fitted intercept."""
    beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    residuals = y - X @ beta
    return beta, residuals


def evaluate_blend(model_spread, vegas_spread, actual_margin, model_wp, vegas_wp, home_won):
    """For every blend weight in BLEND_GRID, compute spread MAE and win-prob
    Brier score. Returns the grid as a DataFrame plus the best weight for each."""
    rows = []
    for w in BLEND_GRID:
        blended_spread = w * model_spread + (1 - w) * vegas_spread
        spread_mae = float(np.mean(np.abs(blended_spread - actual_margin)))

        blended_wp = w * model_wp + (1 - w) * vegas_wp
        brier = float(np.mean((blended_wp - home_won) ** 2))

        rows.append({"weight_on_model": float(w), "spread_mae": spread_mae, "brier_score": brier})

    grid = pd.DataFrame(rows)
    best_spread_w = float(grid.loc[grid["spread_mae"].idxmin(), "weight_on_model"])
    best_wp_w = float(grid.loc[grid["brier_score"].idxmin(), "weight_on_model"])
    return grid, best_spread_w, best_wp_w


def evaluate_total_blend(model_total, vegas_total, actual_total):
    """The same grid search for the total, on total MAE."""
    total_rows = []
    for w in BLEND_GRID:
        blended_total = w * model_total + (1 - w) * vegas_total
        total_rows.append({"weight_on_model": float(w), "total_mae": float(np.mean(np.abs(blended_total - actual_total)))})
    total_grid = pd.DataFrame(total_rows)
    best_total_w = float(total_grid.loc[total_grid["total_mae"].idxmin(), "weight_on_model"])
    return total_grid, best_total_w


def validate_and_fit(dataset, make_features, fit, model_predict, verbose=False):
    """Fit on all but the last VALIDATION_SEASONS seasons, pick blend weights
    on those held-out seasons, then refit on everything. fit(feats, games)
    returns the coefficient dict. verbose: the NFL refit's longer printout.
    None when no held-out game is usable."""
    holdout_seasons = sorted(dataset["season"].unique())[-VALIDATION_SEASONS:]
    train = dataset[~dataset["season"].isin(holdout_seasons)]
    validation = dataset[dataset["season"].isin(holdout_seasons)]
    if verbose:
        print(f"  Train: {len(train)} games ({train['season'].min()}-{train['season'].max()})")
        print(f"  Validation (held out): {len(validation)} games (seasons {holdout_seasons})")
    else:
        print(f"  Train: {len(train)} games, Validation: {len(validation)} games (seasons {holdout_seasons})")

    print("\nFitting margin/total regressions on TRAIN only...")
    train_feats = make_features(train)
    train_coefs = fit(train_feats, train)
    if verbose:
        print(f"  {json.dumps(train_coefs, indent=2)}")

    print("\nEvaluating model vs Vegas vs blends on the HELD-OUT validation seasons...")
    val_feats = make_features(validation)
    valid_mask = val_feats.notna().all(axis=1) & validation["actual_margin"].notna() & validation["vegas_home_win_prob"].notna()
    val_feats, val_games = val_feats[valid_mask], validation[valid_mask]

    if val_feats.empty:
        print("  No valid held-out games to evaluate against - aborting.")
        return None

    from scipy.stats import norm
    model_spread, model_total = model_predict(val_feats, train_coefs)
    model_wp = norm.cdf(model_spread / train_coefs["margin_std_dev"])

    vegas_spread = val_games["vegas_home_favored_by"].values
    vegas_total = val_games["vegas_total"].values
    vegas_wp = val_games["vegas_home_win_prob"].values
    actual_margin = val_games["actual_margin"].values
    actual_total = val_games["actual_total"].values
    home_won = val_games["home_won"].values

    model_only_mae = float(np.mean(np.abs(model_spread - actual_margin)))
    vegas_only_mae = float(np.mean(np.abs(vegas_spread - actual_margin)))
    model_only_brier = float(np.mean((model_wp - home_won) ** 2))
    vegas_only_brier = float(np.mean((vegas_wp - home_won) ** 2))
    model_total_mae = float(np.mean(np.abs(model_total - actual_total)))
    vegas_total_mae = float(np.mean(np.abs(vegas_total - actual_total)))

    if verbose:
        print(f"  Spread MAE  - model only: {model_only_mae:.2f} pts | Vegas only: {vegas_only_mae:.2f} pts")
        print(f"  Total MAE   - model only: {model_total_mae:.2f} pts | Vegas only: {vegas_total_mae:.2f} pts")
        print(f"  Win Brier   - model only: {model_only_brier:.4f} | Vegas only: {vegas_only_brier:.4f}")
    else:
        print(f"  Spread MAE - model: {model_only_mae:.2f} | Vegas: {vegas_only_mae:.2f}")
        print(f"  Total MAE  - model: {model_total_mae:.2f} | Vegas: {vegas_total_mae:.2f}")
        print(f"  Win Brier  - model: {model_only_brier:.4f} | Vegas: {vegas_only_brier:.4f}")

    grid, best_spread_w, best_wp_w = evaluate_blend(model_spread, vegas_spread, actual_margin, model_wp, vegas_wp, home_won)
    best_row_spread = grid.loc[grid["weight_on_model"] == best_spread_w].iloc[0]
    best_row_wp = grid.loc[grid["weight_on_model"] == best_wp_w].iloc[0]
    if verbose:
        print(f"\n  Best blend weight on OUR model for spread: {best_spread_w} "
              f"(blended MAE {best_row_spread['spread_mae']:.2f} pts, vs Vegas-only {vegas_only_mae:.2f})")
        print(f"  Best blend weight on OUR model for win-prob: {best_wp_w} "
              f"(blended Brier {best_row_wp['brier_score']:.4f}, vs Vegas-only {vegas_only_brier:.4f})")

    total_grid, best_total_w = evaluate_total_blend(model_total, vegas_total, actual_total)
    if verbose:
        print(f"  Best blend weight on OUR model for total: {best_total_w} "
              f"(blended MAE {total_grid['total_mae'].min():.2f} pts, vs Vegas-only {vegas_total_mae:.2f})")
        print("\nRefitting final coefficients on FULL dataset (train + validation) for production...")
    else:
        print(f"\n  Best blend weight on OUR model - spread: {best_spread_w}, total: {best_total_w}, win-prob: {best_wp_w}")
        print("\nRefitting final coefficients on FULL dataset for production...")

    full_feats = make_features(dataset)
    final_coefs = fit(full_feats, dataset)

    return {
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "train_seasons": [int(s) for s in sorted(dataset["season"].unique())],
        "n_games_used": final_coefs["n_games"],
        "coefficients": final_coefs,
        "blend_weight_on_model_spread": best_spread_w,
        "blend_weight_on_model_winprob": best_wp_w,
        "blend_weight_on_model_total": best_total_w,
        "holdout_validation": {
            "seasons": [int(s) for s in holdout_seasons],
            "n_games": int(len(val_games)),
            "model_only_spread_mae": model_only_mae,
            "vegas_only_spread_mae": vegas_only_mae,
            "blended_spread_mae": float(best_row_spread["spread_mae"]),
            "model_only_total_mae": model_total_mae,
            "vegas_only_total_mae": vegas_total_mae,
            "blended_total_mae": float(total_grid["total_mae"].min()),
            "model_only_brier": model_only_brier,
            "vegas_only_brier": vegas_only_brier,
            "blended_brier": float(best_row_wp["brier_score"]),
        },
    }
