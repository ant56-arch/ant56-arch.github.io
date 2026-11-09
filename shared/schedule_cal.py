"""schedule_cal.py - the data behind the Schedule calendar.

Anthony, 2026-11-09: "for the schedule, i think we should have like a calender
... a total sport overview, then have it broken up by sport on each sport page."

Every game we've picked, from each sport's pick history on main, plus the games
coming up: NFL and CFB from their tracking logs (the whole season is there,
with our pick), NBA, NHL and soccer from ESPN's scoreboard for the next
AHEAD_DAYS days (no pick yet until the morning of). One file per month so the
page only loads what it shows:

  /calendar/index.json     {"updated", "months": {"2026-11": {"NFL": 12, ...}}}
  /calendar/2026-11.json   {"games": [[date, start, sport, away, home, pick,
                             prob, result], ...]}

date is the pick's day (US Eastern), start an ISO time or "" when it isn't
set, prob our chance for the pick in whole percent (null with no pick yet),
result 1 (hit), 0 (miss) or null (not final). Football picks and results use
pick_moves.football_pick / football_hit, the same rules as the NFL and CFB
pages.

publish_site.sh runs it with the site folder, which also gets calendar.js and
calendar.css (the page code, shared by /schedule.html and every sport's
Schedule tab):

  python3 shared/schedule_cal.py site OUT_DIR
"""
import csv
import json
import os
import shutil
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SHARED = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SHARED)
sys.path.insert(0, SHARED)
import pick_moves  # noqa: E402

ET = ZoneInfo("America/New_York")
AHEAD_DAYS = 10
DAILY = [("MLB", "mlb-nba-cbb/teams/picks_history.json"), ("NBA", "mlb-nba-cbb/nba/picks_history.json"),
         ("NHL", "mlb-nba-cbb/nhl/picks_history.json"), ("CBB", "mlb-nba-cbb/cbb/picks_history.json"),
         ("Soccer", "mlb-nba-cbb/soccer/picks_history.json")]
FOOTBALL = [("NFL", "nfl-cfb/data/tracking/predictions_log.csv"),
            ("CFB", "nfl-cfb/data/tracking/cfb_predictions_log.csv")]
# Upcoming games from ESPN (CBB has hundreds a week and MLB's ids don't match
# its picks, so those two show the days we've picked).
AHEAD = {"NBA": ["basketball/nba"], "NHL": ["hockey/nhl"],
         "Soccer": ["soccer/eng.1", "soccer/esp.1", "soccer/uefa.champions"]}


def _pct(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x * 100 if x <= 1 else x)


def daily_rows():
    rows = []
    for sport, path in DAILY:
        try:
            with open(os.path.join(ROOT, path)) as f:
                picks = json.load(f).get("picks", [])
        except (OSError, ValueError):
            continue
        for p in picks:
            if p.get("void") or not p.get("date"):
                continue
            pick = "Draw" if p.get("pick_side") == "draw" else p.get("pick") or ""
            res = p.get("correct")
            rows.append({"id": str(p.get("game_id") or ""), "row": [
                p["date"], p.get("start") or "", sport, p.get("away") or "", p.get("home") or "", pick,
                _pct(p.get("prob")) if pick else None, None if res is None else int(bool(res))]})
    return rows


def football_rows():
    rows = []
    for sport, path in FOOTBALL:
        try:
            with open(os.path.join(ROOT, path), newline="") as f:
                log = list(csv.DictReader(f))
        except OSError:
            continue
        for r in log:
            if not r.get("gameday"):
                continue
            pick = pick_moves.football_pick(r)
            hit = pick_moves.football_hit(r)
            start = r.get("ml_commence_time") or ""
            rows.append({"id": "", "row": [
                r["gameday"], start, sport, r.get("away_team") or "", r.get("home_team") or "",
                pick[0] if pick else "", _pct(pick[1]) if pick else None, None if hit is None else int(bool(hit))]})
    return rows


def _espn_day(path, day):
    import games  # the ESPN parser; only needed here
    import requests
    try:  # one quick try: dozens of these run on every publish
        r = requests.get(f"{games.ESPN}{path}/scoreboard", params={"dates": day.strftime("%Y%m%d")}, timeout=8,
                         headers={"User-Agent": "Mozilla/5.0 (Sports Edge; github.com/ant56-arch)"})
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError):
        return None
    out = []
    for e in data.get("events", []):
        g = games.parse(e)
        if not g or not g.get("start"):
            continue
        if path.startswith("soccer/"):
            for c in (e.get("competitions") or [{}])[0].get("competitors", []):
                side = c.get("homeAway")
                if side in ("home", "away"):
                    g[side]["abbr"] = games.soccer_abbr.fix((c.get("team") or {}).get("id"), g[side]["abbr"])
        out.append(g)
    return out


def ahead_rows(today, skip):
    """Upcoming games from ESPN, one request per league per day. A league that
    couldn't be reached comes back in failed (its last published games are kept)."""
    jobs = [(sport, path, today + timedelta(days=i)) for sport, paths in AHEAD.items() if sport not in skip
            for path in paths for i in range(AHEAD_DAYS + 1)]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda j: _espn_day(j[1], j[2]), jobs))
    rows, failed = [], set()
    for (sport, _, _), found in zip(jobs, results):
        if found is None:
            failed.add(sport)
            continue
        for g in found:
            start = games_start(g["start"])
            if start.date() < today:
                continue
            rows.append({"id": str(g["id"]), "row": [
                start.date().isoformat(), g["start"], sport, g["away"]["abbr"], g["home"]["abbr"], "", None, None]})
    return rows, failed


def games_start(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)


def _key(r):
    d, _, sport, away, home = r["row"][:5]
    return (sport, r["id"]) if r["id"] else (sport, d, away, home)


def _season_over():
    try:
        import seasons
        return {k for k, v in seasons.site_json()["leagues"].items() if v.get("over")}
    except Exception as e:  # noqa: BLE001 - the calendar still builds without it
        print(f"  Calendar: couldn't read season states ({e})")
        return set()


def old_rows(out_dir, sports, today):
    """Upcoming games (no pick yet) from the last published calendar, for leagues ESPN didn't answer for."""
    rows = []
    folder = os.path.join(out_dir, "calendar")
    if not sports or not os.path.isdir(folder):
        return rows
    for name in os.listdir(folder):
        if name == "index.json" or not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, name)) as f:
                for r in json.load(f).get("games", []):
                    if r[2] in sports and not r[5] and r[0] >= today.isoformat():
                        rows.append({"id": "", "row": r})
        except (OSError, ValueError, IndexError):
            continue
    return rows


def build(out_dir, fetch=True):
    today = datetime.now(ET).date()
    rows = daily_rows() + football_rows()
    if fetch:
        over = _season_over()
        ahead, failed = ahead_rows(today, {s for s in AHEAD if s in over})
        rows += ahead + old_rows(out_dir, failed, today)
    seen, months = {}, defaultdict(list)
    for r in rows:  # picks first, so an ESPN game we've already picked isn't listed twice
        k = _key(r)
        alt = (r["row"][2], r["row"][0], r["row"][3], r["row"][4])
        if k in seen or alt in seen:
            continue
        seen[k] = seen[alt] = True
        months[r["row"][0][:7]].append(r["row"])
    final = os.path.join(out_dir, "calendar")
    folder = final + ".new"  # swapped in once every file is written
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    index = {}
    for month, games in sorted(months.items()):
        games.sort(key=lambda g: (g[0], g[1] or "~", g[2], g[4]))
        counts = defaultdict(int)
        for g in games:
            counts[g[2]] += 1
        index[month] = dict(counts)
        with open(os.path.join(folder, f"{month}.json"), "w") as f:
            json.dump({"games": games}, f, separators=(",", ":"))
    with open(os.path.join(folder, "index.json"), "w") as f:
        json.dump({"updated": datetime.now(ET).isoformat(timespec="seconds"), "today": today.isoformat(),
                   "months": index}, f, separators=(",", ":"))
    shutil.rmtree(final, ignore_errors=True)
    os.rename(folder, final)
    for name in ("calendar.js", "calendar.css"):
        shutil.copy(os.path.join(SHARED, name), os.path.join(out_dir, name))
    print(f"  Calendar: {sum(len(g) for g in months.values())} games over {len(months)} months")


def main(argv):
    if len(argv) >= 3 and argv[1] == "site":
        build(argv[2], fetch="--offline" not in argv)
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
