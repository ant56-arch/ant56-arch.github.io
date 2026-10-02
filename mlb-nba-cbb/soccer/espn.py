"""
espn.py - Premier League, La Liga and Champions League matches, scores and
three-way odds from ESPN's public site API. Shared by the research pull
(research/pull_data.py) and the daily pipeline (predict.py).

Every result here is the regular-time result: 90 minutes plus stoppage. A
Champions League knockout tie that goes to extra time or penalties is graded
on the score after 90 minutes (from the per-half line score, or failing that
the goal times), and when neither is there the match has no usable result
(reg_known False), so a pick on it is no decision rather than a guess.
"""

import re
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

API = "https://site.api.espn.com/apis/site/v2/sports"
ET = ZoneInfo("America/New_York")
# Our three competitions: ESPN path, display name, and the football-data.co.uk
# league code whose results cover the same matches (None for the UCL).
COMPS = {
    "EPL": {"path": "soccer/eng.1", "name": "Premier League", "fd": "E0"},
    "LALIGA": {"path": "soccer/esp.1", "name": "La Liga", "fd": "SP1"},
    "UCL": {"path": "soccer/uefa.champions", "name": "Champions League", "fd": None},
}
VOID_STATUS = {"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED", "STATUS_SUSPENDED", "STATUS_FORFEIT"}

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (Soccer Edge; github.com/ant56-arch/ant56-arch.github.io)"


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


def season_of(day):
    """European seasons run July to June; 2026-10-02 is in season 2026 (2026-27)."""
    d = date.fromisoformat(day[:10])
    return d.year if d.month >= 7 else d.year - 1


def _int(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def _minute(clock):
    """Match minute of a goal from ESPN's clock: "45'+2'" -> (45, 2), "105'" -> (105, 0)."""
    text = str((clock or {}).get("displayValue") or "")
    m = re.match(r"\s*(\d+)'?\s*(?:\+\s*(\d+))?", text)
    if m:
        return int(m.group(1)), int(m.group(2) or 0)
    secs = (clock or {}).get("value")
    return (int(float(secs) // 60) + 1, 0) if secs is not None else (None, 0)


def regulation_score(comp, home, away, extra):
    """(home, away) goals after 90 minutes plus stoppage, or None when it can't
    be told. Without extra time that's simply the final score."""
    full = (_int(home.get("score")), _int(away.get("score")))
    if None in full:
        return None
    if not extra:
        return full
    # The line score's first two periods are the two halves.
    halves = []
    for c in (home, away):
        ls = c.get("linescores") or []
        vals = [_int(x.get("value", x.get("displayValue"))) for x in ls[:2]]
        halves.append(sum(vals) if len(vals) == 2 and None not in vals else None)
    if None not in halves:
        return tuple(halves)
    # Else count goals before extra time from the match details, but only if
    # every goal is accounted for (the details add up to the final score).
    ids = {str(home.get("id") or home.get("team", {}).get("id")): 0, str(away.get("id") or away.get("team", {}).get("id")): 1}
    reg, total = [0, 0], [0, 0]
    for d in comp.get("details") or []:
        if not d.get("scoringPlay") or (d.get("shootout") or "shootout" in str((d.get("type") or {}).get("text", "")).lower()):
            continue
        side = ids.get(str((d.get("team") or {}).get("id")))
        if side is None:
            return None
        minute, _ = _minute(d.get("clock"))
        if minute is None:
            return None
        total[side] += 1
        if minute <= 90:
            reg[side] += 1
    return tuple(reg) if tuple(total) == full else None


def _line(block):
    """A price from the newer odds shape ({"close": {"odds": "+250"}, "open": ...})."""
    from moneyline import american
    if not isinstance(block, dict):
        return None
    for key in ("close", "current", "open"):
        line = block.get(key)
        v = american(line.get("odds")) if isinstance(line, dict) else None
        if v is not None:
            return v
    return american(block.get("odds"))


def parse_odds(comp):
    """Three-way moneyline odds {"home", "draw", "away", "book"} (American), or
    None. Handles both of ESPN's shapes, homeTeamOdds / awayTeamOdds / drawOdds
    .moneyLine and moneyline.home / .away / .draw, highest-priority provider first."""
    from moneyline import american
    entries = [o for o in (comp or {}).get("odds") or [] if isinstance(o, dict)]
    entries.sort(key=lambda o: (o.get("provider") or {}).get("priority", 99) or 99)
    for o in entries:
        ml = o.get("moneyline") if isinstance(o.get("moneyline"), dict) else {}
        h, d, a = (_line(ml.get(s)) for s in ("home", "draw", "away")) if ml else (None, None, None)
        if None in (h, d, a):
            h = american((o.get("homeTeamOdds") or {}).get("moneyLine"))
            a = american((o.get("awayTeamOdds") or {}).get("moneyLine"))
            d = american((o.get("drawOdds") or {}).get("moneyLine"))
        if None not in (h, d, a):
            return {"home": h, "draw": d, "away": a, "book": (o.get("provider") or {}).get("name") or "ESPN"}
    return None


def _record(c):
    return next((r.get("summary") for r in c.get("records") or [] if r.get("type") in ("total", None)), "") or ""


def parse_event(ev, comp_code):
    """One scoreboard event -> a flat match dict, or None."""
    comp = (ev.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    if set(sides) != {"home", "away"}:
        return None
    home, away = sides["home"], sides["away"]
    ht, at = home.get("team") or {}, away.get("team") or {}
    status = comp.get("status") or ev.get("status") or {}
    stype = status.get("type", {})
    name = stype.get("name") or ""
    detail = (stype.get("shortDetail") or stype.get("detail") or "").upper()
    start = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(ET)
    final = bool(stype.get("completed")) and name not in VOID_STATUS
    extra = "PEN" if ("PEN" in name or "PEN" in detail) else "AET" if ("AET" in name or "AET" in detail or "ET" in name.split("_")) else ""
    reg = regulation_score(comp, home, away, extra) if final else None
    day = start.date().isoformat()
    return {
        "id": str(ev["id"]),
        "comp": comp_code,
        "date": day,
        "start": start.isoformat(),
        "season": season_of(day),
        "home": ht.get("abbreviation") or ht.get("shortDisplayName", "")[:3].upper(),
        "away": at.get("abbreviation") or at.get("shortDisplayName", "")[:3].upper(),
        "home_name": ht.get("displayName", ""),
        "away_name": at.get("displayName", ""),
        "home_logo": ht.get("logo", ""),
        "away_logo": at.get("logo", ""),
        "home_record": _record(home),
        "away_record": _record(away),
        "hg": reg[0] if reg else None,
        "ag": reg[1] if reg else None,
        "ft": [_int(home.get("score")), _int(away.get("score"))] if final else None,
        "extra": extra,
        "reg_known": reg is not None,
        "neutral": bool(comp.get("neutralSite")),
        "state": stype.get("state", ""),  # pre / in / post
        "final": final,
        "postponed": name in VOID_STATUS,
        "odds": parse_odds(comp),
    }


def scoreboard(comp_code, day):
    """Every match of one competition on an ET calendar day (YYYY-MM-DD)."""
    data = get(f"{COMPS[comp_code]['path']}/scoreboard", dates=day.replace("-", ""), limit=200)
    out = []
    for ev in data.get("events", []):
        try:
            m = parse_event(ev, comp_code)
        except Exception as e:  # one odd event never costs the rest
            print(f"  skipping {comp_code} event {ev.get('id')}: {e}")
            continue
        if m and m["date"] == day:
            out.append(m)
    return out


def scoreboard_range(comp_code, first, last):
    """Every match of a competition between two dates, a week per request."""
    out, d = {}, date.fromisoformat(first)
    end = date.fromisoformat(last)
    while d <= end:
        to = min(d + timedelta(days=6), end)
        data = get(f"{COMPS[comp_code]['path']}/scoreboard", dates=f"{d:%Y%m%d}-{to:%Y%m%d}", limit=500)
        for ev in data.get("events", []):
            try:
                m = parse_event(ev, comp_code)
            except Exception as e:
                print(f"  skipping {comp_code} event {ev.get('id')}: {e}")
                continue
            if m:
                out[m["id"]] = m
        d = to + timedelta(days=1)
    return sorted(out.values(), key=lambda m: (m["start"], m["id"]))
