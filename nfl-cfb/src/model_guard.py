"""
model_guard.py
The weekly refit's safety net and memory, shared by fit_model.py (NFL) and
fit_cfb_model.py (CFB).

WHY: the Tuesday refit used to overwrite the coefficients every week no matter
what came out. That's fine while nothing changes, but it can't try anything
new without risking a worse model, and a bad week of source data would ship
straight to the site. This adds three things:

  1. A recipe search. A recipe is how the model is built rather than its
     coefficients: the recency half-life of the team form stats (how fast a
     team's numbers react to recent games) and how many seasons to fit on.
     Every candidate, including the live recipe, is fit on everything before
     the most recent `holdout_games` games and scored on those games by the
     Brier score of its own win probability. The recipe only changes when a
     candidate beats the live recipe by SWITCH_MARGIN.
  2. A sanity check before anything ships: finite coefficients, and the
     chosen recipe, fit WITHOUT those recent games, can't score worse on them
     than the model it replaces by more than SANITY_MARGIN. (The production
     refit itself trains on those games, so scoring it there would flatter
     it.) A failed check keeps the old file.
  3. data/tracking/model_history.json, one entry per refit: every candidate's
     score, what was kept or switched and why.

The refit also skips itself when no game has finished since the live model's
`trained_through` (the offseason), unless FORCE=1.
"""

import json
import math
import os
from datetime import datetime, timezone

import numpy as np
from scipy.stats import norm

HISTORY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "tracking", "model_history.json")
SWITCH_MARGIN = 0.002  # Brier score a new recipe must win by
# How much worse than the live model the chosen recipe may score on the recent
# games: run-to-run noise in model_history.json (live vs. same-recipe refit)
# is about 0.0002-0.0006 Brier, so 0.002 allows that and little more.
SANITY_MARGIN = 0.002
KEY = ["season", "week", "home_team", "away_team"]


def forced():
    return os.environ.get("FORCE", "").lower() in ("1", "true", "yes")


def load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def latest_gameday(dataset):
    return str(dataset["gameday"].astype(str).str[:10].max())


def nothing_new(current, dataset):
    """True when no game has finished since the live model was fit."""
    through = current.get("trained_through")
    return bool(through) and latest_gameday(dataset) <= through and not forced()


def holdout_keys(dataset, n):
    recent = dataset.assign(_day=dataset["gameday"].astype(str).str[:10]).sort_values("_day").tail(n)
    return set(map(tuple, recent[KEY].values))


def split(dataset, keys):
    in_holdout = np.array([tuple(k) in keys for k in dataset[KEY].values], dtype=bool)
    return dataset[~in_holdout], dataset[in_holdout]


def score(coefs, games, make_features, model_predict):
    """Brier score of the model's own win probability, spread MAE and pick
    accuracy on games (rows with a missing feature are skipped)."""
    feats = make_features(games)
    valid = feats.notna().all(axis=1).values
    if not valid.any():
        return None
    spread, _ = model_predict(feats[valid], coefs)
    spread = np.asarray(spread, dtype=float)
    wp = norm.cdf(spread / coefs["margin_std_dev"])
    won = games["home_won"].values[valid]
    margin = games["actual_margin"].values[valid]
    return {"games": int(valid.sum()), "brier": float(np.mean((wp - won) ** 2)),
            "spread_mae": float(np.mean(np.abs(spread - margin))),
            # A tie is a miss for the pick to win (house rule), even for an away pick.
            "accuracy": float(np.mean(((spread > 0) == (margin > 0)) & (margin != 0)))}


def search(recipes, current, dataset_for, window, fit, make_features, model_predict, holdout_games, name):
    """Scores every recipe on the most recent holdout_games games, each fit only
    on the games before them. Returns the chosen recipe and a report."""
    candidates = recipes + ([current] if current not in recipes else [])
    keys = holdout_keys(dataset_for(current), holdout_games)
    results = []
    for recipe in candidates:
        before, holdout = split(dataset_for(recipe), keys)
        train = window(recipe, before)
        if len(train) < 200:
            continue
        coefs = fit(make_features(train), train)
        s = score(coefs, holdout, make_features, model_predict)
        if s:
            results.append({"recipe": recipe, **s})
            print(f"  {name(recipe):<34} Brier {s['brier']:.4f}  spread MAE {s['spread_mae']:.2f}  "
                  f"picks {s['accuracy']:.1%} ({s['games']} games)")
    cur = next((r for r in results if r["recipe"] == current), None)
    best = min(results, key=lambda r: r["brier"]) if results else None
    switched = best is not None and (cur is None or (best["recipe"] != current
                                                     and best["brier"] < cur["brier"] - SWITCH_MARGIN))
    chosen = best["recipe"] if switched else current
    return chosen, {"keys": keys, "results": results, "current": cur, "best": best, "switched": switched}


def deploy_ok(new_coefs, live_coefs, live_recipe, chosen_recipe, dataset_for, make_features, model_predict, report):
    """Finite coefficients, and on the recent games the chosen recipe - as
    search() scored it, fit only on the games before them - isn't worse than
    the live model by more than SANITY_MARGIN (each with its own recipe's
    features). The full refit isn't scored there: it was trained on them."""
    if not all(math.isfinite(v) for v in new_coefs.values() if isinstance(v, (int, float))):
        return False, "the refit has non-finite coefficients", None, None
    keys = report["keys"]
    held_out = next((r for r in report["results"] if r["recipe"] == chosen_recipe), None)
    new = {k: v for k, v in held_out.items() if k != "recipe"} if held_out else None
    live = score(live_coefs, split(dataset_for(live_recipe), keys)[1], make_features, model_predict) if live_coefs else None
    if new is None:
        return False, "no recent games to check the refit on", new, live
    if live and new["brier"] > live["brier"] + SANITY_MARGIN:
        return False, "the refit scored worse than the live model on recent games", new, live
    return True, "", new, live


def weights_snapshot(model):
    """The fitted coefficients plus how far the pick leans on the model vs. the
    market, rounded - saved before and after each refit for the site's Model tab."""
    if not model or not model.get("coefficients"):
        return None
    out = {k: v for k, v in model["coefficients"].items() if k != "n_games"}
    out.update({k: v for k, v in model.items() if k.startswith("blend_weight_on_")})
    return {k: round(v, 4) for k, v in out.items() if isinstance(v, (int, float))}


def log_run(sport, current, report, deployed, reason, new, live, trained_through, extra=None):
    history = load_json(HISTORY_PATH) or {"runs": []}
    rnd = lambda s: {k: round(v, 4) if isinstance(v, float) else v for k, v in s.items()} if s else None  # noqa: E731
    history["runs"].append({
        "sport": sport,
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_through": trained_through,
        "holdout_games": len(report["keys"]),
        "live_recipe": current,
        "live_model_on_holdout": rnd(live),
        "current_recipe_refit_on_holdout": rnd(report["current"]),
        "best_candidate": rnd(report["best"]),
        "candidates": [rnd(r) for r in report["results"]],
        "switched_recipe": bool(report["switched"] and deployed),
        "deployed": deployed,
        "reason": reason,
        **(extra or {}),
    })
    os.makedirs(os.path.dirname(HISTORY_PATH), exist_ok=True)
    with open(HISTORY_PATH, "w") as f:
        json.dump(history, f, indent=1)


def log_skip(sport, reason, live):
    """A history entry for a refit that couldn't run because its data source
    was out (no key, quota used up, nothing returned), so the Model tab and
    Model Room show why the model wasn't updated instead of going quiet.
    Same fields as log_run, with nothing tested."""
    log_run(sport, live.get("recipe"), {"keys": (), "results": [], "current": None, "best": None,
                                       "switched": False},
            False, reason, None, None, live.get("trained_through"),
            {"skipped": True, "weights_before": weights_snapshot(live), "weights_after": weights_snapshot(live)})
    summary([f"### {sport.upper()} game model refit skipped", f"- {reason}"])


def summary(lines):
    text = "\n".join(lines)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text + "\n")
