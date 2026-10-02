"""
pull_seasons.py - pulls every Division I regular-season and postseason game of
the given college basketball seasons from ESPN, with team box scores, for
training and backtesting.

SEASONS env var: comma-separated season end years (2026 = the 2025-26
season). Default: the last three finished seasons. Writes
cbb/data/seasons/<year>.json (see store.py).
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import espn  # noqa: E402
import store  # noqa: E402


def default_seasons():
    today = date.today()
    latest_done = today.year if today.month >= 5 else today.year - 1
    return [latest_done - 2, latest_done - 1, latest_done]


def season_days(end_year):
    d, last = date(end_year - 1, 10, 25), date(end_year, 4, 15)
    while d <= last:
        yield d.isoformat()
        d += timedelta(days=1)


def day_games(day):
    try:
        return espn.scoreboard(day)
    except Exception as e:
        print(f"  scoreboard {day} failed: {e}")
        return []


def main():
    seasons = [int(s) for s in os.environ.get("SEASONS", "").split(",") if s.strip()] or default_seasons()
    print(f"Pulling seasons {seasons}")
    days = [d for s in seasons for d in season_days(s)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        per_day = list(pool.map(day_games, days))
    games = {}
    for day in per_day:
        for g in day:
            if g["final"] and g["home_pts"] is not None:
                games[g["id"]] = g
    games = sorted(games.values(), key=lambda g: (g["start"], g["id"]))
    print(f"{len(games)} final games")
    for s in seasons:
        n = sum(1 for g in games if g["season"] == s)
        print(f"  {s}: {n} games")

    def box(g):
        try:
            return g["id"], espn.boxscore(g["id"])
        except Exception as e:
            print(f"  box score {g['id']} failed: {e}")
            return g["id"], None

    with ThreadPoolExecutor(max_workers=8) as pool:
        boxes = {gid: b for gid, b in pool.map(box, games) if b}
    print(f"{len(boxes)} box scores")

    for s in seasons:
        sg = [g for g in games if g["season"] == s]
        if sg:
            store.save_season(s, sg, {g["id"]: boxes[g["id"]] for g in sg if g["id"] in boxes})



if __name__ == "__main__":
    main()
