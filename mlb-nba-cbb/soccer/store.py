"""
store.py - where Soccer Edge keeps match results.

  soccer/data/fd/<season>.json    league results and closing odds from
                                  football-data.co.uk (fd.py), every league,
                                  one file per season (2025 = 2025-26)
  soccer/data/ucl/<season>.json   Champions League results from ESPN
  soccer/data/days/<date>.json    each day's Premier League, La Liga and
                                  Champions League finals from ESPN, written
                                  by the daily run; picks are graded from these

load_matches() merges them into one list for the ratings, each match once:
a league match in both a football-data file and a day file counts once.
Team names are stored as each source wrote them and keyed (names.py) on load,
so a fixed alias applies to every stored season.
"""

import glob
import json
import os

import names

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
FD_DIR = os.path.join(DATA, "fd")
UCL_DIR = os.path.join(DATA, "ucl")
DAYS_DIR = os.path.join(DATA, "days")
# ESPN competition -> football-data.co.uk league code.
LEAGUE_OF = {"EPL": "E0", "LALIGA": "SP1"}


def _read(path):
    with open(path) as f:
        return json.load(f)


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))


FD_FIELDS = ("comp", "date", "home", "away", "hg", "ag", "odds", "shots")


def _fd_full(m, season):
    return {**m, "id": f"{m['comp']}-{m['date']}-{m['home']}-{m['away']}".replace(" ", "_"), "season": season, "src": "fd"}


def save_fd(season, matches):
    rows = sorted(({k: m.get(k) for k in FD_FIELDS} for m in matches), key=lambda m: (m["date"], m["comp"], m["home"]))
    _write(os.path.join(FD_DIR, f"{season}.json"), {"season": season, "matches": rows})


def load_fd(season):
    path = os.path.join(FD_DIR, f"{season}.json")
    return [_fd_full(m, season) for m in _read(path)["matches"]] if os.path.exists(path) else []


def save_ucl(season, matches):
    keep = ("id", "comp", "date", "start", "season", "home_name", "away_name", "hg", "ag", "neutral", "reg_known", "extra")
    rows = [{k: m.get(k) for k in keep} for m in matches if m.get("final")]
    _write(os.path.join(UCL_DIR, f"{season}.json"), {"matches": sorted(rows, key=lambda m: (m["start"], m["id"]))})


def save_day(day, games):
    keep = [{k: v for k, v in g.items() if k != "odds"} for g in games]
    _write(os.path.join(DAYS_DIR, f"{day}.json"), {"games": keep})


def day_games():
    """Every stored ESPN match from the day files, by id."""
    out = {}
    for path in sorted(glob.glob(os.path.join(DAYS_DIR, "*.json"))):
        for g in _read(path)["games"]:
            out[g["id"]] = g
    return out


def _espn_row(m, league):
    return {"id": m["id"], "league": league, "comp": m["comp"], "date": m["date"], "season": m["season"],
            "home": m.get("home_name") or m.get("home"), "away": m.get("away_name") or m.get("away"),
            "hg": m["hg"], "ag": m["ag"], "neutral": bool(m.get("neutral")), "odds": None, "src": "espn"}


def load_matches():
    """Every usable result in date order: {"id", "league" (football-data code,
    None for the Champions League), "comp", "date", "season", "home", "away",
    "hk", "ak" (team keys), "hg", "ag" (goals in regular time), "neutral", "odds"}."""
    rows, seen = [], set()

    def add(r):
        r["hk"], r["ak"] = names.team_key(r["home"]), names.team_key(r["away"])
        key = (r["league"], r["season"], r["hk"], r["ak"]) if r["league"] else ("UCL", r["id"])
        if key in seen or r["hk"] == r["ak"]:
            return
        seen.add(key)
        rows.append(r)

    for path in sorted(glob.glob(os.path.join(FD_DIR, "*.json"))):
        d = _read(path)
        for m in d["matches"]:
            add({**_fd_full(m, d["season"]), "league": m["comp"], "neutral": False})
    for path in sorted(glob.glob(os.path.join(UCL_DIR, "*.json"))):
        for m in _read(path)["matches"]:
            if m.get("reg_known") and m.get("hg") is not None:
                add(_espn_row(m, None))
    for g in day_games().values():
        if g.get("final") and g.get("reg_known") and g.get("hg") is not None:
            add(_espn_row(g, LEAGUE_OF.get(g["comp"])))
    rows.sort(key=lambda r: (r["date"], r["id"]))
    return rows
