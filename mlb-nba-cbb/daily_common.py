"""
daily_common.py - what the team sports' daily runs (nba/, nhl/, cbb/, teams/
and soccer/ predict.py) share: reading and writing their JSON files, the
day-by-day score sync, grading picks from final scores, and the moneyline
helpers. What differs by sport (seasons, pick making, soccer's draws, CBB's
ratings) stays in each sport's predict.py.
"""

import json
import os
from datetime import date, timedelta

import moneyline


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def save(path, data, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, **kw)


def season_of(day):
    """The season year of a season that crosses New Year, as ESPN numbers it:
    2027 for 2026-27 (July starts the next one)."""
    d = date.fromisoformat(day)
    return d.year + 1 if d.month >= 7 else d.year


# ── 1. sync ──────────────────────────────────────────────────────────────────
def sync(sync_file, today, start, in_season, fetch_day, store_finals, score="home_pts", same_day=False):
    """Stores every finished day's games since the last sync, through
    yesterday. start() is where to begin with no sync file yet, fetch_day(d)
    the day's games, store_finals(d, finals) saves its finals. same_day: a
    day's list can hold another day's game (MLB's resumed games), which
    doesn't hold the day up.

    A game neither final nor called off doesn't stop the sync: the day's
    finals are stored and later days still sync, but "through" stays before
    that day so the next runs check it again, until it's older than the 3
    days grade() waits before voiding its pick."""
    through = load(sync_file, {}).get("through") or start()
    day = date.fromisoformat(through) + timedelta(days=1)
    yesterday = date.fromisoformat(today) - timedelta(days=1)
    recheck_from = (yesterday - timedelta(days=2)).isoformat()
    held = False
    while day <= yesterday:
        d = day.isoformat()
        if in_season(d):
            day_games = fetch_day(d)
            pending = [g for g in day_games
                       if (not same_day or g["date"] == d) and not (g["final"] or g["postponed"])]
            if pending:
                print(f"  {d}: {len(pending)} game(s) not final yet ({', '.join(g['id'] for g in pending)}), "
                      "will re-check next run")
                held = held or d >= recheck_from
            finals = [g for g in day_games if g["final"] and g[score] is not None]
            if finals:
                store_finals(d, finals)
        if not held:
            through = d
        day += timedelta(days=1)
    save(sync_file, {"through": through}, indent=1)


def store_espn_day(d, finals, espn, store, keep_empty_box=True):
    """Saves an ESPN day's finals with their box scores. A box score that
    fails to load is left out: the score still counts without it."""
    box = {}
    for g in finals:
        try:
            b = espn.boxscore(g["id"])
            if keep_empty_box or b:
                box[g["id"]] = b
        except Exception as e:  # noqa: BLE001 - scores still count without a box score
            print(f"  box score {g['id']} failed: {e}")
    store.save_day(d, finals, box)
    print(f"  stored {d}: {len(finals)} games" + ("" if keep_empty_box else f", {len(box)} box scores"))


# ── 2. grade ─────────────────────────────────────────────────────────────────
def grade(history, games_by_id, today, score=("home_pts", "away_pts"), names_from_pick=False):
    """Settles pending picks before today from the stored finals; a game
    played on another date (postponed or suspended), or still missing 3 days
    later, voids its pick. The winner is named as the game names its teams,
    or as the pick does with names_from_pick. Returns how many were settled."""
    home_key, away_key = score
    graded = 0
    stale = (date.fromisoformat(today) - timedelta(days=3)).isoformat()
    for p in history["picks"]:
        if p.get("correct") is not None or p.get("void") or p["date"] >= today:
            continue
        g = games_by_id.get(p["game_id"])
        if g and g["date"] == p["date"]:
            p[home_key], p[away_key] = g[home_key], g[away_key]
            names = p if names_from_pick else g
            p["winner"] = names["home"] if g[home_key] > g[away_key] else names["away"]
            p["correct"] = p["winner"] == p["pick"]
            graded += 1
        elif (g and g["date"] != p["date"]) or p["date"] < stale:
            p["void"] = True  # postponed or suspended: not played to a finish on its date
            graded += 1
    return graded


def grade_moneylines(history):
    n = sum(moneyline.grade(p) for p in history["picks"])
    if n:
        print(f"Graded {n} moneyline picks")


# ── 3. picks ─────────────────────────────────────────────────────────────────
def record(league, team):
    """W-L this season from the league walk's margins."""
    m = league.margins[team]
    w = sum(1 for x in m if x > 0)
    return f"{w}-{len(m) - w}"


def kept_price(odds, old, sides=("home", "away")):
    """The game's odds, or when the book has no price right now, the last one
    stored with its pick (old)."""
    if not odds and old and old.get("ml"):
        return {**{s: old["ml"][f"{s}_ml"] for s in sides}, "book": old["ml"].get("book")}
    return odds
