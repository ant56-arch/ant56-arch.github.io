"""
fit_td_model.py
Fits the anytime-TD model (src/td_model.py) and checks it before it ships.
Runs in the Tuesday refit next to fit_props_model.py.

  1. Pulls play-by-play for the last FIT_SEASONS seasons (the daily data only
     keeps three) and builds one row per player-game, every feature from
     games before that one.
  2. Backtest: fits on every season before the last full one and scores the
     last full season, against the old carries-times-TD-rate math. This is
     the check that a 60% player really scores about 60% of the time; it is
     saved with the coefficients and shown on the Model tab.
  3. Guard: fits on everything but the last HOLDOUT_WEEKS weeks played and
     scores those weeks. The new fit only replaces the live one if it isn't
     worse on them by more than SANITY_MARGIN (Brier).
  4. Final fit on every game, saved to src/models/fitted_td_coefficients.json
     with the xTD table it was built with.

Skips itself when no game has finished since the live fit, unless FORCE=1.
"""

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import td_model as m
from fetch_data import BASE, current_nfl_season
from model_guard import forced

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
FIT_SEASONS = 5
HOLDOUT_WEEKS = 4
SANITY_MARGIN = 0.002
PBP_COLS = m.PBP_COLUMNS


def load_pbp(seasons):
    local = os.path.join(RAW_DIR, "pbp_combined.parquet")
    frames, have = [], set()
    if os.path.exists(local):
        df = pd.read_parquet(local, columns=PBP_COLS)
        frames.append(df)
        have = set(df["season"].unique())
    for season in seasons:
        if season in have:
            continue
        url = f"{BASE}/pbp/play_by_play_{season}.csv.gz"
        print(f"  Fetching {url}")
        try:
            frames.append(pd.read_csv(url, usecols=PBP_COLS, compression="gzip", low_memory=False))
        except Exception as e:  # a missing season just shortens the history
            print(f"  Skipping {season}: {e}")
    pbp = pd.concat(frames, ignore_index=True)
    return pbp[pbp["season"].isin(seasons)]


def load_rosters(seasons):
    """Weekly rosters (team, position, game-day status) for every season."""
    cols = ["season", "week", "team", "gsis_id", "position", "status"]
    frames = []
    local = os.path.join(RAW_DIR, "rosters.parquet")
    have = set()
    if os.path.exists(local):
        df = pd.read_parquet(local, columns=cols)
        frames.append(df)
        have = set(df["season"].unique())
    for season in seasons:
        if season in have:
            continue
        try:
            frames.append(pd.read_csv(f"{BASE}/weekly_rosters/roster_weekly_{season}.csv", usecols=cols, low_memory=False))
        except Exception as e:
            print(f"  Skipping roster {season}: {e}")
    return pd.concat(frames, ignore_index=True)


def load_positions(rosters):
    """gsis_id -> RB/WR/TE/QB, from each player's most recent roster entry."""
    ro = rosters[["season", "week", "gsis_id", "position"]]
    current = os.path.join(RAW_DIR, "current_roster.csv")
    if os.path.exists(current):
        cur = pd.read_csv(current, usecols=["gsis_id", "position"], low_memory=False)
        ro = pd.concat([ro, cur.assign(season=9999, week=0)], ignore_index=True)
    ro = ro.dropna(subset=["gsis_id", "position"])
    return ro.sort_values(["season", "week"]).groupby("gsis_id")["position"].last().map(m.norm_position).to_dict()


def load_schedules(seasons):
    path = os.path.join(RAW_DIR, "schedules.csv")
    url = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
    s = pd.read_csv(url) if len(seasons) > 3 or not os.path.exists(path) else pd.read_csv(path)
    return s[s["season"].isin(seasons)]


def build_rows(seasons):
    pbp = load_pbp(seasons)
    opps = m.opportunities(pbp)
    table = m.xtd_table(opps)
    schedules, rosters = load_schedules(seasons), load_rosters(seasons)
    pg = m.add_quiet_games(m.player_games(m.add_xtd(opps, table)), rosters, schedules)
    rows = m.walkforward_rows(pg, load_positions(rosters), m.implied_points(schedules))
    return rows, table


def score(rows, coefs):
    return m.scores(m.prob_from_lambda(m.predict_lambda(rows, coefs)), rows["scored"])


def main():
    current = m.load_coefficients() or {}
    season = current_nfl_season()
    seasons = list(range(season - FIT_SEASONS, season + 1))
    print(f"Fitting the anytime-TD model on seasons {seasons[0]}-{seasons[-1]}...")
    rows, table = build_rows(seasons)
    rows = rows.sort_values(["season", "week"]).reset_index(drop=True)
    latest = f"{int(rows['season'].max())}-{int(rows[rows['season'] == rows['season'].max()]['week'].max()):02d}"
    if current.get("trained_through") == latest and not forced():
        print(f"  No new games since {latest}; keeping the live fit.")
        return
    print(f"  {len(rows):,} player-games, {rows['scored'].mean():.1%} scored")

    # Backtest on the last full season
    test_season = int(rows["season"].max()) - (1 if rows["season"].max() == season else 0)
    train, test = rows[rows["season"] < test_season], rows[rows["season"] == test_season]
    bt = m.fit_poisson(train)
    p_new = m.prob_from_lambda(m.predict_lambda(test, bt))
    p_old = m.prob_from_lambda(test["old_lambda"])
    test = test.assign(p=p_new)
    top = test.sort_values("p", ascending=False).groupby(["season", "week"]).head(10)
    backtest = {
        "season": test_season, "trained_on": f"{int(train['season'].min())}-{test_season - 1}",
        "new": m.scores(p_new, test["scored"]), "old": m.scores(p_old, test["scored"]),
        "calibration": m.calibration(p_new, test["scored"]),
        "top10_weekly": {"n": int(len(top)), "predicted": round(float(top["p"].mean()), 3),
                          "actual": round(float(top["scored"].mean()), 3)},
    }
    print(f"  Backtest {test_season}: Brier {backtest['new']['brier']:.4f} vs old math {backtest['old']['brier']:.4f}; "
          f"weekly top 10 predicted {backtest['top10_weekly']['predicted']:.0%}, scored {backtest['top10_weekly']['actual']:.0%}")

    # Guard on the most recent weeks
    keys = rows[["season", "week"]].drop_duplicates().tail(HOLDOUT_WEEKS)
    recent = rows.merge(keys, on=["season", "week"])
    before = rows[(rows["season"] < keys["season"].iloc[0]) |
                  ((rows["season"] == keys["season"].iloc[0]) & (rows["week"] < keys["week"].iloc[0]))]
    candidate = m.fit_poisson(before)
    cand = score(recent, candidate)
    live = score(recent, current["coefficients"]) if current.get("coefficients") else None
    print(f"  Last {HOLDOUT_WEEKS} weeks: refit Brier {cand['brier']:.4f}"
          + (f", live {live['brier']:.4f}" if live else ""))
    coefs = m.fit_poisson(rows)
    if not all(np.isfinite(v) for v in coefs.values()):
        print("  Refit produced non-finite coefficients; keeping the live fit.")
        return
    if live and cand["brier"] > live["brier"] + SANITY_MARGIN:
        print("  Refit scores worse on recent weeks; keeping the live fit.")
        return

    out = {
        "coefficients": coefs, "features": m.FEATURES, "xtd_table": table,
        "trained_through": latest, "fit_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "n_player_games": int(len(rows)), "backtest": backtest,
        "recent_holdout": {"weeks": HOLDOUT_WEEKS, "refit": cand, "live": live},
    }
    with open(m.COEFFICIENTS_PATH, "w") as f:
        json.dump(out, f, indent=2)
    print(f"  Saved {m.COEFFICIENTS_PATH}: " + ", ".join(f"{k} {v:+.3f}" for k, v in coefs.items()))


if __name__ == "__main__":
    main()
