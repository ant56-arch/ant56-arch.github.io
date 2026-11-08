"""
track_common.py
The snapshot-then-grade logic behind both football trackers
(track_results.py for the NFL, track_cfb_results.py for CFB): reading this
run's predictions, writing them into the log until the game locks, grading
finished games, and the accuracy summary. See track_results.py's docstring
for the rationale. Each sport passes its own files, lock rule and season.

Grading follows the house rule for both sports: a tie counts as half a win
for the Brier score and as a miss for our pick to win (we picked a winner;
nobody won), while the spread and the moneyline treat it as a push, as the
books do.
"""

import os

import numpy as np
import pandas as pd

import moneyline

KEY_COLS = ["season", "week", "home_team", "away_team"]
LAST_N_WEEKS = 4

def load_predictions_snapshot(games, comparison_path):
    """This run's game predictions (a game_predictions.csv frame) joined to
    the Vegas numbers in comparison_path, renamed to the log's columns."""
    vegas_cols = ["home_team", "away_team", "vegas_home_favored_by", "total_line", "vegas_home_win_prob"]
    if os.path.exists(comparison_path):
        comparison = pd.read_csv(comparison_path)
        comparison = comparison[[c for c in vegas_cols if c in comparison.columns]].drop_duplicates(["home_team", "away_team"])
        games = games.merge(comparison, on=["home_team", "away_team"], how="left")
    for c in vegas_cols[2:]:
        if c not in games.columns:
            games[c] = np.nan

    if "game_type" not in games.columns:
        games["game_type"] = np.nan

    snapshot = games[KEY_COLS + [
        "gameday", "game_type", "model_spread", "model_total", "model_home_win_prob",
        "projected_spread", "projected_total", "home_win_prob",
        "vegas_home_favored_by", "total_line", "vegas_home_win_prob",
    ]].copy()
    return snapshot.rename(columns={
        "projected_spread": "sharp_spread", "projected_total": "sharp_total", "home_win_prob": "sharp_home_win_prob",
        "total_line": "vegas_total",
    })

def load_moneyline_snapshot(path):
    """This run's moneyline picks (see src/moneyline.py), keyed like the log.
    Written into the log by moneyline.lock_and_merge, which skips any game
    whose kickoff has already passed - the pick and price lock at kickoff."""
    if not os.path.exists(path):
        return None
    comparison = pd.read_csv(path)
    if comparison.empty or "ml_pick_side" not in comparison.columns:
        return None
    return comparison[[c for c in KEY_COLS + moneyline.ML_COLS if c in comparison.columns]].drop_duplicates(KEY_COLS)

def upsert_snapshot(log, snapshot, friday_lock=False):
    """Write this run's snapshot into the log. Lines and predictions lock at
    kickoff (CFB: Friday 9 PM ET for weekend games, see
    moneyline.kicked_off): a locked game keeps what was logged before, so a
    later run can't swap in new or live odds or a refit model's number."""
    if log is None or log.empty:
        return snapshot

    started = log.loc[moneyline.kicked_off(log, friday_lock=friday_lock), KEY_COLS]
    locked = pd.MultiIndex.from_frame(started) if not started.empty else None
    log = log.set_index(KEY_COLS)
    snapshot_indexed = snapshot.set_index(KEY_COLS)
    if locked is not None:
        snapshot_indexed = snapshot_indexed[~snapshot_indexed.index.isin(locked)]
    # A run that didn't fetch odds (or a game the feed dropped) has no line:
    # keep the line and market numbers already logged rather than blank them.
    if "vegas_home_favored_by" in snapshot_indexed.columns and "vegas_home_favored_by" in log.columns:
        no_line = snapshot_indexed["vegas_home_favored_by"].isna() & snapshot_indexed.index.isin(log.index)
        market = [c for c in snapshot_indexed.columns if c.startswith(("vegas_", "sharp_"))]
        if no_line.any() and market:
            snapshot_indexed = snapshot_indexed.copy()
            prior = log.reindex(snapshot_indexed.index[no_line])
            for c in market:
                if c in prior.columns:
                    snapshot_indexed.loc[no_line, c] = prior[c].values
    log = log.reindex(log.index.union(snapshot_indexed.index))
    for col in snapshot_indexed.columns:
        if col not in log.columns:
            # Match the new column's dtype (e.g. game_type is a string column,
            # not float) - a bare `np.nan` always creates a float64 column,
            # and pandas 2.x raises rather than silently widening it back to
            # object/string when we then assign real string values into it.
            log[col] = pd.Series(index=log.index, dtype=snapshot_indexed[col].dtype)
        log.loc[snapshot_indexed.index, col] = snapshot_indexed[col]
    return log.reset_index()

def grade(log, results, push_as_float=False):
    """Fill in the final score from results (KEY_COLS + home_score,
    away_score) and every per-game error and pick result. push_as_float:
    write the *_ats_push flags as 1.0/0.0 (CFB's log) rather than True/False
    (the NFL log's) - on a first-ever grade the column comes back from the
    CSV as all-NaN float64, and pandas refuses to write bools into it."""
    log = log.drop(columns=[c for c in ["home_score", "away_score"] if c in log.columns])
    log = log.merge(results, on=KEY_COLS, how="left")

    graded = log["home_score"].notna()
    if not graded.any():
        # Nothing graded yet - bail out rather than let the loop below run
        # its .loc[graded, ...] assignments against an all-False mask:
        # pandas' empty-selection assignment into a column reloaded from CSV
        # with a different dtype than the fresh in-memory value can raise
        # (TypeError: Invalid value '[]' for dtype ...) even though logically
        # nothing needs to change, since it goes through the same
        # dtype-compatibility check as a real assignment.
        return log
    log.loc[graded, "actual_margin"] = log.loc[graded, "home_score"] - log.loc[graded, "away_score"]
    log.loc[graded, "actual_total"] = log.loc[graded, "home_score"] + log.loc[graded, "away_score"]
    # A tie counts as half a win for the Brier score, and as a miss for our
    # pick to win (we picked a winner; nobody won). Moneyline and spread
    # grading treat it as a push, as the books do.
    home_won = (log["actual_margin"] > 0).astype(float).where(log["actual_margin"] != 0, 0.5)
    tie = log["actual_margin"] == 0

    for label, spread_col, total_col, wp_col in [
        ("model", "model_spread", "model_total", "model_home_win_prob"),
        ("sharp", "sharp_spread", "sharp_total", "sharp_home_win_prob"),
        ("vegas", "vegas_home_favored_by", "vegas_total", "vegas_home_win_prob"),
    ]:
        # Straight-up: did the favored team win the game outright?
        # No line (a Vegas row without one) is no pick: left ungraded.
        # A line rounded to 0.0 (a pick'em) goes to the side the win chance
        # favors, the same side the site and the Model Room show as our pick.
        picked_home = (log[spread_col] > 0) | ((log[spread_col] == 0) & (log[wp_col] > 0.5))
        picked_home_won = picked_home == (log["actual_margin"] > 0)
        log.loc[graded, f"{label}_correct_pick"] = (picked_home_won[graded].astype(float).where(~tie[graded], 0.0)
                                                    .where(log.loc[graded, spread_col].notna()))
        log.loc[graded, f"{label}_spread_error"] = (log[spread_col] - log["actual_margin"]).abs()[graded]
        log.loc[graded, f"{label}_total_error"] = (log[total_col] - log["actual_total"]).abs()[graded]
        log.loc[graded, f"{label}_brier"] = ((log[wp_col] - home_won) ** 2)[graded]

        # Against the spread, always against the VEGAS line (the same grading
        # as the site's spread picks, build_site.spread_result): model/sharp
        # take the home side when their spread is above Vegas's, the away side
        # when below, and have no ATS pick when they match it. Vegas's own row
        # grades its favorite. cover_margin > 0 means the home team beat the
        # line, == 0 is a push (excluded from the win/loss count, tracked
        # separately - the standard way ATS records are reported). No Vegas
        # line: nothing to grade.
        # (Before 2026-11-03 model/sharp were graded against their OWN spread,
        # which isn't a bet anyone could make; the Model Room's ATS record
        # changes when the log is next regraded.)
        vegas_line = log["vegas_home_favored_by"]
        cover_margin = log["actual_margin"] - vegas_line
        home_covered = cover_margin > 0
        if label == "vegas":
            side_home, has_pick = vegas_line >= 0, vegas_line.notna()
        else:
            side_home = log[spread_col] > vegas_line
            has_pick = vegas_line.notna() & log[spread_col].notna() & (log[spread_col] != vegas_line)
        push = (cover_margin == 0) & has_pick
        picked_covered = side_home == home_covered
        log.loc[graded, f"{label}_ats_push"] = push[graded].astype(float) if push_as_float else push[graded]
        decided = graded & has_pick & ~push
        log.loc[graded & ~decided, f"{label}_ats_correct"] = np.nan
        if decided.any():
            log.loc[decided, f"{label}_ats_correct"] = picked_covered[decided].astype(float)

    return log

def summarize(log, current_season):
    """
    "all_time" keeps the full graded history (including the 2024-2025 NFL
    backfill) for internal/backend reference, but the site only ever shows
    "current_season" and "last_N_weeks" - both scoped to the live season,
    since the point of the tracker going forward is "how are we doing THIS
    season," not diluting that with the backfilled seed data.
    """
    graded = log[log["actual_margin"].notna()].copy()
    if graded.empty:
        return {"n_graded_games": 0}

    graded = graded.sort_values(["season", "week"])
    this_season = graded[graded["season"] == current_season]

    distinct_weeks = this_season[["season", "week"]].drop_duplicates().sort_values(["season", "week"])
    recent_weeks = pd.MultiIndex.from_frame(distinct_weeks.tail(LAST_N_WEEKS))
    recent_mask = pd.MultiIndex.from_frame(this_season[["season", "week"]]).isin(recent_weeks)

    summary = {
        "n_graded_games": int(len(graded)),
        "current_season_year": current_season,
        "last_updated": pd.Timestamp.now("UTC").isoformat(),
    }
    windows = {
        "all_time": graded,
        "current_season": this_season,
        f"last_{LAST_N_WEEKS}_weeks": this_season[recent_mask],
    }

    for window_name, window_df in windows.items():
        if window_df.empty:
            continue
        window_summary = {}
        for label in ["model", "sharp", "vegas"]:
            wins = int(window_df[f"{label}_correct_pick"].sum())
            losses = int(window_df[f"{label}_correct_pick"].notna().sum()) - wins  # an ungraded pick isn't a loss

            # Against the spread: pushes are decided-neither-way, so they
            # come out of the win/loss denominator (the standard way an ATS
            # record is reported, e.g. "9-6-1") rather than counting as a loss.
            ats_col = f"{label}_ats_correct"
            push_col = f"{label}_ats_push"
            ats_decided = window_df[ats_col].notna() if ats_col in window_df.columns else pd.Series(False, index=window_df.index)
            ats_wins = int(window_df.loc[ats_decided, ats_col].sum())
            ats_losses = int(ats_decided.sum()) - ats_wins
            ats_pushes = int(window_df[push_col].sum()) if push_col in window_df.columns else 0
            ats_record = f"{ats_wins}-{ats_losses}" + (f"-{ats_pushes}" if ats_pushes else "")

            window_summary[label] = {
                "wins": wins,
                "losses": losses,
                "record": f"{wins}-{losses}",
                "pick_accuracy": round(float(window_df[f"{label}_correct_pick"].mean()), 3),
                "spread_mae": round(float(window_df[f"{label}_spread_error"].mean()), 2),
                "total_mae": round(float(window_df[f"{label}_total_error"].mean()), 2),
                "brier_score": round(float(window_df[f"{label}_brier"].mean()), 4),
                "n_games": int(len(window_df)),
                "ats_wins": ats_wins,
                "ats_losses": ats_losses,
                "ats_pushes": ats_pushes,
                "ats_record": ats_record,
                "ats_accuracy": round(ats_wins / (ats_wins + ats_losses), 3) if (ats_wins + ats_losses) > 0 else None,
            }
        summary[window_name] = window_summary
    return summary
