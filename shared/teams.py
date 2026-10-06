"""Writes teams.json at the repo root: every team in each league, for the
My teams picker (shared/edge.js). ESPN's team lists can't be read from the
browser, so the Update team lists workflow fetches them here once a week.

    python shared/teams.py

A league whose lists can't be read keeps its teams from the last run."""
import json
import os
import sys
import urllib.request

# Same lists as EDGE_TEAM_LISTS in shared/edge.js: (ESPN path, query).
LISTS = {
    "NFL": [("football/nfl", "")],
    "CFB": [("football/college-football", "groups=80&limit=300")],
    "MLB": [("baseball/mlb", "")],
    "NBA": [("basketball/nba", "")],
    "NHL": [("hockey/nhl", "")],
    "CBB": [("basketball/mens-college-basketball", "groups=50&limit=500")],
    "Soccer": [("soccer/eng.1", ""), ("soccer/esp.1", ""), ("soccer/uefa.champions", "")],
}
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "teams.json")


def fetch(path, query):
    url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/teams" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Sports Edge; github.com/ant56-arch/ant56-arch.github.io)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    teams = ((((data.get("sports") or [{}])[0].get("leagues") or [{}])[0]).get("teams")) or []
    return [t.get("team") or {} for t in teams]


def main():
    try:
        with open(OUT) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    out = {}
    for sport, lists in LISTS.items():
        seen = {}
        try:
            for path, query in lists:
                for t in fetch(path, query):
                    abbr = t.get("abbreviation")
                    if not abbr or abbr in seen:
                        continue
                    seen[abbr] = {"abbr": abbr, "name": t.get("displayName") or t.get("shortDisplayName") or abbr,
                                  "logo": ((t.get("logos") or [{}])[0]).get("href", "")}
        except Exception as e:  # noqa: BLE001 - any failure keeps last week's list
            print(f"  {sport}: couldn't read ESPN ({e}); keeping {len(old.get(sport, []))} teams from last time")
            seen = {}
        teams = sorted(seen.values(), key=lambda t: t["name"]) or old.get(sport, [])
        print(f"{sport}: {len(teams)} teams")
        out[sport] = teams
    if not any(out.values()):
        sys.exit("No team lists read")
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
