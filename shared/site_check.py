"""Checks the live site has every game it should, and reruns the update that
fills it when it doesn't (site-check.yml, three times a day).

For each sport it compares today's ESPN schedule (the whole week for the NFL)
with the published summary.json "slate": a game that starts more than 30
minutes from now with no pick, or a summary not updated for too long, means
that sport's update didn't run or failed. Prints what it found and writes the
workflows to rerun (daily.yml, weekly-picks.yml) to $GITHUB_OUTPUT. Never
fails the job, so nothing emails anyone.

Left out: CFB (CFBD's monthly quota is out until Nov 1, 2026, and its slate
skips FCS opponents), CBB (no schedule feed yet), and NBA preseason games,
which the NBA model doesn't pick.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
SITE = "https://ant56-arch.github.io"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/"
# sport: (summary path, ESPN scoreboards, workflow that fills it, hours a summary may go without an update)
SPORTS = {
    "MLB": ("mlb", ["baseball/mlb"], "daily.yml", 8),
    "NHL": ("nhl", ["hockey/nhl"], "daily.yml", 8),
    "NBA": ("nba", ["basketball/nba"], "daily.yml", 8),
    "Soccer": ("soccer", ["soccer/eng.1", "soccer/esp.1", "soccer/uefa.champions"], "daily.yml", 8),
    "NFL": ("nfl", ["football/nfl"], "weekly-picks.yml", 18),
}
LEAD = timedelta(minutes=30)   # a game this close to its start may legitimately have no pick yet
MATCH = timedelta(minutes=15)  # start times of a pick and its ESPN game


def get(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Sports Edge site check)"})
    with urlopen(req, timeout=20) as r:
        return json.load(r)


def when(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def espn_games(paths, weekly, today):
    games = []
    for path in paths:
        url = ESPN + path + "/scoreboard" + ("" if weekly else "?dates=" + today.strftime("%Y%m%d"))
        for ev in get(url).get("events", []):
            if (ev.get("season") or {}).get("type") == 1:  # preseason
                continue
            comp = (ev.get("competitions") or [{}])[0]
            state = ((comp.get("status") or ev.get("status") or {}).get("type") or {}).get("state")
            teams = {c.get("homeAway"): (c.get("team") or {}).get("abbreviation", "") for c in comp.get("competitors", [])}
            if state == "pre" and ev.get("date"):
                games.append((when(ev["date"]), teams.get("away", ""), teams.get("home", "")))
    return games


def check(sport, now):
    slug, paths, workflow, max_age = SPORTS[sport]
    summary = get(f"{SITE}/{slug}/summary.json")
    problems = []
    updated = summary.get("updated")
    if not updated or now - when(updated) > timedelta(hours=max_age):
        problems.append(f"summary last updated {updated}")
    today = now.astimezone(ET).date()
    picks = [(when(g["start"]), g.get("away"), g.get("home")) for g in summary.get("slate") or [] if g.get("start")]
    for start, away, home in espn_games(paths, sport == "NFL", today):
        if start - now < LEAD or (sport != "NFL" and start.astimezone(ET).date() != today):
            continue
        if not any(abs(start - t) <= MATCH and {away, home} & {a, h} for t, a, h in picks):
            problems.append(f"no pick for {away} @ {home} at {start.astimezone(ET):%a %-I:%M %p} ET")
    return workflow, problems


def main():
    now = datetime.now(timezone.utc)
    rerun = set()
    for sport in SPORTS:
        try:
            workflow, problems = check(sport, now)
        except Exception as e:  # a feed that's down is not a reason to rerun
            print(f"{sport}: couldn't check ({e})")
            continue
        if problems:
            rerun.add(workflow)
            print(f"::warning::{sport}: " + "; ".join(problems[:5]) + (f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""))
        else:
            print(f"{sport}: OK")
    print("Rerun: " + (", ".join(sorted(rerun)) or "nothing"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"daily={'true' if 'daily.yml' in rerun else 'false'}\n")
            f.write(f"weekly={'true' if 'weekly-picks.yml' in rerun else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
