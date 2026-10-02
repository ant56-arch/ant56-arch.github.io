"""
pull_data.py - pulls the match results Soccer Edge's ratings learn from.

  League results and closing odds from football-data.co.uk (fd.py): the top
  five leagues plus five whose clubs are Champions League regulars, every
  season in SEASONS -> soccer/data/fd/<season>.json
  Champions League results from ESPN's scoreboard, a week per request
  -> soccer/data/ucl/<season>.json

SEASONS env var: comma-separated season start years (2025 = 2025-26).
Default: 2015-16 through the current season. A league or season the site
couldn't serve keeps whatever was stored before.

Ends by listing every ESPN club name that matches no league club (names.py),
in soccer/data/unmatched.json and the run summary: a club there is rated only
from its Champions League games, so a real club in the list wants an alias.
"""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.append(os.path.dirname(HERE))
import espn  # noqa: E402
import fd  # noqa: E402
import names  # noqa: E402
import store  # noqa: E402

FIRST_SEASON = 2015


def default_seasons():
    return list(range(FIRST_SEASON, espn.season_of(date.today().isoformat()) + 1))


def pull_fd(season):
    old = {}
    for m in store.load_fd(season):
        old.setdefault(m["comp"], []).append(m)
    out, notes = [], []
    for code in fd.LEAGUES:
        rows = fd.fetch(code, season)
        if rows is None:  # unreachable: keep what was stored
            rows = old.get(code, [])
            notes.append(f"{code} kept ({len(rows)})")
        out += rows
    if out:
        store.save_fd(season, out)
    by = {c: sum(1 for m in out if m["comp"] == c) for c in fd.LEAGUES}
    print(f"  {season}-{str(season + 1)[2:]}: " + ", ".join(f"{c} {n}" for c, n in by.items() if n)
          + (f" ({'; '.join(notes)})" if notes else ""))
    return out


def pull_ucl(season):
    first = date(season, 7, 1)
    last = min(date(season + 1, 6, 30), date.today() - timedelta(days=1))
    if last < first:
        return []
    try:
        matches = espn.scoreboard_range("UCL", first.isoformat(), last.isoformat())
    except Exception as e:
        print(f"  UCL {season}: ESPN unavailable ({e}); keeping what was stored")
        return []
    finals = [m for m in matches if m["final"]]
    if finals:
        store.save_ucl(season, finals)
    aet = sum(1 for m in finals if m["extra"])
    unknown = sum(1 for m in finals if not m["reg_known"])
    print(f"  UCL {season}-{str(season + 1)[2:]}: {len(finals)} finals, {aet} after extra time"
          + (f", {unknown} without a 90-minute score (left out)" if unknown else ""))
    return finals


def report_unmatched(ucl):
    known = {m["hk"] for m in store.load_matches() if m["league"]} | \
            {m["ak"] for m in store.load_matches() if m["league"]}
    espn_names = {m["home_name"] for m in ucl} | {m["away_name"] for m in ucl}
    espn_names |= {g.get(f"{s}_name") for g in store.day_games().values() for s in ("home", "away")} - {None}
    missing = names.unmatched(espn_names, known)
    with open(os.path.join(store.DATA, "unmatched.json"), "w") as f:
        json.dump({"note": "ESPN club names with no league-results match (names.py); rated from ESPN games only",
                   "names": missing}, f, indent=1)
    lines = ["### Soccer data pull", f"- ESPN clubs without a league match: {len(missing)}"]
    lines += [f"  - {n} (key `{names.team_key(n)}`)" for n in missing[:80]]
    text = "\n".join(lines)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text + "\n")


def main():
    seasons = [int(s) for s in os.environ.get("SEASONS", "").split(",") if s.strip()] or default_seasons()
    print(f"Pulling seasons {seasons[0]}-{seasons[-1]} ({len(seasons)})")
    print("League results (football-data.co.uk):")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(pull_fd, seasons))
    print("Champions League (ESPN):")
    with ThreadPoolExecutor(max_workers=4) as pool:
        ucl = [m for ms in pool.map(pull_ucl, seasons) for m in ms]
    report_unmatched(ucl)


if __name__ == "__main__":
    main()
