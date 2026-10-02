"""
cfb_ratings.py
Our own college football power ratings for every FBS team, and a running
check of how well they'd have picked each week's FBS games. The CFB picks
don't use them yet: they're tracked on their own first (Ratings tab) and can
join the model once they've proven themselves.

THE RATINGS, rebuilt each run from this season's and last season's games:
  points a team scores = league average + its offense rating + the
                         opponent's defense rating + home field
fit by a weighted ridge regression over every game an FBS team played, so
each number is adjusted for who the team actually faced. FCS opponents all
share one "FCS" rating. Recent games count more (weight halves every
HALF_LIFE_WEEKS weeks) and last season's games count CARRYOVER as much, so
week 1 starts from last year's team and fades as this year's games come in.

  Offense = points the team would score against an average FBS defense
  Defense = points it would allow to an average FBS offense (lower is better)
  Overall = Offense - Defense, its expected margin against an average FBS
            team on a neutral field

MONITORING: before each game, the rating line (overall gap + home field) is
written to data/tracking/cfb_ratings_log.csv and frozen at kickoff; once the
game is final it's graded. build_site.py shows the record next to our model
and Vegas on the same games.

Usage:
  python src/cfb_ratings.py             # refresh ratings + log + grade
  python src/cfb_ratings.py --backtest  # score settings on past seasons
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from fetch_cfb_data import _get, _headers, current_cfb_season

TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
RATINGS_PATH = os.path.join(TRACKING_DIR, "cfb_ratings.json")
LOG_PATH = os.path.join(TRACKING_DIR, "cfb_ratings_log.csv")

HALF_LIFE_WEEKS = 6
CARRYOVER = 0.5
RIDGE = 3.0
MARGIN_CAP = None            # blowouts beyond this margin count as this margin (None = no cap)
FCS = "FCS"
LOG_DAYS_AHEAD = 8


def fbs_teams(season):
    rows = []
    for t in _get("/teams/fbs", {"year": season}):
        logos = t.get("logos") or []
        rows.append({"team": t.get("school"), "conference": t.get("conference") or "",
                     "abbreviation": t.get("abbreviation") or t.get("school"),
                     "logo": logos[0] if logos else "", "color": t.get("color") or "#94a3b8"})
    return pd.DataFrame(rows)


def season_games(season):
    frames = []
    for season_type in ("regular", "postseason"):
        try:
            frames.append(pd.DataFrame(_get("/games", {"year": season, "seasonType": season_type})))
        except Exception as e:  # noqa: BLE001 - a missing postseason shouldn't stop the ratings
            print(f"  Skipping {season_type} {season}: {e}")
    games = pd.concat([f for f in frames if not f.empty], ignore_index=True) if frames else pd.DataFrame()
    if games.empty:
        return games
    games = games.rename(columns={"homeTeam": "home_team", "awayTeam": "away_team", "homePoints": "home_score",
                                  "awayPoints": "away_score", "neutralSite": "neutral", "startDate": "start",
                                  "seasonType": "season_type"})
    games["season"] = season
    keep = ["id", "season", "week", "season_type", "start", "neutral", "home_team", "away_team", "home_score", "away_score"]
    return games[[c for c in keep if c in games.columns]]


def _order(games):
    """A running week index across seasons (postseason after week 15)."""
    wk = games["week"].astype(float) + np.where(games["season_type"] == "postseason", 20, 0)
    return games["season"].astype(float) * 40 + wk


def fit_ratings(done, fbs, t_now, season_now, half_life=HALF_LIFE_WEEKS, carryover=CARRYOVER, ridge=RIDGE,
                cap=MARGIN_CAP):
    """Offense/defense/overall for every FBS team from completed games `done`
    (each game's weight from its distance to t_now)."""
    teams = sorted(fbs) + [FCS]
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    g = done.copy()
    for side in ("home", "away"):
        g[side] = g[f"{side}_team"].where(g[f"{side}_team"].isin(fbs), FCS)
    g = g[(g["home"] != FCS) | (g["away"] != FCS)]
    t = _order(g).values
    w = 0.5 ** ((t_now - t) / half_life) * carryover ** (season_now - g["season"].values)
    h = np.where(g["neutral"].fillna(False).astype(bool).values, 0.0, 1.0)

    m = len(g)
    X = np.zeros((2 * m, 2 * n + 2))
    rows = np.arange(m)
    hi, ai = g["home"].map(idx).values, g["away"].map(idx).values
    X[rows, hi] = 1
    X[rows, n + ai] = 1
    X[rows, 2 * n] = h / 2
    X[m + rows, ai] = 1
    X[m + rows, n + hi] = 1
    X[m + rows, 2 * n] = -h / 2
    X[:, 2 * n + 1] = 1
    hs, aws = g["home_score"].values.astype(float), g["away_score"].values.astype(float)
    if cap:
        total, margin = hs + aws, np.clip(hs - aws, -cap, cap)
        hs, aws = (total + margin) / 2, (total - margin) / 2
    y = np.concatenate([hs, aws])
    ww = np.concatenate([w, w])

    A = X.T @ (X * ww[:, None])
    R = np.eye(2 * n + 2) * ridge
    R[2 * n, 2 * n] = R[2 * n + 1, 2 * n + 1] = 0
    beta = np.linalg.solve(A + R, X.T @ (ww * y))
    off, dfn, hfa, mu = beta[:n], beta[n:2 * n], beta[2 * n], beta[2 * n + 1]

    # Center on the average FBS team so "average" means average FBS, not the
    # average of everyone in the regression (FCS included).
    f = np.array([idx[x] for x in sorted(fbs)])
    off_c, def_c = off - off[f].mean(), dfn - dfn[f].mean()
    base = mu + off[f].mean() + dfn[f].mean()
    out = pd.DataFrame({"team": teams, "offense": base + off_c, "defense": base + def_c})
    out["overall"] = out["offense"] - out["defense"]
    return out[out["team"] != FCS].reset_index(drop=True), float(hfa)


def rating_line(ratings, hfa, home, away, neutral):
    r = ratings.set_index("team")
    if home not in r.index or away not in r.index:
        return np.nan
    return float(r.at[home, "overall"] - r.at[away, "overall"] + (0 if neutral else hfa))


def records(done, fbs):
    rec = {}
    for g in done.itertuples():
        if pd.isna(g.home_score) or pd.isna(g.away_score) or g.home_score == g.away_score:
            continue
        winner, loser = (g.home_team, g.away_team) if g.home_score > g.away_score else (g.away_team, g.home_team)
        rec.setdefault(winner, [0, 0])[0] += 1
        rec.setdefault(loser, [0, 0])[1] += 1
    return {t: f"{w}-{l}" for t, (w, l) in rec.items() if t in fbs}


def update_log(upcoming, done, ratings, hfa, now):
    """Adds/refreshes the rating line for FBS-vs-FBS games kicking off in the
    next LOG_DAYS_AHEAD days (frozen once they kick off), then grades finals."""
    cols = ["id", "season", "week", "start", "home_team", "away_team", "neutral", "rating_line",
            "home_score", "away_score", "logged_at"]
    log = pd.read_csv(LOG_PATH) if os.path.exists(LOG_PATH) else pd.DataFrame(columns=cols)
    start = pd.to_datetime(upcoming["start"], utc=True, errors="coerce")
    soon = upcoming[(start > now) & (start <= now + timedelta(days=LOG_DAYS_AHEAD))]
    stamp = now.isoformat(timespec="seconds")
    rows = []
    for g in soon.itertuples():
        line = rating_line(ratings, hfa, g.home_team, g.away_team, bool(g.neutral))
        if np.isnan(line):
            continue
        rows.append({"id": g.id, "season": g.season, "week": g.week, "start": g.start, "home_team": g.home_team,
                     "away_team": g.away_team, "neutral": bool(g.neutral), "rating_line": round(line, 2),
                     "home_score": np.nan, "away_score": np.nan, "logged_at": stamp})
    fresh = pd.DataFrame(rows, columns=cols)
    log = pd.concat([log[~log["id"].isin(fresh["id"])], fresh], ignore_index=True)

    finals = done.set_index("id")
    for i, r in log.iterrows():
        if pd.isna(r["home_score"]) and r["id"] in finals.index:
            log.at[i, "home_score"] = finals.at[r["id"], "home_score"]
            log.at[i, "away_score"] = finals.at[r["id"], "away_score"]
    log = log.sort_values(["start", "id"]).reset_index(drop=True)
    log.to_csv(LOG_PATH, index=False)
    graded = log.dropna(subset=["home_score"])
    print(f"  Ratings log: {len(log)} games, {len(graded)} graded, {len(fresh)} logged or refreshed this run")


def run():
    if _headers() is None:
        print("CFBD_API_KEY not set - skipping CFB ratings.")
        return
    season = current_cfb_season()
    teams = fbs_teams(season)
    fbs = set(teams["team"])
    games = pd.concat([season_games(season - 1), season_games(season)], ignore_index=True)
    done = games.dropna(subset=["home_score", "away_score"])
    upcoming = games[games["season"] == season].copy()
    now = datetime.now(timezone.utc)

    cur = done[done["season"] == season]
    t_now = (_order(cur).max() + 1) if not cur.empty else season * 40
    ratings, hfa = fit_ratings(done, fbs, t_now, season)
    ratings = ratings.merge(teams, on="team", how="left")
    for col in ("overall", "offense"):
        ratings[f"{col}_rank"] = ratings[col].rank(ascending=False, method="min").astype(int)
    ratings["defense_rank"] = ratings["defense"].rank(ascending=True, method="min").astype(int)
    ratings["record"] = ratings["team"].map(records(cur, fbs)).fillna("0-0")
    ratings = ratings.sort_values("overall", ascending=False)

    os.makedirs(TRACKING_DIR, exist_ok=True)
    out = {"updated": now.isoformat(timespec="seconds"), "season": season,
           "games_through_week": int(cur["week"].max()) if not cur.empty else 0,
           "home_field": round(hfa, 2), "half_life_weeks": HALF_LIFE_WEEKS, "carryover": CARRYOVER,
           "teams": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
                     for r in ratings[["team", "conference", "abbreviation", "logo", "record", "overall", "offense",
                                       "defense", "overall_rank", "offense_rank", "defense_rank"]].to_dict("records")]}
    with open(RATINGS_PATH, "w") as f:
        json.dump(out, f, indent=1)
    top = ", ".join(f"{r.team} {r.overall:+.1f}" for r in ratings.head(5).itertuples())
    print(f"  Rated {len(ratings)} FBS teams (home field {hfa:.1f}). Top 5: {top}")
    update_log(upcoming, done, ratings, hfa, now)


def backtest(seasons_back=4):
    """Walk-forward: before each week of the last few seasons, fit on the
    games before it and predict that week. Prints straight-up accuracy and
    average miss for each setting, and Vegas on the games CFBD has a line for."""
    if _headers() is None:
        print("CFBD_API_KEY not set.")
        return
    season = current_cfb_season()
    years = list(range(season - seasons_back, season + 1))
    games = pd.concat([season_games(y) for y in years], ignore_index=True)
    fbs_by_year = {y: set(fbs_teams(y)["team"]) for y in years}
    lines = []
    for y in years:
        for st in ("regular", "postseason"):
            for g in _get("/lines", {"year": y, "seasonType": st}):
                ls = g.get("lines") or []
                pick = next((x for x in ls if x.get("provider") == "consensus"), ls[0] if ls else None)
                if pick and pick.get("spread") is not None:
                    lines.append({"id": g.get("id"), "vegas": -float(pick["spread"])})
    lines = pd.DataFrame(lines).drop_duplicates("id")
    done = games.dropna(subset=["home_score", "away_score"]).copy()
    done["t"] = _order(done)
    test = done[done["season"] > years[0]]

    for hl, carry, ridge, cap in [(h, c, r, k) for h in (10, 16, 30) for c in (0.5, 0.7)
                                  for r in (0.3, 1.0) for k in (None, 28)]:
            if True:
                rows = []
                for (s, t), wk in test.groupby(["season", "t"]):
                    fbs = fbs_by_year[s]
                    hist = done[(done["t"] < t) & (done["season"] >= s - 1)]
                    if len(hist) < 200:
                        continue
                    r, hfa = fit_ratings(hist, fbs, t, s, hl, carry, ridge, cap)
                    for g in wk.itertuples():
                        if g.home_team in fbs and g.away_team in fbs:
                            rows.append((g.id, rating_line(r, hfa, g.home_team, g.away_team, bool(g.neutral)),
                                         g.home_score - g.away_score))
                p = pd.DataFrame(rows, columns=["id", "line", "margin"]).dropna()
                p = p[p["margin"] != 0]
                acc = (np.sign(p["line"]) == np.sign(p["margin"])).mean()
                mae = (p["line"] - p["margin"]).abs().mean()
                v = p.merge(lines, on="id")
                print(f"half-life {hl:>2} carry {carry} ridge {ridge:>4} cap {cap}: {len(p)} FBS games, picks {acc:.1%}, "
                      f"miss {mae:.2f} | lined {len(v)}: ours {(np.sign(v['line']) == np.sign(v['margin'])).mean():.1%} "
                      f"miss {(v['line'] - v['margin']).abs().mean():.2f}, Vegas "
                      f"{(np.sign(v['vegas']) == np.sign(v['margin'])).mean():.1%} miss {(v['vegas'] - v['margin']).abs().mean():.2f}",
                      flush=True)


if __name__ == "__main__":
    backtest() if "--backtest" in sys.argv else run()
