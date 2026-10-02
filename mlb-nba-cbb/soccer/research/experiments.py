"""
experiments.py - compares model recipes on whole finished seasons, walk-forward,
exactly as the season backtest in train.py scores the live recipe: Premier
League, La Liga and Champions League matches, with the bookmakers' closing
odds as the bar where they exist. Prints one table per season.

EXPERIMENTS env var: a JSON list of {"name", "recipe"} to try (default: the
built-in list below). SEASONS env var: comma-separated test seasons (default:
the last two finished ones).
"""

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train as T  # noqa: E402

M = T.M
BASE = {"half_life": 400, "reg": 10.0, "years": 3}
DEFAULT = [
    {"name": "baseline (goals only)", "recipe": BASE},
    {"name": "shots 0.3, pull 3", "recipe": {**BASE, "reg": 3.0, "xg": 0.3}},
    {"name": "home by comp", "recipe": {**BASE, "home_reg": 100.0}},
    {"name": "promoted -0.15", "recipe": {**BASE, "promoted": 0.15}},
    {"name": "draw +0.05", "recipe": {**BASE, "draw": 0.05}},
    {"name": "shots + home, pull 3", "recipe": M.DEFAULT_RECIPE},
    {"name": "shots + home, hl 550, pull 10", "recipe": {**BASE, "half_life": 550, "xg": 0.3, "home_reg": 100.0}},
]

_data = None


def run(args):
    exp, season = args
    data = _data
    idx = [i for i, m in enumerate(data.matches) if m["season"] == season and T.comp_of(m) in T.BACKTEST_COMPS]
    preds = T.walk(data, exp["recipe"], idx)
    out = {"all": T.evaluate(data, preds)}
    for c in T.BACKTEST_COMPS:
        rows = [(i, p) for i, p in preds if T.comp_of(data.matches[i]) == c]
        if rows:
            out[c] = T.evaluate(data, rows)
    return exp["name"], season, out


def line(name, s):
    b = s.get("book")
    return (f"| {name:<22} | {s['games']:>4} | {s['accuracy']:.1%} | {s['log_loss']:.4f} | "
            + (f"{b['accuracy']:.1%} | {b['log_loss']:.4f} | {b['model_log_loss']:.4f} |" if b else "  -   |   -    |   -    |"))


def main():
    global _data
    exps = json.loads(os.environ["EXPERIMENTS"]) if os.environ.get("EXPERIMENTS", "").strip() else DEFAULT
    _data = M.Data(T.store.load_matches())
    seasons = sorted({m["season"] for m in _data.matches})
    finished = [s for s in seasons if date.today().isoformat() >= f"{s + 1}-07-01"]
    tests = [int(s) for s in os.environ.get("SEASONS", "").split(",") if s.strip()] or finished[-2:]
    jobs = [(e, s) for s in tests for e in exps]
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        res = {(n, s): o for n, s, o in pool.map(run, jobs)}
    lines = []
    for s in tests:
        for comp in ("all",) + T.BACKTEST_COMPS:
            lines += ["", f"### {T.season_label(s)} - {T.COMP_NAMES.get(comp, 'Overall')}", "",
                      "| Recipe | n | Acc | Log loss | Book acc | Book LL | Model LL (odds games) |",
                      "|---|---|---|---|---|---|---|"]
            lines += [line(e["name"], res[(e["name"], s)][comp]) for e in exps if comp in res[(e["name"], s)]]
    T.summary(lines)
    print("JSON " + json.dumps({f"{n}|{s}": {c: {k: v for k, v in o[c].items() if k not in ("months", "bands")}
                                            for c in o} for (n, s), o in res.items()}))


if __name__ == "__main__":
    main()
