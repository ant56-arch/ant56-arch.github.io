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


def _num(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _minutes(s):
    """'59:12' -> 59.2 minutes."""
    try:
        m, sec = str(s).split(":")
        return int(m) + int(sec) / 60
    except ValueError:
        return _num(s) or 0.0


DEBUG_SHAPE = {"printed": False}


def boxscore(game_id):
    """Shots on goal and goalies for one final game.

    Returns {team_abbr: {"sog": shots on goal or None, "goalies": [[athlete_id,
    name, shots_against, saves, minutes], ...]}} with the starter (most
    minutes) first. Shots fall back to the other side's shots against when
    the team totals don't list them.
    """
    data = get("summary", event=game_id)
    box = data.get("boxscore", {})
    if not DEBUG_SHAPE["printed"]:  # one sample of the layout in the run log, to check the parse
        DEBUG_SHAPE["printed"] = True
        for t in box.get("teams", [])[:1]:
            print("  box teams stats:", [(s.get("name"), s.get("displayValue")) for s in t.get("statistics", [])][:20])
        for t in box.get("players", [])[:1]:
            print("  box player groups:", [(g.get("name"), g.get("keys") or g.get("names"), g.get("labels"))
                                           for g in t.get("statistics", [])])
    out = {}
    for t in box.get("teams", []):
        abbr = t.get("team", {}).get("abbreviation")
        if not abbr:
            continue
        sog = None
        for s in t.get("statistics", []):
            name = (s.get("name") or "").lower()
            if name in ("shotstotal", "shots", "shotsongoal"):
                sog = _num(s.get("displayValue"))
                break
        out[abbr] = {"sog": sog, "goalies": []}
    for t in box.get("players", []):
        abbr = t.get("team", {}).get("abbreviation")
        if not abbr:
            continue
        side = out.setdefault(abbr, {"sog": None, "goalies": []})
        for group in t.get("statistics", []):
            keys = [str(k) for k in (group.get("keys") or group.get("names") or [])]
            labels = [str(k).upper() for k in (group.get("labels") or [])]
            low = [k.lower() for k in keys]
            if "saves" not in low and "SV" not in labels:
                continue

            def col(row, key, label):
                if key in low:
                    return row[low.index(key)] if low.index(key) < len(row) else None
                if label in labels:
                    return row[labels.index(label)] if labels.index(label) < len(row) else None
                return None

            for a in group.get("athletes", []):
                stats = a.get("stats") or []
                if not stats:
                    continue
                sa, sv = _num(col(stats, "shotsagainst", "SA")), _num(col(stats, "saves", "SV"))
                toi = _minutes(col(stats, "timeonice", "TOI") or 0)
                if sa is None or sv is None or toi <= 0:
                    continue
                ath = a.get("athlete", {})
                side["goalies"].append([ath.get("id"), ath.get("displayName", ""), sa, sv, round(toi, 1)])
        side["goalies"].sort(key=lambda g: -g[4])
    teams = list(out)
    if len(teams) == 2:
        for me, opp in ((teams[0], teams[1]), (teams[1], teams[0])):
            if out[me]["sog"] is None and out[opp]["goalies"]:
                out[me]["sog"] = sum(g[2] for g in out[opp]["goalies"])
    return out
