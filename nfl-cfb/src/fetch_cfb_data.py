"""
fetch_cfb_data.py
Pulls college football data from CollegeFootballData.com's API (CFBD) - the
de facto free public API for CFB, analogous to what nflverse is for the NFL
side of this project. Unlike nflverse, CFBD requires a free API key (sign up
at collegefootballdata.com/key) passed as a Bearer token - set as the
CFBD_API_KEY repo secret.

Scoped to Power-conference (SEC, Big Ten, Big 12, ACC) and FBS independent
teams (~70 programs, see POWER_CONFERENCES) - Group of Five programs have
much thinner data and far less public betting/market interest, so including
them would mostly add noise to a model this size rather than value.

Degrades gracefully: if CFBD_API_KEY isn't set (e.g. the secret hasn't been
added to the repo yet), this exits without writing anything rather than
crashing the pipeline - every downstream CFB script checks for missing input
files the same way and skips instead of erroring, so the existing NFL
pipeline is unaffected either way.

Output: raw CSVs saved to data/raw/ (cfb_games.csv, cfb_advanced_stats.csv,
cfb_teams.csv), the same directory the NFL raw data lives in.
"""

import atexit
import gzip
import json
import os
import re
import time
from datetime import datetime

import pandas as pd
import requests

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
os.makedirs(RAW_DIR, exist_ok=True)

BASE = "https://api.collegefootballdata.com"

POWER_CONFERENCES = {"SEC", "Big Ten", "Big 12", "ACC", "FBS Independents"}

def current_cfb_season():
    """Same convention as the NFL side: a season runs Aug-Jan, labeled by the
    year it starts in. The CFP championship is mid-January, so before March
    we're still finishing last year's season."""
    now = datetime.utcnow()
    return now.year if now.month >= 3 else now.year - 1

def _headers():
    key = os.environ.get("CFBD_API_KEY")
    if not key:
        return None
    return {"Authorization": f"Bearer {key}"}

# CFBD's free key allows 1,000 calls a month (it ran out on 2026-10-06), so
# every call goes through a cache in data/raw/cfbd_cache/, which the
# workflows carry from run to run with actions/cache:
#  - finished seasons, and lists that don't change during a season (FBS teams,
#    roster talent, returning production), are fetched once and kept;
#  - the current season is reused for RUN_CACHE_HOURS, so the steps of one
#    run share a single fetch; with CFBD_CACHE_ONLY=1 (the runs that only
#    need scores, which ESPN fills, plus the refit and the shadow test) any
#    cached copy is used and CFBD is asked only for what was never fetched;
#  - the current season's postseason isn't asked for before December.
CACHE_DIR = os.path.join(RAW_DIR, "cfbd_cache")
RUN_CACHE_HOURS = 3
STATIC_PATHS = {"/teams/fbs", "/talent", "/player/returning"}
_calls = {"made": 0, "remaining": None}


def _cache_policy(path, params):
    season, now = current_cfb_season(), datetime.utcnow()
    year = params.get("year")
    year = int(year) if year is not None else None
    if year == season and params.get("seasonType") == "postseason" and 3 <= now.month <= 11:
        return "skip"
    if year is not None and (year < season or path in STATIC_PATHS):
        return "keep"
    return "run"


def _cache_file(path, params):
    key = path.strip("/").replace("/", "_") + "_" + "_".join(f"{k}-{params[k]}" for k in sorted(params))
    return os.path.join(CACHE_DIR, re.sub(r"[^A-Za-z0-9_.-]", "", key) + ".json.gz")


def _get(path, params):
    """CFBD GET through the cache above. The fetch time is stored in the file,
    since actions/cache doesn't keep file times."""
    policy = _cache_policy(path, params)
    if policy == "skip":
        return []
    cached = _cache_file(path, params)
    if os.path.exists(cached):
        with gzip.open(cached, "rt") as f:
            entry = json.load(f)
        fresh = time.time() - entry["fetched"] < RUN_CACHE_HOURS * 3600
        if policy == "keep" or fresh or os.environ.get("CFBD_CACHE_ONLY") == "1":
            return entry["data"]
    data = _get_live(path, params)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with gzip.open(cached, "wt") as f:
        json.dump({"fetched": time.time(), "data": data}, f, separators=(",", ":"))
    return data


def _report_calls():
    if _calls["made"]:
        print(f"  CFBD calls this step: {_calls['made']}, left this month: {_calls['remaining']}")


atexit.register(_report_calls)


def _get_live(path, params):
    """GET with a few retries: CFBD sometimes drops a large response midway
    ("Response ended prematurely") or answers 502/503 for a minute, which
    used to leave a run with no CFB picks at all. A client error (bad key,
    season not out yet, quota used up) is raised right away."""
    for attempt in range(4):
        try:
            r = requests.get(f"{BASE}{path}", params=params, headers=_headers(), timeout=60)
            _calls["made"] += 1
            _calls["remaining"] = r.headers.get("X-CallLimit-Remaining", _calls["remaining"])
            r.raise_for_status()
            return r.json()
        except requests.exceptions.HTTPError as e:
            if e.response is None or e.response.status_code < 500 or attempt == 3:
                raise
            print(f"  retrying {path} {params}: {e}")
            time.sleep(2 ** attempt * 5)
        except (requests.exceptions.RequestException, ValueError) as e:
            if attempt == 3:
                raise
            print(f"  retrying {path} {params}: {e}")
            time.sleep(2 ** attempt * 5)

def fetch_team_info(season):
    data = _get("/teams/fbs", {"year": season})
    rows = []
    for t in data:
        conference = t.get("conference")
        if conference not in POWER_CONFERENCES:
            continue
        logos = t.get("logos") or []
        rows.append({
            "team": t.get("school"),
            "abbreviation": t.get("abbreviation") or t.get("school"),
            "conference": conference,
            "color": t.get("color") or "#94a3b8",
            "alt_color": t.get("alt_color") or t.get("color") or "#94a3b8",
            "logo": logos[0] if logos else "",
        })
    return pd.DataFrame(rows)

def _add_kickoff_columns(games):
    if "gameday" not in games.columns:
        return games
    dt_utc = pd.to_datetime(games["gameday"], errors="coerce", utc=True)
    dt_et = dt_utc.dt.tz_convert("US/Eastern")
    games["weekday"] = dt_et.dt.day_name()
    games["gametime"] = dt_et.dt.strftime("%H:%M")
    games["gameday"] = dt_et.dt.strftime("%Y-%m-%d")
    return games

def fetch_games(season):
    frames = []
    for season_type in ("regular", "postseason"):
        try:
            data = _get("/games", {"year": season, "seasonType": season_type})
            frames.append(pd.DataFrame(data))
        except requests.exceptions.HTTPError as e:
            print(f"  Skipping {season_type} games for {season}: {e}")
    if not frames or all(f.empty for f in frames):
        return pd.DataFrame()
    games = pd.concat(frames, ignore_index=True)
    games = games.rename(columns={
        "homeTeam": "home_team", "awayTeam": "away_team",
        "homePoints": "home_score", "awayPoints": "away_score",
        "homeConference": "home_conference", "awayConference": "away_conference",
        "seasonType": "game_type", "startDate": "gameday",
    })
    games["game_type"] = games["game_type"].map({"regular": "REG", "postseason": "POST"})
    games = _add_kickoff_columns(games)
    return games

def fetch_lines(season):
    frames = []
    for season_type in ("regular", "postseason"):
        try:
            data = _get("/lines", {"year": season, "seasonType": season_type})
            frames.append(pd.DataFrame(data))
        except requests.exceptions.HTTPError as e:
            print(f"  Skipping {season_type} lines for {season}: {e}")
    if not frames or all(f.empty for f in frames):
        return pd.DataFrame()
    lines = pd.concat(frames, ignore_index=True)
    if lines.empty:
        return lines

    def pick_line(rows):
        """One consistent line source per game, preferring CFBD's own
        consensus line, then DraftKings, then whatever's first - the same
        idea as fetch_odds.py preferring one bookmaker over averaging."""
        if not rows:
            return {}
        for preferred in ("consensus", "DraftKings"):
            match = next((r for r in rows if r.get("provider") == preferred), None)
            if match:
                return match
        return rows[0]

    rows = []
    for _, g in lines.iterrows():
        chosen = pick_line(g.get("lines") or [])
        rows.append({
            "home_team": g.get("homeTeam"), "away_team": g.get("awayTeam"),
            "vegas_home_favored_by": -chosen["spread"] if chosen.get("spread") is not None else None,
            "vegas_total": chosen.get("overUnder"),
        })
    return pd.DataFrame(rows)

def fetch_advanced_stats(season):
    frames = []
    for season_type in ("regular", "postseason"):
        try:
            data = _get("/stats/game/advanced", {"year": season, "seasonType": season_type})
            frames.append(pd.DataFrame(data))
        except requests.exceptions.HTTPError as e:
            print(f"  Skipping {season_type} advanced stats for {season}: {e}")
    if not frames or all(f.empty for f in frames):
        return pd.DataFrame()
    stats = pd.concat(frames, ignore_index=True)
    if stats.empty:
        return stats

    rows = []
    for _, r in stats.iterrows():
        offense = r.get("offense") or {}
        defense = r.get("defense") or {}
        rows.append({
            "season": r.get("season"), "week": r.get("week"), "team": r.get("team"), "opponent": r.get("opponent"),
            "off_ppa_per_play": offense.get("ppa"),
            "off_success_rate": offense.get("successRate"),
            "off_explosiveness": offense.get("explosiveness"),
            "def_ppa_per_play_allowed": defense.get("ppa"),
            "def_success_rate_allowed": defense.get("successRate"),
            "def_explosiveness_allowed": defense.get("explosiveness"),
        })
    return pd.DataFrame(rows)

def main():
    if _headers() is None:
        print("CFBD_API_KEY not set - skipping college football data fetch. "
              "Get a free key at https://collegefootballdata.com/key and add it "
              "as a repo secret to enable college football predictions.")
        return

    season = current_cfb_season()
    print(f"Pulling college football data for season {season}...")

    print("\n[1/3] Team info (Power conferences + independents)...")
    teams = fetch_team_info(season)
    teams.to_csv(os.path.join(RAW_DIR, "cfb_teams.csv"), index=False)
    print(f"  Total teams: {len(teams):,}")
    covered = set(teams["team"]) if not teams.empty else set()

    print("\n[2/3] Games + closing lines...")
    games = fetch_games(season)
    if not games.empty and covered:
        games = games[games["home_team"].isin(covered) | games["away_team"].isin(covered)]
    lines = fetch_lines(season)
    if not games.empty and not lines.empty:
        games = games.merge(lines, on=["home_team", "away_team"], how="left")
    games.to_csv(os.path.join(RAW_DIR, "cfb_games.csv"), index=False)
    print(f"  Total games: {len(games):,}")

    print("\n[3/3] Advanced per-game team stats (PPA, success rate, explosiveness)...")
    # Last season too, so every team has recent form from week 1 (and before
    # it) - build_cfb_features.py's recency weighting fades it out as this
    # season's games come in, the same way fit_cfb_model.py's walk-forward
    # features carry across seasons.
    frames = [fetch_advanced_stats(s) for s in (season - 1, season)]
    stats = pd.concat([f for f in frames if not f.empty], ignore_index=True) if any(not f.empty for f in frames) else pd.DataFrame()
    if not stats.empty and covered:
        stats = stats[stats["team"].isin(covered)]
    stats.to_csv(os.path.join(RAW_DIR, "cfb_advanced_stats.csv"), index=False)
    print(f"  Total team-game rows: {len(stats):,}")

    print("\nDone. Raw CFB data saved to data/raw/")

if __name__ == "__main__":
    main()
