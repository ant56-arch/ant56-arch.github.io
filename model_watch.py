"""
model_watch.py - spots a model on a cold stretch.

For every sport it takes the most recent live picks (never the backtest) and
compares how many won with how many the model itself expected to win: the sum
of its win chances for game picks, or the top-10 hit rate it scored on held-out
games for MLB hitters. A stretch that falls short by more than Z_ALARM standard
deviations - worse than roughly 1 run in 40 of plain bad luck - is an alarm.

An alarm does two things:
  - The retrain scripts ask early_retrain() and, when it says so, retrain now
    instead of waiting for their weekly turn (the usual promote-only-if-better
    checks still decide what goes live). At most once every EARLY_GAP_DAYS.
  - model_watch.json records when each alarm started and cleared, and a daily
    routine tells Anthony in the project thread.

NFL and CFB already refit after every week of games, so for them an alarm is
only a heads-up.

Run from the repo root or mlb-nba-cbb/ (daily.yml does, after grading):
  python model_watch.py            # write model_watch.json
  python model_watch.py --due mlb_hits   # prints "yes" if MLB hitters should retrain early
"""

import csv
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
MLB = os.path.join(ROOT, "mlb-nba-cbb")
TRACKING = os.path.join(ROOT, "nfl-cfb", "data", "tracking")
OUT = os.path.join(ROOT, "model_watch.json")

Z_ALARM = -2.0
EARLY_GAP_DAYS = 3  # an early retrain waits this long after the last retrain
HITTER_TOP_N = 10
HITTER_DEFAULT_RATE = 0.70

# window: how many of the latest graded picks to judge (about a week of games,
# two to three for football, which plays less often).
SPORTS = {
    "mlb_hits": {"label": "MLB hitters", "window": 70, "history": os.path.join(MLB, "model_history.json")},
    "mlb_games": {"label": "MLB games", "window": 60, "history": os.path.join(MLB, "teams", "model_history.json")},
    "nba": {"label": "NBA", "window": 50, "history": os.path.join(MLB, "nba", "model_history.json")},
    "nhl": {"label": "NHL", "window": 50, "history": os.path.join(MLB, "nhl", "model_history.json")},
    "cbb": {"label": "College basketball", "window": 150, "history": os.path.join(MLB, "cbb", "model_history.json")},
    "soccer": {"label": "Soccer", "window": 60, "history": os.path.join(MLB, "soccer", "model_history.json")},
    "nfl": {"label": "NFL", "window": 30, "history": None},
    "cfb": {"label": "College football", "window": 60, "history": None},
}


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ── live picks as (date, chance the model gave, won) ─────────────────────────
def game_picks(folder):
    picks = load(os.path.join(MLB, folder, "picks_history.json"), {}).get("picks", [])
    return [(p["date"], p["prob"] / 100, bool(p["correct"])) for p in picks
            if p.get("correct") is not None and not p.get("void")]


def hitter_rate():
    runs = load(SPORTS["mlb_hits"]["history"], {}).get("runs", [])
    for r in reversed(runs):
        rate = ((r.get("live_model") or {}).get("holdout") or {}).get("top10_hit_rate")
        if rate:
            return rate
    return HITTER_DEFAULT_RATE


def hitter_picks():
    picks = load(os.path.join(MLB, "picks_history.json"), {}).get("picks", [])
    by_day = {}
    for p in picks:
        if p.get("got_hit") is not None:
            by_day.setdefault(p["date"], []).append(p)
    rate = hitter_rate()
    rows = []
    for d in sorted(by_day):
        top = sorted(by_day[d], key=lambda p: -p.get("confidence", 0))[:HITTER_TOP_N]
        rows += [(d, rate, bool(p["got_hit"])) for p in top]
    return rows


def football_picks(name):
    path = os.path.join(TRACKING, name)
    if not os.path.exists(path):
        return []
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            try:
                if int(r["season"]) < 2026 or r.get("model_correct_pick") in ("", None):
                    continue  # live tracking began in 2026; earlier rows are backfill
                p_home = float(r["model_home_win_prob"])
                rows.append((r["gameday"], max(p_home, 1 - p_home), float(r["model_correct_pick"]) == 1))
            except (KeyError, ValueError):
                continue
    return sorted(rows)


LOADERS = {
    "mlb_hits": hitter_picks,
    "mlb_games": lambda: game_picks("teams"),
    "nba": lambda: game_picks("nba"),
    "nhl": lambda: game_picks("nhl"),
    "cbb": lambda: game_picks("cbb"),
    "soccer": lambda: game_picks("soccer"),
    "nfl": lambda: football_picks("predictions_log.csv"),
    "cfb": lambda: football_picks("cfb_predictions_log.csv"),
}


# ── the check ────────────────────────────────────────────────────────────────
def last_retrain(key):
    path = SPORTS[key]["history"]
    runs = load(path, {}).get("runs", []) if path else []
    return runs[-1]["run_at"][:10] if runs else None


def status(key):
    """How the latest window of live picks did against what the model expected."""
    rows = sorted(LOADERS[key](), key=lambda r: r[0])[-SPORTS[key]["window"]:]
    n = len(rows)
    won = sum(1 for r in rows if r[2])
    expected = sum(r[1] for r in rows)
    var = sum(r[1] * (1 - r[1]) for r in rows)
    z = (won - expected) / math.sqrt(var) if var > 0 else 0.0
    return {
        "label": SPORTS[key]["label"], "picks": n, "won": won, "expected": round(expected, 1),
        "z": round(z, 2), "from": rows[0][0] if rows else None, "through": rows[-1][0] if rows else None,
        "alarm": n >= SPORTS[key]["window"] and z <= Z_ALARM,
        "last_retrain": last_retrain(key),
    }


def early_retrain(key, today=None):
    """The alarm's numbers if this sport should retrain now, else None."""
    s = status(key)
    if not s["alarm"] or not SPORTS[key]["history"]:
        return None
    today = today or date.today()
    last = s["last_retrain"]
    if last and date.fromisoformat(last) > today - timedelta(days=EARLY_GAP_DAYS):
        return None
    return s


def slump_text(s):
    """One line for the retrain log."""
    return (f"early retrain after a cold stretch: the last {s['picks']} picks won {s['won']}, "
            f"the model expected about {s['expected']:.0f}")


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--due":
        print("yes" if early_retrain(sys.argv[2]) else "no")
        return
    old = load(OUT, {}).get("sports", {})
    today = date.today().isoformat()
    sports = {}
    for key in SPORTS:
        s = status(key)
        prev = old.get(key, {})
        s["alarm_since"] = (prev.get("alarm_since") or today) if s["alarm"] else None
        s["cleared_on"] = today if prev.get("alarm") and not s["alarm"] else (
            prev.get("cleared_on") if not s["alarm"] else None)
        s["early_retrain"] = bool(s["alarm"] and early_retrain(key))
        sports[key] = s
        flag = "ALARM" if s["alarm"] else "ok"
        print(f"{s['label']}: {flag} - last {s['picks']} picks won {s['won']}, expected {s['expected']} (z {s['z']})")
    with open(OUT, "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "z_alarm": Z_ALARM,
                   "sports": sports}, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
