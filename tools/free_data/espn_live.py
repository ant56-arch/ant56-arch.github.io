"""Saves ESPN's NFL scoreboard and the live game summaries (plays, drives,
win probability, box score) to out/espn_live/, as samples for building the
live game view on the game pages. The Claude sandbox can't reach ESPN."""
import json
import os
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/"
OUT = os.path.join("out", "espn_live")
os.makedirs(OUT, exist_ok=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Sports Edge research)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


for league in ("nfl", "college-football"):
    board = get(f"{BASE}{league}/scoreboard")
    with open(os.path.join(OUT, f"{league}_scoreboard.json"), "w") as f:
        json.dump(board, f)
    events = board.get("events", [])
    by_state = {}
    for e in events:
        state = e["competitions"][0]["status"]["type"]["state"]
        by_state.setdefault(state, []).append(e["id"])
    print(league, {k: len(v) for k, v in by_state.items()})
    for eid in by_state.get("in", [])[:3] + by_state.get("post", [])[:1] + by_state.get("pre", [])[:1]:
        with open(os.path.join(OUT, f"{league}_summary_{eid}.json"), "w") as f:
            json.dump(get(f"{BASE}{league}/summary?event={eid}"), f)
        print("  saved", eid)
