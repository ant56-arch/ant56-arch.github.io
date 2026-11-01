"""Saves ESPN scoreboards and a few game summaries (plays, win probability,
box score) for MLB, NBA, NHL, men's college basketball and soccer to
out/espn_live/, as samples for building the live game view on those game
pages. The Claude sandbox can't reach ESPN."""
import json
import os
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports/"
OUT = os.path.join("out", "espn_live")
os.makedirs(OUT, exist_ok=True)
LEAGUES = {"nba": "basketball/nba", "nhl": "hockey/nhl", "cbb": "basketball/mens-college-basketball",
           "epl": "soccer/eng.1", "laliga": "soccer/esp.1", "ucl": "soccer/uefa.champions",
           "mlb": "baseball/mlb"}
DATES = {"mlb": "20261027", "epl": "20261101", "laliga": "20261101", "ucl": "20261022"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Sports Edge research)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


for key, path in LEAGUES.items():
    try:
        q = f"?dates={DATES[key]}" if key in DATES else ""
        board = get(f"{BASE}{path}/scoreboard{q}")
    except Exception as e:  # one league down shouldn't stop the rest
        print(key, "failed", e)
        continue
    with open(os.path.join(OUT, f"{key}_scoreboard.json"), "w") as f:
        json.dump(board, f)
    by_state = {}
    for e in board.get("events", []):
        by_state.setdefault(e["competitions"][0]["status"]["type"]["state"], []).append(e["id"])
    print(key, {k: len(v) for k, v in by_state.items()})
    for eid in by_state.get("in", [])[:2] + by_state.get("post", [])[:1] + by_state.get("pre", [])[:1]:
        try:
            with open(os.path.join(OUT, f"{key}_summary_{eid}.json"), "w") as f:
                json.dump(get(f"{BASE}{path}/summary?event={eid}"), f)
            print("  saved", eid)
        except Exception as e:
            print("  failed", eid, e)
