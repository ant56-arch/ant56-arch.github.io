"""
espn.py - NHL schedule and scores from ESPN's public site API. Shared by the
season pull (research/pull_seasons.py) and the daily pipeline (predict.py).
"""

import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

API = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl"
ET = ZoneInfo("America/New_York")
# ESPN season types: 1 preseason, 2 regular season, 3 postseason.
GAME_TYPES = {2: "regular", 3: "playoffs"}
# All-Star teams (named after divisions) and exhibition sides aren't franchises.
NOT_FRANCHISES = {"ATL", "MET", "CEN", "PAC", "EAST", "WEST"}

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (NHL Edge; github.com/ant56-arch/ant56-arch.github.io)"


def get(path, **params):
    for attempt in range(4):
        try:
            r = session.get(f"{API}/{path}", params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 3:
                raise
            print(f"  retrying {path}: {e}")
            time.sleep(2 ** attempt)


def is_franchise(team):
    name = (team.get("displayName") or "").lower()
    return bool(team.get("abbreviation")) and team["abbreviation"] not in NOT_FRANCHISES and "all-star" not in name \
        and not name.startswith("team ")


def parse_event(ev, day):
    """One scoreboard event -> a flat game dict, or None if it isn't a real
    regular-season or playoff NHL game. Scores are final scores, so a game won
    in overtime or a shootout counts as a one-goal win."""
    season = ev.get("season", {})
    gtype = GAME_TYPES.get(season.get("type"))
    comp = (ev.get("competitions") or [{}])[0]
    teams = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    if not gtype or set(teams) != {"home", "away"}:
        return None
    home, away = teams["home"], teams["away"]
    if not (is_franchise(home.get("team", {})) and is_franchise(away.get("team", {}))):
        return None
    status = comp.get("status") or ev.get("status") or {}
    stype = status.get("type", {})
    start = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(ET)
    final = bool(stype.get("completed"))

    def score(c):
        try:
            return int(float(c.get("score")))
        except (TypeError, ValueError):
            return None

    detail = (stype.get("shortDetail") or stype.get("detail") or "").upper()
    return {
        "id": ev["id"],
        "date": day,
        "start": start.isoformat(),
        "season": season.get("year"),
        "type": gtype,
        "home": home["team"]["abbreviation"],
        "away": away["team"]["abbreviation"],
        "home_id": home["team"]["id"],
        "away_id": away["team"]["id"],
        "home_name": home["team"].get("displayName", ""),
        "away_name": away["team"].get("displayName", ""),
        "home_pts": score(home) if final else None,
        "away_pts": score(away) if final else None,
        "extra": "SO" if "SO" in detail else "OT" if "OT" in detail else "" if final else None,
        "neutral": bool(comp.get("neutralSite")),
        "state": stype.get("state", ""),  # pre / in / post
        "final": final,
        "postponed": stype.get("name") in ("STATUS_POSTPONED", "STATUS_CANCELED"),
    }


def scoreboard(day):
    """Every NHL game on an ET calendar day (YYYY-MM-DD)."""
    data = get("scoreboard", dates=day.replace("-", ""), limit=100)
    games = []
    for ev in data.get("events", []):
        g = parse_event(ev, day)
        if g:
            games.append(g)
    return games
