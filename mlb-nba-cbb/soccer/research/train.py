"""
train.py - retrains Soccer Edge's match model, and only changes how it's
built when the change is proven on recent matches.

The daily run (predict.py) refits every club's ratings each morning from the
results so far, with the recipe saved in soccer/model_weights.json: how fast
old results fade (half_life, in days) and how hard a club is pulled toward its
league's average (reg). This script picks that recipe. Each run:

  1. Holds out the most recent HOLDOUT_MATCHES matches (every league).
  2. Scores every candidate recipe in RECIPES, and the live one, on the
     holdout walk-forward: the ratings are refitted each match day from only
     the results before it, exactly as the daily picks are made.
  3. Switches recipe only if the best candidate beats the live recipe's log
     loss by SWITCH_MARGIN; otherwise the live recipe stays.
  4. Saves it only if it passes deploy_ok() (it must beat the base rates of
     home wins, draws and away wins on the holdout, and never score worse
     than the live recipe). The saved model also carries a walk-forward
     backtest of the latest finished season (Premier League, La Liga and
     Champions League), with the bookmakers' closing odds as the bar.
  5. Appends what happened to soccer/model_history.json.

The daily workflow runs this after predict.py. It only retrains once a week,
and only once MIN_NEW_MATCHES have been played since the live model's last
training day. FORCE=1 skips both checks (the research workflow sets it).
"""

import json
import math
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import model as M  # noqa: E402
import store  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
import model_watch  # noqa: E402  (the repo root's cold-stretch check)

OUT = os.path.join(HERE, "model_weights.json")
HISTORY = os.path.join(HERE, "model_history.json")
PICKS = os.path.join(HERE, "picks_history.json")

HOLDOUT_MATCHES = 400  # about ten days of the ten leagues and the Champions League
MIN_NEW_MATCHES = 150
RETRAIN_EVERY_DAYS = 7
SWITCH_MARGIN = 0.002  # log loss a new recipe must win by
SANITY_MARGIN = 0.0    # the deployed recipe may never score worse than the live one
BACKTEST_COMPS = ("E0", "SP1", "UCL")
COMP_NAMES = {"E0": "Premier League", "SP1": "La Liga", "UCL": "Champions League"}
BANDS = [(0.0, 0.45), (0.45, 0.55), (0.55, 0.65), (0.65, 1.01)]

RECIPES = [{"half_life": h, "reg": r, "years": 3} for h in (120, 180, 270, 400) for r in (2.0, 5.0, 10.0)]


def comp_of(m):
    return m["league"] or "UCL"


def walk(data, recipe, idx):
    """Walk-forward predictions for the matches at indices idx: on each match
    day, ratings fitted on everything before it. [(index, probs)]."""
    by_day = defaultdict(list)
    for i in idx:
        by_day[int(data.ord[i])].append(i)
    out, warm = [], None
    for day in sorted(by_day):
        r = M.fit(data, day, recipe, warm=warm)
        if r is None:
            continue
        warm = r
        for i in by_day[day]:
            m = data.matches[i]
            p = r.probs(m["hk"], m["ak"], m.get("neutral"), m["league"])
            out.append((i, p))
    return out


def book_probs(odds):
    if not odds:
        return None
    inv = [1 / o for o in odds]
    s = sum(inv)
    return {"home": inv[0] / s, "draw": inv[1] / s, "away": inv[2] / s}


def evaluate(data, preds):
    rows = []
    for i, p in preds:
        m = data.matches[i]
        res = M.outcome(m["hg"], m["ag"])
        pick = M.pick_of(p)
        rows.append({"date": m["date"], "comp": comp_of(m), "p": p, "res": res, "pick": pick,
                     "conf": p[pick], "correct": pick == res, "book": book_probs(m.get("odds"))})
    return summarize(rows)


def summarize(rows):
    n = len(rows)
    if not n:
        return {}
    ll = -sum(math.log(max(1e-9, r["p"][r["res"]])) for r in rows) / n
    brier = sum(sum((r["p"][k] - (k == r["res"])) ** 2 for k in ("home", "draw", "away")) for r in rows) / n
    out = {
        "games": n,
        "correct": sum(r["correct"] for r in rows),
        "accuracy": round(sum(r["correct"] for r in rows) / n, 4),
        "predicted_accuracy": round(sum(r["conf"] for r in rows) / n, 4),
        "log_loss": round(ll, 4),
        "brier": round(brier, 4),
        "draw_picks": sum(r["pick"] == "draw" for r in rows),
        "draw_rate": round(sum(r["res"] == "draw" for r in rows) / n, 4),
    }
    with_book = [r for r in rows if r["book"]]
    if with_book:
        k = len(with_book)
        out["book"] = {
            "games": k,
            "log_loss": round(-sum(math.log(max(1e-9, r["book"][r["res"]])) for r in with_book) / k, 4),
            "model_log_loss": round(-sum(math.log(max(1e-9, r["p"][r["res"]])) for r in with_book) / k, 4),
            "accuracy": round(sum(M.pick_of(r["book"]) == r["res"] for r in with_book) / k, 4),
            "model_accuracy": round(sum(r["correct"] for r in with_book) / k, 4),
        }
    bands = []
    for lo, hi in BANDS:
        b = [r for r in rows if lo <= r["conf"] < hi]
        if b:
            bands.append({"range": [lo, min(hi, 1.0)], "n": len(b),
                          "predicted": round(sum(r["conf"] for r in b) / len(b), 4),
                          "actual": round(sum(r["correct"] for r in b) / len(b), 4)})
    out["bands"] = bands
    by_month = defaultdict(list)
    for r in rows:
        by_month[r["date"][:7]].append(r)
    out["months"] = [{"month": mo, "n": len(rs), "correct": sum(r["correct"] for r in rs),
                      "predicted": round(sum(r["conf"] for r in rs) / len(rs), 4)} for mo, rs in sorted(by_month.items())]
    return out


def raw_log_loss(data, preds):
    if not preds:
        return float("inf")
    return -sum(math.log(max(1e-9, p[M.outcome(data.matches[i]["hg"], data.matches[i]["ag"])])) for i, p in preds) / len(preds)


def season_label(s):
    return f"{s}-{str(s + 1)[2:]}"


def season_backtest(data, recipe):
    """Walk-forward over the latest finished season's Premier League, La Liga
    and Champions League matches, overall and by competition."""
    seasons = sorted({m["season"] for m in data.matches})
    finished = [s for s in seasons if date.today().isoformat() >= f"{s + 1}-07-01"]
    if len(finished) < 2:
        return {}
    test = finished[-1]
    idx = [i for i, m in enumerate(data.matches) if m["season"] == test and comp_of(m) in BACKTEST_COMPS]
    if not idx:
        return {}
    preds = walk(data, recipe, idx)
    rows_by_comp = defaultdict(list)
    for i, p in preds:
        rows_by_comp[comp_of(data.matches[i])].append((i, p))
    by_comp = {}
    for c in BACKTEST_COMPS:
        if rows_by_comp[c]:
            s = evaluate(data, rows_by_comp[c])
            by_comp[c] = {k: v for k, v in s.items() if k not in ("months", "bands")} | {"name": COMP_NAMES[c]}
    first = max(seasons[0], test - recipe["years"])
    return {
        "trained_on": f"{season_label(first)} to {season_label(seasons[-1])}",
        "backtest_season": season_label(test),
        "backtest": evaluate(data, preds),
        "backtest_by_comp": by_comp,
    }


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def live_record(days=14):
    picks = load(PICKS, {}).get("picks", [])
    since = (date.today() - timedelta(days=days)).isoformat()
    g = [p for p in picks if p["date"] >= since and p.get("correct") is not None and not p.get("void")]
    if not g:
        return None
    return {"days": days, "picks": len(g), "accuracy": round(sum(p["correct"] for p in g) / len(g), 4),
            "predicted": round(sum(p["prob"] for p in g) / len(g) / 100, 4)}


def deploy_ok(final, chosen_ll, live_ll, baseline_ll):
    """Checks before a recipe goes live: the ratings fit and are finite, it beats
    the plain base rates on matches it never saw, and it isn't worse than the
    recipe it replaces."""
    if final is None:
        return False, "too few matches to fit the ratings"
    vals = [final.mu, final.home, final.rho] + list(final.att) + list(final.dfn) + list(final.A) + list(final.D)
    if not all(math.isfinite(v) for v in vals):
        return False, "the fit has non-finite ratings"
    if not chosen_ll < baseline_ll:
        return False, "the chosen recipe didn't beat the base rates on held-out matches"
    if live_ll is not None and chosen_ll > live_ll + SANITY_MARGIN:
        return False, "the new recipe scored worse than the live one on recent matches"
    return True, ""


def coef(r):
    """The numbers the Model tab lists: home edge, draw correction, and each
    league's level (goal difference a match against an average side)."""
    out = {"home": round(math.exp(r.mu + r.home) - math.exp(r.mu), 4), "rho": round(r.rho, 4),
           "goals": round(math.exp(r.mu), 4)}
    out.update({f"league_{k}": round(v, 4) for k, v in r.league_strengths().items()})
    return out


def summary(lines):
    text = "\n".join(lines)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text + "\n")


def recipe_name(r):
    return f"half-life {r['half_life']} days, pull {r['reg']:g}, {r['years']} years"


def main():
    force = os.environ.get("FORCE", "").lower() in ("1", "true", "yes")
    slump = None if force else model_watch.early_retrain("soccer")
    if slump:
        print(model_watch.slump_text(slump).capitalize() + ".")
    live = load(OUT, {})
    history = load(HISTORY, {"runs": []})
    current = live.get("recipe", M.DEFAULT_RECIPE)

    matches = store.load_matches()
    if len(matches) < HOLDOUT_MATCHES + M.MIN_MATCHES:
        print(f"Only {len(matches)} stored matches; run the research pull first.")
        return
    latest = matches[-1]["date"]
    live_through = live.get("trained_through")
    new = sum(1 for m in matches if live_through is None or m["date"] > live_through)
    if not force and not slump:
        last_run = history["runs"][-1]["run_at"][:10] if history["runs"] else None
        if last_run and date.fromisoformat(last_run) > date.today() - timedelta(days=RETRAIN_EVERY_DAYS):
            print(f"Retrained {last_run}; next retrain once a week has passed.")
            return
        if new < MIN_NEW_MATCHES:
            print(f"{new} matches since the live model's last training day ({live_through}); waiting for {MIN_NEW_MATCHES}.")
            return

    data = M.Data(matches)
    # The holdout starts on a match day, so a day is never split.
    cut = len(matches) - HOLDOUT_MATCHES
    while cut > 0 and data.ord[cut - 1] == data.ord[cut]:
        cut -= 1
    holdout = list(range(cut, len(matches)))
    holdout_from = matches[cut]["date"]
    print(f"{len(matches)} matches through {latest}; holdout: last {len(holdout)} from {holdout_from}")

    before = matches[:cut]
    rates = {k: sum(M.outcome(m["hg"], m["ag"]) == k for m in before) / len(before) for k in ("home", "draw", "away")}
    baseline_ll = -float(np.mean([math.log(rates[M.outcome(matches[i]["hg"], matches[i]["ag"])]) for i in holdout]))

    candidates = RECIPES + ([current] if current not in RECIPES else [])
    results = []
    for recipe in candidates:
        preds = walk(data, recipe, holdout)
        ll = raw_log_loss(data, preds)
        results.append((recipe, preds, ll))
        print(f"  {recipe_name(recipe):<40} log loss {ll:.4f}")

    cur = next(t for t in results if t[0] == current)
    best = min(results, key=lambda t: t[2])
    switched = best[0] != current and best[2] < cur[2] - SWITCH_MARGIN
    chosen = best if switched else cur
    chosen_recipe = chosen[0]
    live_ll = cur[2] if live.get("recipe") else None

    final = M.fit(data, date.fromisoformat(latest).toordinal() + 1, chosen_recipe)
    ok, why = deploy_ok(final, chosen[2], live_ll, baseline_ll)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if ok:
        out = {k: v for k, v in live.items()} if not switched else {}
        out.update({
            "recipe": chosen_recipe,
            "coef": coef(final),
            "trained_at": now,
            "trained_through": latest,
            "training_matches": final.n_used,
            "training_dates": [d for d in (min((m["date"] for m in matches
                                                if (date.fromisoformat(latest) - date.fromisoformat(m["date"])).days
                                                < 365 * chosen_recipe["years"]), default=None), latest) if d],
            "recent_holdout": {"from": holdout_from, "games": len(holdout), "base_rate_log_loss": round(baseline_ll, 4),
                               **{k: v for k, v in evaluate(data, chosen[1]).items() if k not in ("months", "bands")}},
        })
        seasons = sorted({m["season"] for m in matches})
        finished = [s for s in seasons if date.today().isoformat() >= f"{s + 1}-07-01"]
        if switched or force or not out.get("backtest") or (finished and out.get("backtest_season") != season_label(finished[-1])):
            print("Running the season backtest...")
            out.update(season_backtest(data, chosen_recipe))
        with open(OUT, "w") as f:
            json.dump(out, f, indent=1)

    history["runs"].append({
        "run_at": now,
        "data_through": latest,
        "holdout": {"from": holdout_from, "games": len(holdout), "home_rate_log_loss": round(baseline_ll, 4)},
        "live_model": {"trained_at": live.get("trained_at"), "recipe": live.get("recipe", M.DEFAULT_RECIPE),
                       "holdout_log_loss": round(live_ll, 4) if live_ll is not None else None},
        "current_recipe_log_loss": round(cur[2], 4),
        "best_recipe": {"recipe": best[0], "log_loss": round(best[2], 4)},
        "candidates": [{"recipe": r, "log_loss": round(ll, 4)} for r, _, ll in results],
        "switched_recipe": bool(switched and ok),
        "deployed": ok,
        "reason": "; ".join(x for x in (
            model_watch.slump_text(slump) if slump else "",
            why or ("new recipe beat the live one on held-out matches" if switched
                    else "kept the recipe, refit with the newest matches")) if x),
        "trigger": "cold stretch" if slump else ("manual" if force else "weekly"),
        "live_picks_last_14_days": live_record(),
        "weights_before": live.get("coef"),
        "weights_after": coef(final) if ok else live.get("coef"),
    })
    with open(HISTORY, "w") as f:
        json.dump(history, f, indent=1)

    bt = load(OUT, {}).get("backtest") if ok else None
    summary([f"### Soccer model retrain ({latest})",
             f"- Holdout: last {len(holdout)} matches, from {holdout_from} (base rates log loss {baseline_ll:.4f})",
             f"- Live recipe ({recipe_name(current)}): log loss {cur[2]:.4f}",
             f"- Best candidate ({recipe_name(best[0])}): log loss {best[2]:.4f}",
             f"- Recipe: {'switched to ' + recipe_name(chosen_recipe) if switched else 'unchanged'}",
             f"- Deployed: {'yes, through ' + latest if ok else 'no - ' + why}"]
            + ([f"- Backtest {load(OUT, {}).get('backtest_season')}: {bt['accuracy']:.1%} top pick right, "
                f"log loss {bt['log_loss']:.4f}"
                + (f" vs closing odds {bt['book']['log_loss']:.4f} on {bt['book']['games']} matches" if bt.get("book") else "")]
               if bt else []))


if __name__ == "__main__":
    main()
