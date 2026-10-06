"""
cfb_trends.py
Season-so-far college football stats measured against every season since
1989 at the same point of the year (Trends tab). Each stat is computed for
FBS-vs-FBS regular-season games through the same weekend of the calendar
(e.g. "through the first weekend of October"), then this season is ranked
against history so the page can lead with whatever is most unusual.

Data (CollegeFootballData.com): games, FBS membership by season, the AP
poll (rank at kickoff), and the consensus Vegas line (2013 on). Finished
seasons are cached in data/tracking/cfb_trends_history.csv so a normal run
only pulls the current season (about 4 calls).

Usage:
  python src/cfb_trends.py            # refresh data/tracking/cfb_trends.json
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from fetch_cfb_data import _get, _headers, current_cfb_season

TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
HISTORY_PATH = os.path.join(TRACKING_DIR, "cfb_trends_history.csv")
OUT_PATH = os.path.join(TRACKING_DIR, "cfb_trends.json")
FIRST_SEASON = 1989          # the AP poll went to 25 teams
LINES_FROM = 2013            # CFBD's betting lines start here
COLS = ["id", "season", "week", "date", "neutral", "home_team", "away_team", "home_score", "away_score",
        "home_rank", "away_rank", "spread", "total"]


# ---------------------------------------------------------------- data

def _poll_ranks(season):
    """[(week, {team: rank})] for the AP poll, preseason first. CFBD labels
    the poll released after week N's games as week N+1, so the poll with
    week W is the one in force at kickoff of week W games."""
    out = []
    for season_type in ("preseason", "regular"):
        try:
            rows = _get("/rankings", {"year": season, "seasonType": season_type})
        except Exception as e:  # noqa: BLE001
            print(f"  No {season_type} rankings {season}: {e}")
            continue
        for wk in rows:
            for poll in wk.get("polls") or []:
                if poll.get("poll") == "AP Top 25":
                    ranks = {(r.get("school") or r.get("team")): r.get("rank") for r in poll.get("ranks") or []}
                    out.append((0 if season_type == "preseason" else int(wk.get("week") or 0), ranks))
    return sorted(out, key=lambda x: x[0])


def _rank_at_kickoff(polls, week):
    """Most recent AP poll labeled at or before this game's week."""
    ranks = {}
    for w, r in polls:
        if w <= week:
            ranks = r
    return ranks


def fetch_season(season):
    games = pd.DataFrame(_get("/games", {"year": season, "seasonType": "regular"}))
    if games.empty:
        return pd.DataFrame(columns=COLS)
    fbs = {t.get("school") for t in _get("/teams/fbs", {"year": season})}
    games = games[games["homeTeam"].isin(fbs) & games["awayTeam"].isin(fbs)]
    games = games.dropna(subset=["homePoints", "awayPoints"])
    polls = _poll_ranks(season)
    lines = {}
    if season >= LINES_FROM:
        try:
            for g in _get("/lines", {"year": season, "seasonType": "regular"}):
                ls = g.get("lines") or []
                p = next((x for x in ls if x.get("provider") == "consensus"), ls[0] if ls else None)
                if p:
                    lines[g.get("id")] = (p.get("spread"), p.get("overUnder"))
        except Exception as e:  # noqa: BLE001
            print(f"  No lines {season}: {e}")
    rows = []
    for g in games.to_dict("records"):
        ranks = _rank_at_kickoff(polls, int(g.get("week") or 0))
        spread, total = lines.get(g["id"], (None, None))
        start = pd.to_datetime(g.get("startDate"), utc=True, errors="coerce")
        # US kickoff date: late kickoffs are already the next day in UTC
        day = (start - pd.Timedelta(hours=8)).date().isoformat() if pd.notna(start) else None
        rows.append({"id": g["id"], "season": season, "week": g.get("week"), "date": day,
                     "neutral": bool(g.get("neutralSite")), "home_team": g["homeTeam"], "away_team": g["awayTeam"],
                     "home_score": g["homePoints"], "away_score": g["awayPoints"],
                     "home_rank": ranks.get(g["homeTeam"]), "away_rank": ranks.get(g["awayTeam"]),
                     # CFBD spread is from the home side (negative = home favored)
                     "spread": -float(spread) if spread is not None else None,
                     "total": float(total) if total is not None else None})
    return pd.DataFrame(rows, columns=COLS)


def load_games(season_now):
    hist = pd.read_csv(HISTORY_PATH) if os.path.exists(HISTORY_PATH) else pd.DataFrame(columns=COLS)
    have = set(hist["season"].unique())
    missing = [y for y in range(FIRST_SEASON, season_now) if y not in have]
    if missing:
        print(f"  Caching {len(missing)} past seasons ({missing[0]}-{missing[-1]})...")
        fresh = [fetch_season(y) for y in missing]
        hist = pd.concat([hist] + fresh, ignore_index=True).sort_values(["season", "date", "id"])
        hist.to_csv(HISTORY_PATH, index=False)
    cur = fetch_season(season_now)
    return pd.concat([hist, cur], ignore_index=True)


# ---------------------------------------------------------------- the cutoff

def _saturdays(year, month):
    d = date(year, month, 1)
    d += timedelta(days=(5 - d.weekday()) % 7)
    out = []
    while d.month == month:
        out.append(d)
        d += timedelta(days=7)
    return out


def cutoff_for(season, anchor):
    """The same weekend in `season` as `anchor` (a Saturday) is in its own
    season: the Nth Saturday of the same month, through the Monday after."""
    n = _saturdays(anchor.year, anchor.month).index(anchor)
    sats = _saturdays(season, anchor.month)
    return sats[min(n, len(sats) - 1)] + timedelta(days=2)


def weekend_label(anchor):
    n = _saturdays(anchor.year, anchor.month).index(anchor)
    nth = ["first", "second", "third", "fourth", "fifth"][n]
    return f"{nth} weekend of {anchor.strftime('%B')}"


# ---------------------------------------------------------------- stats

def _ranked(r):
    return pd.notna(r) and r != ""


def _prep(g):
    g = g.copy()
    g["margin"] = g["home_score"] - g["away_score"]
    g["hr"] = pd.to_numeric(g["home_rank"], errors="coerce")
    g["ar"] = pd.to_numeric(g["away_rank"], errors="coerce")
    return g


def ranked_vs_unranked(g, top=25):
    """(wins, losses, upset games) for AP top-`top` teams vs unranked FBS."""
    h = g[(g.hr <= top) & g.ar.isna()]
    a = g[(g.ar <= top) & g.hr.isna()]
    ups = pd.concat([h[h.margin < 0], a[a.margin > 0]])
    wins = int((h.margin > 0).sum() + (a.margin < 0).sum())
    return wins, len(ups), ups


STATS = [
    # key, title, kind, higher-is ("more"/"fewer"), since, formatter
    ("upset_rate", "Ranked vs unranked", "pct", "upsets"),
    ("top10_loss", "AP top 10 vs unranked", "pct", "losses"),
    ("rvr_upset", "Ranked vs ranked", "pct", "upsets"),
    ("home_win", "Home field", "pct", "home wins"),
    ("points", "Scoring", "num", "points"),
    ("one_score", "Close games", "pct", "one-score games"),
    ("blowouts", "Blowouts", "pct", "blowouts"),
    ("fav_win", "Vegas favorites", "pct", "favorite wins"),
    ("dog_10", "Double-digit underdogs", "pct", "outright upsets"),
    ("overs", "Over/under", "pct", "overs"),
]


def season_stats(g):
    """One season's games through the cutoff -> {key: {value, n, ...}}."""
    g = _prep(g)
    out = {}
    w, l, ups = ranked_vs_unranked(g)
    out["upset_rate"] = {"value": l / (w + l) if w + l else np.nan, "n": w + l, "record": f"{w}-{l}", "hits": l}
    w10, l10, ups10 = ranked_vs_unranked(g, 10)
    out["top10_loss"] = {"value": l10 / (w10 + l10) if w10 + l10 else np.nan, "n": w10 + l10,
                         "record": f"{w10}-{l10}", "hits": l10}
    rr = g[g.hr.notna() & g.ar.notna() & (g.margin != 0)]
    low_wins = int(((rr.hr > rr.ar) & (rr.margin > 0)).sum() + ((rr.ar > rr.hr) & (rr.margin < 0)).sum())
    out["rvr_upset"] = {"value": low_wins / len(rr) if len(rr) else np.nan, "n": len(rr),
                        "record": f"{len(rr) - low_wins}-{low_wins}", "hits": low_wins}
    hm = g[~g.neutral.astype(bool) & (g.margin != 0)]
    hw = int((hm.margin > 0).sum())
    out["home_win"] = {"value": hw / len(hm) if len(hm) else np.nan, "n": len(hm),
                       "record": f"{hw}-{len(hm) - hw}", "hits": hw}
    out["points"] = {"value": float((g.home_score + g.away_score).mean() / 2) if len(g) else np.nan, "n": len(g)}
    one = int((g.margin.abs() <= 8).sum())
    out["one_score"] = {"value": one / len(g) if len(g) else np.nan, "n": len(g), "hits": one}
    bl = int((g.margin.abs() >= 28).sum())
    out["blowouts"] = {"value": bl / len(g) if len(g) else np.nan, "n": len(g), "hits": bl}
    ln = g[pd.to_numeric(g["spread"], errors="coerce").notna()].copy()
    ln["spread"] = ln["spread"].astype(float)
    fav = ln[(ln.spread != 0) & (ln.margin != 0)]
    if len(fav) >= 30:
        fw = int((np.sign(fav.spread) == np.sign(fav.margin)).sum())
        out["fav_win"] = {"value": fw / len(fav), "n": len(fav), "record": f"{fw}-{len(fav) - fw}", "hits": fw}
        big = fav[fav.spread.abs() >= 10]
        dw = int((np.sign(big.spread) != np.sign(big.margin)).sum())
        out["dog_10"] = {"value": dw / len(big) if len(big) else np.nan, "n": len(big), "hits": dw,
                         "record": f"{dw}-{len(big) - dw}"}
    tot = g[pd.to_numeric(g["total"], errors="coerce").notna()].copy()
    tot = tot[(tot.home_score + tot.away_score) != tot["total"].astype(float)]
    if len(tot) >= 30:
        ov = int(((tot.home_score + tot.away_score) > tot["total"].astype(float)).sum())
        out["overs"] = {"value": ov / len(tot), "n": len(tot), "record": f"{ov}-{len(tot) - ov}", "hits": ov}
    return out, ups


def _ordinal(n):
    return {1: "", 2: "second ", 3: "third ", 4: "fourth ", 5: "fifth "}.get(n, f"{n}th ")


def describe(key, cur, hist, label, first):
    """Ranks this season against the rest and writes the headline sentence."""
    vals = {s: v["value"] for s, v in hist.items() if not np.isnan(v["value"])}
    if np.isnan(cur["value"]) or len(vals) < 5:
        return None
    seasons = sorted(vals)
    hi_rank = 1 + sum(v > cur["value"] for v in vals.values())
    lo_rank = 1 + sum(v < cur["value"] for v in vals.values())
    n = len(vals) + 1
    side, rank = ("highest", hi_rank) if hi_rank <= lo_rank else ("lowest", lo_rank)
    beat = sorted(((s, v) for s, v in vals.items() if (v > cur["value"] if side == "highest" else v < cur["value"])),
                  key=lambda x: -x[1] if side == "highest" else x[1])
    avg = float(np.mean(list(vals.values())))
    # extremeness 0..1: 1 = a record
    score = 1 - (rank - 1) / (n - 1)
    return {"rank": rank, "side": side, "seasons": n, "since": min(seasons), "avg": avg, "score": score,
            "beaten_by": [{"season": s, "value": v, "record": hist[s].get("record")} for s, v in beat[:3]],
            "label": label}


def _clean(o):
    """JSON-safe: numpy numbers to Python, NaN to null."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if np.isnan(o) else round(float(o), 4)
    return o


def run():
    if _headers() is None:
        print("CFBD_API_KEY not set - skipping CFB trends.")
        return
    season = current_cfb_season()
    games = load_games(season)
    games["date"] = pd.to_datetime(games["date"]).dt.date
    cur = games[games["season"] == season]
    if cur.empty:
        print("  No completed games yet this season.")
        return
    last = max(cur["date"])
    anchor = last - timedelta(days=(last.weekday() - 5) % 7)       # the Saturday of the latest weekend
    label = weekend_label(anchor)

    per_season, upsets = {}, None
    for y, g in games.groupby("season"):
        cut = cutoff_for(int(y), anchor)
        stats, ups = season_stats(g[g["date"] <= cut])
        per_season[int(y)] = stats
        if y == season:
            upsets = ups
    now_stats = per_season[season]
    past = {y: s for y, s in per_season.items() if y != season}

    out_stats = []
    for key, title, kind, noun in STATS:
        if key not in now_stats:
            continue
        hist = {y: s[key] for y, s in past.items() if key in s}
        d = describe(key, now_stats[key], hist, label, FIRST_SEASON)
        if not d:
            continue
        out_stats.append({"key": key, "title": title, "kind": kind, "noun": noun, **now_stats[key], **d,
                          "history": [{"season": y, "value": round(h["value"], 4), "record": h.get("record")}
                                      for y, h in sorted(hist.items()) if not np.isnan(h["value"])]})
    out_stats.sort(key=lambda s: -s["score"])

    def game_row(r):
        home_won = r.margin > 0
        w, l = ("home", "away") if home_won else ("away", "home")
        return {"winner": r[f"{w}_team"], "loser": r[f"{l}_team"],
                "winner_score": int(r[f"{w}_score"]), "loser_score": int(r[f"{l}_score"]),
                "loser_rank": None if pd.isna(r[f"{l[0]}r"]) else int(r[f"{l[0]}r"]),
                "date": r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"]),
                "site": "neutral site" if r["neutral"] else f"at {r['home_team']}"}

    ups = _prep(upsets).sort_values("date") if upsets is not None and len(upsets) else pd.DataFrame()
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "season": season,
           "through": anchor.isoformat(), "label": label, "first_season": FIRST_SEASON,
           "stats": out_stats, "upsets": [game_row(r) for _, r in ups.iterrows()]}
    with open(OUT_PATH, "w") as f:
        json.dump(_clean(out), f, indent=1)
    print(f"  Trends through the {label}: " + "; ".join(
        f"{s['title']} {s.get('record') or round(s['value'], 3)} ({_ordinal(s['rank'])}{s['side']} of {s['seasons']})"
        for s in out_stats))


if __name__ == "__main__":
    run()
