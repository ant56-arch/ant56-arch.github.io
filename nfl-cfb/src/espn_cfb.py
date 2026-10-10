"""
espn_cfb.py
ESPN stand-in for CollegeFootballData (CFBD) while CFBD can't be reached,
e.g. when the free key's monthly call quota runs out (it did on 2026-10-06;
calls come back at the start of the next month).

ESPN's public scoreboard (the same feed as the site's ticker, shared/games.py)
gives the schedule, final scores, neutral sites and a DraftKings line for every
FBS game. It has no play-by-play efficiency (CFBD's PPA), so while CFBD is out
the picks use our power ratings (cfb_ratings.py) instead of the efficiency
model, and the ratings keep updating from ESPN scores.

Team names: CFBD's logo URLs carry ESPN's team id, so the last CFBD-built
ratings file maps every FBS team's ESPN id back to its CFBD name, which keeps
names identical to the log and the Odds API matching. Teams it doesn't know
(FCS) keep ESPN's school name.
"""

import json
import os
import re
import sys
from datetime import datetime

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared"))
import games as espn

TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
RATINGS_PATH = os.path.join(TRACKING_DIR, "cfb_ratings.json")
# The last ratings built from CFBD, kept while ESPN fills in (cfb_ratings.py).
SNAPSHOT_PATH = os.path.join(TRACKING_DIR, "cfb_ratings_cfbd.json")
REGULAR_WEEKS = 16


def fbs_info():
    """team -> {conference, abbreviation, logo, espn_id} from the last
    CFBD-built ratings."""
    path = SNAPSHOT_PATH if os.path.exists(SNAPSHOT_PATH) else RATINGS_PATH
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        teams = json.load(f).get("teams", [])
    out = {}
    for t in teams:
        m = re.search(r"/(\d+)\.png", t.get("logo") or "")
        out[t["team"]] = {"conference": t.get("conference") or "", "abbreviation": t.get("abbreviation") or t["team"],
                          "logo": t.get("logo") or "", "espn_id": m.group(1) if m else None}
    return out


def _events(season):
    url = espn.ESPN + espn.SPORTS["cfb"]["path"] + "/scoreboard"
    calls = [(2, w) for w in range(1, REGULAR_WEEKS + 1)]
    if datetime.utcnow().month in (12, 1):
        calls.append((3, 1))
    for season_type, week in calls:
        params = dict(espn.SPORTS["cfb"]["params"], seasontype=season_type, week=week, dates=season)
        data = espn._get(url, params) or {}
        for event in data.get("events", []):
            yield season_type, week, event


def season(season_year):
    """(games, team colors) for one season from ESPN.
    games: one row per game in the columns fetch_cfb_data.py and
    cfb_ratings.py use (scores only once final; vegas_* from ESPN's line).
    colors: CFBD team name -> (color, alt color)."""
    info = fbs_info()
    by_id = {v["espn_id"]: t for t, v in info.items() if v["espn_id"]}
    rows, colors = [], {}
    for season_type, week, event in _events(season_year):
        comp = (event.get("competitions") or [{}])[0]
        sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        if set(sides) != {"home", "away"}:
            continue
        names = {}
        for side, c in sides.items():
            t = c.get("team", {})
            names[side] = by_id.get(str(t.get("id"))) or t.get("location") or t.get("displayName")
            if t.get("color"):
                colors[names[side]] = ("#" + t["color"], "#" + (t.get("alternateColor") or t["color"]))
        status = (comp.get("status") or event.get("status") or {}).get("type", {})
        final = status.get("state") == "post" and status.get("completed", True)
        score = {}
        for side, c in sides.items():
            try:
                score[side] = float(c.get("score")) if final else None
            except (TypeError, ValueError):
                score[side] = None
        odds = (comp.get("odds") or [{}])[0]
        spread = odds.get("spread")
        rows.append({
            "id": f"espn-{event.get('id')}", "season": season_year, "week": week,
            "season_type": "regular" if season_type == 2 else "postseason",
            "start": event.get("date"), "neutral": bool(comp.get("neutralSite")),
            "home_team": names["home"], "away_team": names["away"],
            "home_score": score["home"], "away_score": score["away"],
            "home_conference": info.get(names["home"], {}).get("conference"),
            "away_conference": info.get(names["away"], {}).get("conference"),
            # ESPN's spread is the home side's number (-4 = home favored by 4).
            "vegas_home_favored_by": -float(spread) if spread is not None else None,
            "vegas_total": odds.get("overUnder"),
        })
    games = pd.DataFrame(rows)
    if not games.empty:
        games = games.drop_duplicates("id")
    print(f"  ESPN: {len(games)} games for {season_year}, {int(games['home_score'].notna().sum()) if len(games) else 0} final")
    return games, colors


def team_table(conferences, colors):
    """cfb_teams.csv rows (fetch_cfb_data.py's columns) for teams in
    `conferences`, from the last CFBD ratings plus ESPN colors."""
    rows = []
    for team, v in fbs_info().items():
        if v["conference"] not in conferences:
            continue
        color, alt = colors.get(team, ("#94a3b8", "#94a3b8"))
        rows.append({"team": team, "abbreviation": v["abbreviation"], "conference": v["conference"],
                     "color": color, "alt_color": alt, "logo": v["logo"]})
    return pd.DataFrame(rows)
