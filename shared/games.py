"""Game schedules and scores from ESPN's public scoreboard API, for the
scoreboard strip at the top of every Edge site and the Schedule tab on the
home site (ant56-arch.github.io/schedule.html), which both read games.json.

Keep this file identical in mlb-nba-cbb/games.py (MLB, NBA and CBB) and
nfl-cfb/src/games.py (NFL and CFB).

  load(sport)            this sport's current slate, the way ESPN's own
                         scoreboard defines it: the current week for NFL and
                         CFB (every FBS game), the current day for MLB and
                         NBA, with TV, stadium and records. Never raises;
                         returns {"label", "games": []} when ESPN can't be
                         reached (it's blocked in some sandboxes).
  write_json(path, ...)  games.json for the scoreboard strip and Schedule
                         tab, next to summary.json. Both refresh scores from
                         ESPN in the browser and fall back to this file.

Each site attaches its own pick to a game as game["pick"] = {"text", "result"}
before writing.
"""
import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

ET = ZoneInfo("America/New_York")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/"
SPORTS = {
    "nfl": {"path": "football/nfl", "params": {}},
    # FBS only; the strip and Schedule tab keep games with a Top 25 team.
    "cfb": {"path": "football/college-football", "params": {"groups": "80", "limit": "400"}},
    "mlb": {"path": "baseball/mlb", "params": {}},
    "nba": {"path": "basketball/nba", "params": {}},
    "nhl": {"path": "hockey/nhl", "params": {}},
    # Soccer Edge: three competitions in one slate. With no single ESPN
    # address, its games.json has no "espn" link and the browser shows the
    # published file as is.
    "soccer": {"paths": {"soccer/eng.1": "Premier League", "soccer/esp.1": "La Liga",
                         "soccer/uefa.champions": "Champions League"}, "params": {}},
}


def espn_url(sport):
    s = SPORTS[sport]
    if "path" not in s:
        return ""
    query = "&".join(f"{k}={v}" for k, v in s["params"].items())
    return f"{ESPN}{s['path']}/scoreboard" + (f"?{query}" if query else "")


def _get(url, params=None):
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=20,
                             headers={"User-Agent": "Mozilla/5.0 (Sports Edge; github.com/ant56-arch)"})
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            if attempt == 2:
                print(f"  ESPN scoreboard unavailable: {e}")
                return None
            time.sleep(2 ** attempt)


def _team(c):
    t = c.get("team", {})
    rank = (c.get("curatedRank") or {}).get("current")
    record = next((r.get("summary") for r in c.get("records") or [] if r.get("type") in ("total", None)), None)
    probable = next((p.get("athlete", {}).get("shortName") for p in c.get("probables") or []), None)
    try:
        score = int(float(c.get("score"))) if c.get("score") not in (None, "") else None
    except (TypeError, ValueError):
        score = None
    return {
        "abbr": t.get("abbreviation", ""),
        "name": t.get("displayName", ""),
        "short": t.get("shortDisplayName") or t.get("name", ""),
        "location": t.get("location", ""),
        "logo": t.get("logo", ""),
        "rank": rank if isinstance(rank, int) and 1 <= rank <= 25 else None,
        "score": score,
        "record": record,
        "probable": probable,
        "winner": bool(c.get("winner")),
    }


def parse(event):
    comp = (event.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    if set(sides) != {"home", "away"}:
        return None
    status = (comp.get("status") or event.get("status") or {}).get("type", {})
    venue = comp.get("venue") or {}
    tv = []
    for b in comp.get("broadcasts") or []:
        for n in b.get("names") or []:
            if n not in tv:
                tv.append(n)
    return {
        "id": str(event.get("id")),
        "start": event.get("date"),
        "state": status.get("state", "pre"),  # pre / in / post
        "detail": status.get("shortDetail") or status.get("detail") or "",
        "tv": ", ".join(tv[:2]),
        "venue": venue.get("fullName", ""),
        "neutral": bool(comp.get("neutralSite")),
        "away": _team(sides["away"]),
        "home": _team(sides["home"]),
    }


def is_top25(g):
    return bool(g["away"]["rank"] or g["home"]["rank"])


def load(sport):
    """The current slate: {"label", "week", "games"}, games sorted by start time."""
    if "paths" in SPORTS[sport]:
        games = []
        for path, league in SPORTS[sport]["paths"].items():
            data = _get(f"{ESPN}{path}/scoreboard") or {}
            for g in (parse(e) for e in data.get("events", [])):
                if g:
                    g["league"] = league
                    games.append(g)
        data = {}
    else:
        data = _get(espn_url(sport))
        if not data:
            return {"label": "", "week": None, "games": []}
        games = [g for g in (parse(e) for e in data.get("events", [])) if g]
    games.sort(key=lambda g: (g["start"] or "", g["id"]))
    week = (data.get("week") or {}).get("number")
    if sport in ("nfl", "cfb") and week:
        label = f"Week {week}"
    elif games:
        label = start_et(games[0]).strftime("%a, %b %-d")
    else:
        label = ""
    print(f"  {sport.upper()} scoreboard: {len(games)} games ({label or 'none'})")
    return {"label": label, "week": week if sport in ("nfl", "cfb") else None, "games": games}


def start_et(g):
    return datetime.fromisoformat(g["start"].replace("Z", "+00:00")).astimezone(ET)


def write_json(path, sport, slate, updated):
    """games.json for the scoreboard strip, which keeps CFB to games with a Top 25 team."""
    games = [g for g in slate["games"] if is_top25(g)] if sport == "cfb" else slate["games"]
    with open(path, "w") as f:
        json.dump({"sport": sport.upper(), "label": slate["label"], "updated": updated,
                   "espn": espn_url(sport), "top25_only": sport == "cfb", "games": games}, f, indent=1)


def card_info(espn_game):
    """What a game card takes from ESPN: TV, stadium and each team's record."""
    if not espn_game:
        return {}
    return {"tv": espn_game.get("tv") or "", "venue": espn_game.get("venue") or "",
            "records": (espn_game["away"].get("record") or "", espn_game["home"].get("record") or "")}



def schedule_redirect(sport):
    """A stub at a sport's old schedule.html (each league had its own Schedule
    tab before it moved to the home site) that forwards to the shared page."""
    url = f"https://ant56-arch.github.io/schedule.html#{sport}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url={url}">
<link rel="canonical" href="{url}">
<title>Schedule | Sports Edge</title>
</head>
<body>
<p>The schedule moved. <a href="{url}">Open the Schedule tab</a>.</p>
</body>
</html>
"""


def legal_redirect(page):
    """A stub at a site's old terms.html / privacy.html that forwards to the
    one Terms of Use and Privacy Policy on the home site, which cover every
    Sports Edge site."""
    url = f"https://ant56-arch.github.io/{page}.html"
    title = {"terms": "Terms of Use", "privacy": "Privacy Policy"}[page]
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url={url}">
<link rel="canonical" href="{url}">
<title>{title} | Sports Edge</title>
</head>
<body>
<p>This page moved. <a href="{url}">Read the {title}</a>.</p>
</body>
</html>
"""
