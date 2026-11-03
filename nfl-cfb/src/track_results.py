"""
track_results.py
Keeps a running, git-committed history of every prediction we've ever sent,
and grades it the moment the actual result shows up in schedules.csv. This is
the only way to know whether changes to the model make it sharper or not -
projecting confidently and never checking the scoreboard is how the original
version of this project ended up with un-backtested constants for years.

Two responsibilities each run:
  1. SNAPSHOT - record this run's upcoming-game predictions (model-only,
     market-blended "sharp", and the Vegas line at prediction time) into
     data/tracking/predictions_log.csv, keyed by (season, week, home_team,
     away_team). Re-running later in the same week (e.g. Tue -> Fri) updates
     that game's snapshot in place, so we always keep the LAST snapshot
     before kickoff - the fairest comparison against Vegas' closing line.
  2. GRADE - for any previously-logged game whose actual result has since
     appeared in schedules.csv, fill in the outcome and compute per-game
     error metrics for the model, the blended "sharp" line, and Vegas itself,
     so accuracy_summary.json can show head-to-head whether we're closing
     the gap on the market or not.

data/tracking/ is committed to git (unlike data/raw/ and data/processed/,
which are regenerated fresh every run) specifically so this history survives
the ephemeral GitHub Actions runner - see the workflow's "commit tracking
data" step.
"""

import pandas as pd
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fetch_data import current_nfl_season
import moneyline
import track_common
from track_common import KEY_COLS

PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "processed")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
os.makedirs(TRACKING_DIR, exist_ok=True)

LOG_PATH = os.path.join(TRACKING_DIR, "predictions_log.csv")
SUMMARY_PATH = os.path.join(TRACKING_DIR, "accuracy_summary.json")


def load_predictions_snapshot():
    games = pd.read_csv(os.path.join(PROCESSED_DIR, "game_predictions.csv"))
    return track_common.load_predictions_snapshot(games, os.path.join(PROCESSED_DIR, "vegas_comparison.csv"))

def load_moneyline_snapshot():
    """This run's moneyline picks (see src/moneyline.py), keyed like the log."""
    return track_common.load_moneyline_snapshot(os.path.join(PROCESSED_DIR, "vegas_comparison.csv"))

def upsert_snapshot(log, snapshot):
    # Lines and predictions lock at kickoff: a game already under way (or
    # over) keeps what was logged before it started.
    return track_common.upsert_snapshot(log, snapshot)

def grade_completed_games(log):
    schedules = pd.read_csv(os.path.join(RAW_DIR, "schedules.csv"))
    results = schedules[schedules["result"].notna()][KEY_COLS + ["home_score", "away_score"]]
    return track_common.grade(log, results)

def summarize(log):
    return track_common.summarize(log, current_nfl_season())

def main():
    print("Loading this run's predictions to snapshot...")
    snapshot = load_predictions_snapshot()

    log = pd.read_csv(LOG_PATH) if os.path.exists(LOG_PATH) else None
    # When this run's lines and picks were taken. upsert_snapshot only writes
    # games that haven't kicked off, so once a game starts this stays the
    # time its line and pick were locked in (shown on the site).
    snapshot["lines_set_at"] = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    log = upsert_snapshot(log, snapshot)
    ml_snapshot = load_moneyline_snapshot()
    if ml_snapshot is not None:
        log = moneyline.lock_and_merge(log, ml_snapshot, KEY_COLS)
    print(f"  Tracking log now has {len(log)} predicted games total")

    print("Grading any games whose results are now in...")
    log = grade_completed_games(log)
    log = moneyline.grade(log)
    print(f"  {int(log['actual_margin'].notna().sum())} games have a graded actual result")

    log.to_csv(LOG_PATH, index=False)

    summary = summarize(log)
    # This season's live moneyline record only (never backfill/past seasons).
    summary["moneyline"] = moneyline.summarize(log, current_nfl_season())
    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    if summary.get("n_graded_games", 0) > 0:
        year = summary.get("current_season_year")
        current = summary.get("current_season", {})
        all_time = summary.get("all_time", {})
        if current:
            print(f"\n{year} season accuracy (us vs the market):")
            for label in ["model", "sharp", "vegas"]:
                s = current.get(label, {})
                if s:
                    ats = f"{s['ats_record']} ({s['ats_accuracy']:.1%}) ATS" if s["ats_accuracy"] is not None else "no ATS decisions yet"
                    print(f"  {label:>6}: {s['record']} ({s['pick_accuracy']:.1%}) straight-up | {ats} | "
                          f"spread MAE {s['spread_mae']:.2f} | total MAE {s['total_mae']:.2f} | Brier {s['brier_score']:.4f}")
        else:
            print(f"\nNo {year} games graded yet.")
        print(f"\nAll-time (including backfill), {all_time.get('sharp', {}).get('n_games', 0)} games:")
        for label in ["model", "sharp", "vegas"]:
            s = all_time.get(label, {})
            if s:
                ats = f"{s['ats_record']} ({s['ats_accuracy']:.1%}) ATS" if s["ats_accuracy"] is not None else "no ATS decisions yet"
                print(f"  {label:>6}: {s['record']} ({s['pick_accuracy']:.1%}) straight-up | {ats}")

    print(f"\nSaved tracking log to {LOG_PATH} and summary to {SUMMARY_PATH}")

if __name__ == "__main__":
    main()
