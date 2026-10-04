"""
fetch_td_odds.py
Anytime touchdown scorer prices from the-odds-api.com, for the TD Scorers tab
and the TD props record (track_td_props.py).

Player props are only sold per game: listing the week's events is free, and
each game's anytime-TD market costs 1 credit (1 market, DraftKings and
FanDuel only, which is under one region's worth of books). To stay inside the
free 500 credits a month next to the game lines (~300), a game is only
fetched when it kicks off within FETCH_WINDOW_HOURS and its last logged price
is older than REFRESH_HOURS. On the normal schedule that's about two pulls
per game a week (~18 credits a week): one the day of the game and one just
before the night games.

Prices: DraftKings, else FanDuel. When the book also posts a "No" price the
vig is removed by normalizing the pair; most only post "Yes", and then the
implied chance is divided by the slate's typical Yes+No total from players
that have both (or DEFAULT_OVERROUND when none do).

Requires GitHub Secret: ODDS_API_KEY
Output: data/raw/td_odds.csv (only games fetched this run)
"""

import os
import re
import unicodedata

import numpy as np
import pandas as pd
import requests

import moneyline
from fetch_odds import TEAM_NAME_TO_ABBR

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "tracking", "td_props_log.csv")
OUT_PATH = os.path.join(RAW_DIR, "td_odds.csv")
API = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
MARKET = "player_anytime_td"
BOOKS = ["draftkings", "fanduel"]
FETCH_WINDOW_HOURS = 12
REFRESH_HOURS = 6
DEFAULT_OVERROUND = 1.08
COLUMNS = ["event_id", "commence_time", "home_team", "away_team", "player_id", "odds_name",
           "book", "price", "no_price", "book_prob", "odds_at"]


def name_key(name):
    """'Kenneth Walker III' and 'Kenneth Walker' -> 'kennethwalker'."""
    name = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", name)
    return re.sub(r"[^a-z]", "", name)


def roster_lookup(roster):
    """(team, name key) -> gsis_id, under the full name and the 'football name'
    (Bijan, not Bijan Robinson's legal first name) so either spelling matches."""
    out = {}
    for _, r in roster.dropna(subset=["gsis_id", "team"]).iterrows():
        for first in {r.get("first_name"), r.get("football_name")}:
            if isinstance(first, str) and isinstance(r.get("last_name"), str):
                out[(r["team"], name_key(f"{first} {r['last_name']}"))] = r["gsis_id"]
        if isinstance(r.get("full_name"), str):
            out[(r["team"], name_key(r["full_name"]))] = r["gsis_id"]
    return out


def last_fetched(log):
    """game (home, away, commence) -> when its TD prices were last pulled."""
    if log is None or log.empty or "odds_at" not in log.columns:
        return {}
    got = log.dropna(subset=["odds_at"])
    return pd.to_datetime(got.groupby("event_id")["odds_at"].max(), utc=True).to_dict()


def events_to_fetch(events, fetched, now):
    out = []
    for e in events:
        start = pd.Timestamp(e["commence_time"])
        if not (now < start <= now + pd.Timedelta(hours=FETCH_WINDOW_HOURS)):
            continue
        last = fetched.get(e["id"])
        if last is not None and last > now - pd.Timedelta(hours=REFRESH_HOURS):
            continue
        out.append(e)
    return out


def parse_event(event, lookup, now):
    """One row per player from the preferred book's anytime-TD market."""
    home = TEAM_NAME_TO_ABBR.get(event["home_team"], event["home_team"])
    away = TEAM_NAME_TO_ABBR.get(event["away_team"], event["away_team"])
    books = {b["key"]: b for b in event.get("bookmakers", [])}
    prices = {}
    for key in BOOKS:  # preferred book first; the other only fills gaps
        for market in books.get(key, {}).get("markets", []):
            if market["key"] != MARKET:
                continue
            for o in market["outcomes"]:
                player = o.get("description") or o.get("name")
                side = "no" if o.get("name") in ("No", "Under") else "yes"
                entry = prices.setdefault(player, {"book": key})
                if entry["book"] == key:
                    entry.setdefault(side, o["price"])
    rows, unmatched = [], []
    for player, p in prices.items():
        if "yes" not in p:
            continue
        pid = lookup.get((home, name_key(player))) or lookup.get((away, name_key(player)))
        if pid is None:
            unmatched.append(player)
        rows.append({
            "event_id": event["id"], "commence_time": event["commence_time"],
            "home_team": home, "away_team": away, "player_id": pid, "odds_name": player,
            "book": p["book"], "price": p["yes"], "no_price": p.get("no", np.nan),
            "odds_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    if unmatched:
        print(f"  {away}@{home}: no roster match for {len(unmatched)}: {', '.join(unmatched[:6])}")
    return rows


def add_book_prob(df):
    """No-vig chance to score: from the Yes/No pair when there is one, else
    the Yes price over the slate's typical overround."""
    if df.empty:
        df["book_prob"] = []
        return df
    yes = df["price"].map(moneyline.implied_prob)
    no = df["no_price"].map(moneyline.implied_prob)
    pair = yes + no
    overround = pair.dropna().median() if pair.notna().any() else DEFAULT_OVERROUND
    df["book_prob"] = np.where(pair.notna(), yes / pair, yes / overround).round(4)
    return df


def main():
    api_key = os.environ.get("ODDS_API_KEY")
    if not api_key:
        print("ODDS_API_KEY not set; skipping anytime TD odds.")
        return
    now = pd.Timestamp.now(tz="UTC")
    events = requests.get(f"{API}/events", params={"apiKey": api_key}, timeout=30)
    events.raise_for_status()
    log = pd.read_csv(LOG_PATH) if os.path.exists(LOG_PATH) else None
    todo = events_to_fetch(events.json(), last_fetched(log), now)
    print(f"Anytime TD odds: {len(todo)} game(s) kicking off within {FETCH_WINDOW_HOURS}h need prices")

    roster = pd.read_csv(os.path.join(RAW_DIR, "current_roster.csv"), low_memory=False)
    lookup = roster_lookup(roster)
    rows = []
    for e in todo:
        r = requests.get(f"{API}/events/{e['id']}/odds", timeout=30, params={
            "apiKey": api_key, "markets": MARKET, "bookmakers": ",".join(BOOKS),
            "oddsFormat": "american", "dateFormat": "iso"})
        if r.status_code == 404:  # event dropped between the two calls
            continue
        r.raise_for_status()
        rows += parse_event(r.json(), lookup, now)
        print(f"  {e['away_team']} at {e['home_team']}: credits left {r.headers.get('x-requests-remaining')}")
    df = add_book_prob(pd.DataFrame(rows, columns=[c for c in COLUMNS if c != "book_prob"]))
    df[COLUMNS].to_csv(OUT_PATH, index=False)
    print(f"  Saved {len(df)} player prices to {OUT_PATH}")


if __name__ == "__main__":
    main()
