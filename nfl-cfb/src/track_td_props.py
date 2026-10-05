"""
track_td_props.py
Logs and grades anytime-TD picks: data/tracking/td_props_log.csv and
data/tracking/td_props_summary.json.

Each run:
  1. SNAPSHOT - every player with a book price this run (fetch_td_odds.py)
     plus our top 10 most likely scorers, with our chance, the book's
     no-vig chance, the edge (ours minus the book's) and a Value flag at an
     edge of VALUE_EDGE or more (the same 6 points as the moneyline picks)
     at a price no longer than VALUE_MAX_PRICE.
     Rows update until kickoff, then lock. A price only changes when a new
     one was fetched; a player dropped from the projections before kickoff
     (ruled out) is dropped from the log.
  2. GRADE - once the game is final and in the play-by-play: scored if he had
     a rushing or receiving TD (passing TDs don't count, a QB's own runs do).
     No carry or target at all counts as no decision (the closest the
     play-by-play gets to "didn't play", where books void the bet).
     Value picks are graded at $10 a pick at the locked price.
"""

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import moneyline
import td_model
from fetch_data import current_nfl_season

BASE = os.path.join(os.path.dirname(__file__), "..", "data")
PROPS_PATH = os.path.join(BASE, "processed", "player_props.csv")
ODDS_PATH = os.path.join(BASE, "raw", "td_odds.csv")
LOG_PATH = os.path.join(BASE, "tracking", "td_props_log.csv")
SUMMARY_PATH = os.path.join(BASE, "tracking", "td_props_summary.json")
VALUE_EDGE = moneyline.VALUE_EDGE
# Long shots never get a Value tag. Past +300 the book is usually pricing a
# depth-chart change the play-by-play hasn't shown yet (a new starter, a back
# who lost his job), and on the first live slate nearly every "edge" out there
# was a backup we still rated on his old role.
VALUE_MAX_PRICE = 300
STAKE = 10
TOP_N = 10
KEY = ["season", "week", "player_id"]
ODDS_COLS = ["event_id", "book", "price", "book_prob", "odds_at", "odds_name"]
LOG_COLS = KEY + ["player_name", "pos", "team", "opponent", "kickoff", "our_prob", "top10",
                  *ODDS_COLS, "edge", "value", "tds", "result", "profit"]


def read_csv(path):
    if not os.path.exists(path) or os.path.getsize(path) <= 1:
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return pd.DataFrame()


def kickoff_ts(values):
    values = values if isinstance(values, pd.Series) else pd.Series(values)
    return pd.to_datetime(values, utc=True, errors="coerce", format="ISO8601")


def kickoffs(schedules):
    """(season, week, team) -> kickoff in UTC, from the schedule's ET date and time."""
    s = schedules.dropna(subset=["gameday"]).copy()
    when = pd.to_datetime(s["gameday"].astype(str) + " " + s["gametime"].fillna("13:00").astype(str), errors="coerce")
    s["kickoff"] = when.dt.tz_localize("America/New_York", nonexistent="shift_forward",
                                       ambiguous="NaT").dt.tz_convert("UTC")
    out = {}
    for _, g in s.iterrows():
        for team in (g["home_team"], g["away_team"]):
            out[(int(g["season"]), int(g["week"]), team)] = g["kickoff"]
    return out


def snapshot(props, odds, kick):
    if props.empty or "td_prob" not in props.columns:
        return pd.DataFrame(columns=LOG_COLS)
    p = props.dropna(subset=["td_prob"]).copy()
    if p.empty:
        return pd.DataFrame(columns=LOG_COLS)
    # The top 10 is from the main slate: not a team on a bye (projected for its
    # next game) or a Monday game left over from the week before
    main = p.groupby(["season", "week"]).size().idxmax()
    slate = p[(p["season"] == main[0]) & (p["week"] == main[1])]
    p["top10"] = p["player_id"].isin(slate.nlargest(TOP_N, "td_prob")["player_id"])
    if not odds.empty:
        o = odds.dropna(subset=["player_id"]).drop_duplicates("player_id", keep="last")
        p = p.merge(o[["player_id"] + ODDS_COLS], on="player_id", how="left")
    for c in ODDS_COLS:
        if c not in p.columns:
            p[c] = np.nan
    p["season"], p["week"] = p["season"].astype(int), p["week"].astype(int)
    p["kickoff"] = [k.strftime("%Y-%m-%dT%H:%M:%SZ") if pd.notna(k := kick.get((s, w, t))) else None
                    for s, w, t in zip(p["season"], p["week"], p["team"])]
    p["our_prob"] = p["td_prob"].round(4)
    return p.reindex(columns=LOG_COLS)


def merge_snapshot(log, snap, now):
    """Upcoming rows take this run's numbers; prices only when a new one was
    fetched. Started games keep what was logged before kickoff."""
    if log.empty:
        log = pd.DataFrame(columns=LOG_COLS)
    started = kickoff_ts(log["kickoff"]) <= now
    locked, open_ = log[started], log[~started].set_index(KEY)
    snap = snap[kickoff_ts(snap["kickoff"]) > now].set_index(KEY)
    snap = snap[~snap.index.isin(locked.set_index(KEY).index)]
    fresh = snap.copy()
    keep = open_.reindex(fresh.index)
    no_new_price = fresh["price"].isna()
    for c in ODDS_COLS:
        fresh[c] = fresh[c].astype(object).where(~no_new_price, keep[c].astype(object))
    for c in ("price", "book_prob", "our_prob"):
        fresh[c] = pd.to_numeric(fresh[c], errors="coerce")
    fresh["edge"] = (fresh["our_prob"] - fresh["book_prob"]).round(4)
    fresh["value"] = fresh["price"].notna() & (fresh["edge"] >= VALUE_EDGE) & (fresh["price"] <= VALUE_MAX_PRICE)
    fresh = fresh[fresh["top10"].astype(bool) | fresh["price"].notna()]
    out = pd.concat([locked, fresh.reset_index()], ignore_index=True)
    return out.reindex(columns=LOG_COLS).sort_values(["season", "week", "kickoff", "our_prob"],
                                                     ascending=[True, True, True, False])


def grade(log, schedules, pbp):
    if log.empty or pbp is None:
        return log
    log = log.reset_index(drop=True)
    log["result"] = log["result"].astype(object)
    log["tds"], log["profit"] = pd.to_numeric(log["tds"]), pd.to_numeric(log["profit"])
    final = set()
    for _, g in schedules[schedules["result"].notna()].iterrows():
        final.add((int(g["season"]), int(g["week"]), g["home_team"]))
        final.add((int(g["season"]), int(g["week"]), g["away_team"]))
    opps = td_model.opportunities(pbp)
    played = set(zip(opps["season"], opps["week"], opps["team"]))
    touches = opps.groupby(["season", "week", "team", "player_id"])["td"].sum().to_dict()
    for i, r in log[log["result"].isna()].iterrows():
        k = (int(r["season"]), int(r["week"]), r["team"])
        if k not in final or k not in played:
            continue
        tds = touches.get(k + (r["player_id"],))
        if tds is None:
            log.at[i, "result"] = "void"
            log.at[i, "profit"] = 0.0
            continue
        won = tds > 0
        log.at[i, "tds"] = int(tds)
        log.at[i, "result"] = "W" if won else "L"
        if bool(r["value"]) and pd.notna(r["price"]):
            log.at[i, "profit"] = round(STAKE * moneyline.profit_units(r["price"], won), 2)
    return log


def summarize(log, season):
    g = log[(log["season"] == season) & log["result"].isin(["W", "L"])]
    v = g[g["value"].astype(bool)]
    priced = g[g["book_prob"].notna()]
    top = g[g["top10"].astype(bool)]
    risked = STAKE * len(v)
    profit = float(v["profit"].fillna(0).sum())
    y = (priced["result"] == "W").astype(float)
    return {
        "season": int(season),
        "value": {"wins": int((v["result"] == "W").sum()), "losses": int((v["result"] == "L").sum()),
                  "profit": round(profit, 2), "risked": risked,
                  "roi": round(profit / risked, 4) if risked else None},
        "top10": {"scored": int((top["result"] == "W").sum()), "graded": int(len(top)),
                  "predicted": round(float(top["our_prob"].mean()), 3) if len(top) else None},
        "vs_book": {"n": int(len(priced)),
                    "our_brier": round(float(((priced["our_prob"] - y) ** 2).mean()), 4) if len(priced) else None,
                    "book_brier": round(float(((priced["book_prob"] - y) ** 2).mean()), 4) if len(priced) else None},
    }


def record_season(log, current):
    """The season the record shows: this one once it has a graded pick, else
    the last one that did (so the offseason keeps last season's record up)."""
    graded = log[log["result"].isin(["W", "L"])] if not log.empty else log
    if graded.empty or (graded["season"] == current).any():
        return current
    return int(graded["season"].max())


def main():
    now = pd.Timestamp.now(tz="UTC")
    schedules = pd.read_csv(os.path.join(BASE, "raw", "schedules.csv"))
    pbp_path = os.path.join(BASE, "raw", "pbp_combined.parquet")
    pbp = pd.read_parquet(pbp_path, columns=td_model.PBP_COLUMNS) if os.path.exists(pbp_path) else None
    log = read_csv(LOG_PATH)
    snap = snapshot(read_csv(PROPS_PATH), read_csv(ODDS_PATH), kickoffs(schedules))
    log = merge_snapshot(log, snap, now)
    log = grade(log, schedules, pbp)
    log.to_csv(LOG_PATH, index=False)
    summary = summarize(log, record_season(log, current_nfl_season()))
    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2)
    up = log[kickoff_ts(log["kickoff"]) > now]
    print(f"TD props: {len(up)} upcoming ({int(up['price'].notna().sum())} priced, "
          f"{int(up['value'].astype(bool).sum())} Value); season Value record "
          f"{summary['value']['wins']}-{summary['value']['losses']}, ${summary['value']['profit']:+.2f}")


if __name__ == "__main__":
    main()
