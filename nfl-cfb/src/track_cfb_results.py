"""
track_cfb_results.py
College football's version of track_results.py - same snapshot-then-grade
architecture and grading (track_common.py), pointed at the CFB-specific data
files instead of the NFL ones, with CFB's Friday-night line lock and ESPN
filling in final scores CFBD hasn't posted yet. See track_results.py's own
docstring for the full rationale.

Degrades gracefully: if cfb_game_predictions.csv doesn't exist yet (CFBD_API_KEY
not configured, or no games predicted this run), this exits without writing
anything rather than crashing the pipeline.
"""

import pandas as pd
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared"))
from fetch_cfb_data import current_cfb_season
import games as espn
import moneyline
import track_common
from track_common import KEY_COLS

PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "processed")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
os.makedirs(TRACKING_DIR, exist_ok=True)

LOG_PATH = os.path.join(TRACKING_DIR, "cfb_predictions_log.csv")
SUMMARY_PATH = os.path.join(TRACKING_DIR, "cfb_accuracy_summary.json")


def load_predictions_snapshot():
    preds_path = os.path.join(PROCESSED_DIR, "cfb_game_predictions.csv")
    if not os.path.exists(preds_path):
        return None
    games = pd.read_csv(preds_path)
    if games.empty:
        return None
    return track_common.load_predictions_snapshot(games, os.path.join(PROCESSED_DIR, "cfb_vegas_comparison.csv"))

def load_moneyline_snapshot():
    """This run's moneyline picks (see src/moneyline.py), keyed like the log."""
    return track_common.load_moneyline_snapshot(os.path.join(PROCESSED_DIR, "cfb_vegas_comparison.csv"))

def upsert_snapshot(log, snapshot):
    # Lines and predictions lock Friday at 9 PM ET for weekend games (at
    # kickoff for the rest).
    return track_common.upsert_snapshot(log, snapshot, friday_lock=True)

def espn_final_scores(log, scored):
    """Final scores from ESPN's scoreboard for logged games CFBD hasn't scored
    yet. CFBD can take hours (sometimes until the next day) to post a result,
    while ESPN has it the moment a game ends, so on a college football
    Saturday this is what lets results show up during the day. Keyed like
    the log; returns an empty frame when ESPN is unreachable."""
    cols = KEY_COLS + ["home_score", "away_score"]
    if log is None or log.empty or "gameday" not in log.columns:
        return pd.DataFrame(columns=cols)
    today = pd.Timestamp.now(tz="America/New_York").strftime("%Y-%m-%d")
    pending = log[log["gameday"].notna() & (log["gameday"].astype(str) <= today)]
    def key(r):
        return (int(r["season"]), int(r["week"]), r["home_team"], r["away_team"])
    have = {key(r) for _, r in scored.iterrows()}
    pending = pending[[key(r) not in have for _, r in pending.iterrows()]]
    if pending.empty:
        return pd.DataFrame(columns=cols)

    known = sorted(set(log["home_team"]) | set(log["away_team"]), key=len, reverse=True)

    def school(team):
        if team.get("location") in known:
            return team["location"]
        return next((k for k in known if team.get("name", "").startswith(k)), None)

    finals = {}
    for day in sorted(pending["gameday"].astype(str).unique()):
        params = dict(espn.SPORTS["cfb"]["params"], dates=day.replace("-", ""))
        data = espn._get(espn.ESPN + espn.SPORTS["cfb"]["path"] + "/scoreboard", params)
        for event in (data or {}).get("events", []):
            g = espn.parse(event)
            if not g or g["state"] != "post" or g["home"]["score"] is None or g["away"]["score"] is None:
                continue
            home, away = school(g["home"]), school(g["away"])
            if home and away:
                finals[(home, away)] = (g["home"]["score"], g["away"]["score"])

    rows = []
    for _, r in pending.iterrows():
        key = (r["home_team"], r["away_team"])
        if key in finals:
            h, a = finals[key]
        elif key[::-1] in finals:  # neutral site listed the other way round
            a, h = finals[key[::-1]]
        else:
            continue
        rows.append({**{c: r[c] for c in KEY_COLS}, "home_score": h, "away_score": a})
    print(f"  ESPN final scores filled in for {len(rows)} game(s) CFBD hasn't posted yet")
    return pd.DataFrame(rows, columns=cols)

def grade_completed_games(log):
    games_path = os.path.join(RAW_DIR, "cfb_games.csv")
    if os.path.exists(games_path):
        schedules = pd.read_csv(games_path)
        results = schedules[schedules["home_score"].notna() & schedules["away_score"].notna()][KEY_COLS + ["home_score", "away_score"]]
    else:  # no schedule this run: ESPN alone grades
        results = log[KEY_COLS].iloc[:0].assign(home_score=pd.Series(dtype=float), away_score=pd.Series(dtype=float))
    # CFBD wins when it has a score; ESPN fills in the games it hasn't posted yet.
    espn_results = espn_final_scores(log, results)
    if not espn_results.empty:
        espn_results = espn_results.astype({"season": results["season"].dtype, "week": results["week"].dtype}, errors="ignore")
        results = pd.concat([results, espn_results], ignore_index=True).drop_duplicates(KEY_COLS, keep="first")

    return track_common.grade(log, results, push_as_float=True)

def summarize(log):
    return track_common.summarize(log, current_cfb_season())

def main():
    print("Loading this run's CFB predictions to snapshot...")
    snapshot = load_predictions_snapshot()
    log = pd.read_csv(LOG_PATH) if os.path.exists(LOG_PATH) else None
    if snapshot is None:
        # Still grade what's already logged (ESPN has the scores), so results
        # keep coming in on a run with no new predictions.
        print("  No CFB predictions this run - grading the games already logged.")
        if log is None or log.empty:
            return
    else:
        # When this run's lines and picks were taken. upsert_snapshot only writes
        # games that haven't kicked off, so once a game starts this stays the
        # time its line and pick were locked in (shown on the site).
        snapshot["lines_set_at"] = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
        log = upsert_snapshot(log, snapshot)
        ml_snapshot = load_moneyline_snapshot()
        if ml_snapshot is not None:
            log = moneyline.lock_and_merge(log, ml_snapshot, KEY_COLS, friday_lock=True)
    print(f"  CFB tracking log now has {len(log)} predicted games total")

    print("Grading any CFB games whose results are now in...")
    log = grade_completed_games(log)
    log = moneyline.grade(log)
    print(f"  {int(log['actual_margin'].notna().sum())} games have a graded actual result")

    log.to_csv(LOG_PATH, index=False)

    summary = summarize(log)
    # This season's live moneyline record only (never backfill/past seasons).
    summary["moneyline"] = moneyline.summarize(log, current_cfb_season())
    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nSaved CFB tracking log to {LOG_PATH} and summary to {SUMMARY_PATH}")

if __name__ == "__main__":
    main()
