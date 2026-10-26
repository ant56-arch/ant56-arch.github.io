"""
xg.py - expected goals (xG) per game from MoneyPuck (moneypuck.com, free, no
key). Expected goals rate every shot by how often a shot like it scores, so a
team's xG share says how well it's really playing, with less luck than goals.

nhl/data/xg.json holds {"YYYY-MM-DD|HOME|AWAY": [home xG, away xG]} for every
stored game. merge_into_box() adds it to the box scores the model walks with
(box[team]["xg"] = (xG for, xG against)), so training and the daily picks see
the same thing. refresh() pulls MoneyPuck's game log and rewrites the file.
"""
import csv
import gzip
import io
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "data", "xg.json")
URL = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv"
# MoneyPuck team code -> ESPN's
TEAM = {"LAK": "LA", "NJD": "NJ", "SJS": "SJ", "TBL": "TB"}
FIRST_SEASON = 2023  # MoneyPuck's start year of the oldest stored season (2023-24)


def _key(day, home, away):
    return f"{day}|{home}|{away}"


def load():
    try:
        with open(PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def from_csv(text):
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("situation", "all") != "all" or r.get("position", "Team Level") != "Team Level":
            continue
        if int(r["season"]) < FIRST_SEASON or r["home_or_away"] != "HOME":
            continue
        d = r["gameDate"]
        day = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        home, away = TEAM.get(r["playerTeam"], r["playerTeam"]), TEAM.get(r["opposingTeam"], r["opposingTeam"])
        out[_key(day, home, away)] = [round(float(r["xGoalsFor"]), 3), round(float(r["xGoalsAgainst"]), 3)]
    return out


def refresh():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (NHL Edge)"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    data = from_csv(raw.decode("utf-8", "replace"))
    if len(data) < 1000:
        raise RuntimeError(f"MoneyPuck returned only {len(data)} games")
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as f:
        json.dump(data, f, separators=(",", ":"), sort_keys=True)
    return data


def _alias(t):
    return "UTA" if t == "UTAH" else t


def merge_into_box(games, box, data=None):
    """Adds xG to each game's box score entry, when MoneyPuck has the game."""
    data = load() if data is None else data
    n = 0
    for g in games:
        v = data.get(_key(g["date"], _alias(g["home"]), _alias(g["away"])))
        if not v:
            continue
        b = box.setdefault(g["id"], {})
        b.setdefault(g["home"], {})["xg"] = (v[0], v[1])
        b.setdefault(g["away"], {})["xg"] = (v[1], v[0])
        n += 1
    return n


if __name__ == "__main__":
    print(len(refresh()), "games")
