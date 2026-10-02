"""
fd.py - league results and closing odds from football-data.co.uk, one CSV
per league per season: https://www.football-data.co.uk/mmz4281/<YYZZ>/<code>.csv

The top five leagues train the team ratings, with five more whose clubs are
Champions League regulars (Portugal, the Netherlands, Belgium, Turkey and
Scotland) so those clubs are rated from their own league too. Every match
keeps its full-time score (league games have no extra time), its shots and
shots on target (the ratings' expected-goals proxy) and the bookmaker's
closing odds, for the backtest's market comparison.
"""

import csv
import io
import time
from datetime import datetime

import requests

BASE = "https://www.football-data.co.uk/mmz4281"
LEAGUES = {
    "E0": "Premier League", "SP1": "La Liga", "D1": "Bundesliga", "I1": "Serie A", "F1": "Ligue 1",
    "P1": "Primeira Liga", "N1": "Eredivisie", "B1": "Belgian Pro League", "T1": "Super Lig", "SC0": "Scottish Premiership",
}
TOP5 = ("E0", "SP1", "D1", "I1", "F1")
# Closing odds first (Pinnacle, then the market average, then Bet365), then
# the opening prices of the same books for seasons without closing ones.
ODDS_COLUMNS = [("PSCH", "PSCD", "PSCA"), ("AvgCH", "AvgCD", "AvgCA"), ("B365CH", "B365CD", "B365CA"),
                ("PSH", "PSD", "PSA"), ("AvgH", "AvgD", "AvgA"), ("B365H", "B365D", "B365A")]

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (Soccer Edge; github.com/ant56-arch/ant56-arch.github.io)"


def season_code(season):
    """2025 (the 2025-26 season) -> "2526"."""
    return f"{season % 100:02d}{(season + 1) % 100:02d}"


def url(code, season):
    return f"{BASE}/{season_code(season)}/{code}.csv"


def _date(text):
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _odds(row):
    for cols in ODDS_COLUMNS:
        try:
            vals = [float(row[c]) for c in cols]
        except (KeyError, TypeError, ValueError):
            continue
        if all(v > 1 for v in vals):
            return [round(v, 3) for v in vals]
    return None


def _shots(row):
    """[home shots, away shots, home on target, away on target], or None."""
    try:
        return [int(row[c]) for c in ("HS", "AS", "HST", "AST")]
    except (KeyError, TypeError, ValueError):
        return None


def parse(text, code, season):
    """CSV text -> [{"id", "comp", "date", "season", "home", "away", "hg", "ag", "odds", "shots"}]."""
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip().lstrip("﻿"): (v or "").strip() for k, v in row.items()}
        d = _date(row.get("Date", ""))
        try:
            hg, ag = int(row["FTHG"]), int(row["FTAG"])
        except (KeyError, ValueError):
            continue  # a fixture still to play, or a blank line
        home, away = row.get("HomeTeam") or row.get("Home"), row.get("AwayTeam") or row.get("Away")
        if not (d and home and away):
            continue
        out.append({"id": f"{code}-{d}-{home}-{away}".replace(" ", "_"), "comp": code, "date": d, "season": season,
                    "home": home, "away": away, "hg": hg, "ag": ag, "odds": _odds(row), "shots": _shots(row), "src": "fd"})
    return out


def fetch(code, season):
    """One league-season's results: [] if the file isn't there (a league whose
    season hasn't started, or a code football-data.co.uk doesn't carry), None
    if the site couldn't be reached, so a caller never overwrites good data."""
    for attempt in range(3):
        try:
            r = session.get(url(code, season), timeout=30)
            if r.status_code == 404:
                return []
            r.raise_for_status()
            raw = r.content
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            return parse(text, code, season)
        except requests.RequestException as e:
            if attempt == 2:
                print(f"  {code} {season_code(season)} unavailable: {e}")
                return None
            time.sleep(2 ** attempt)
