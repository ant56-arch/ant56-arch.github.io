"""
cfb_ratings.py
Our own college football power ratings for every FBS team, and a running
check of how well they'd have picked each week's FBS games. The CFB picks
don't use them yet: they're tracked on their own first (Ratings tab) and can
join the model once they've proven themselves.

THE RATINGS, rebuilt each run, blend two opponent-adjusted ratings:
  1. Points: points a team scores = league average + its offense rating +
     the opponent's defense rating + home field, fit by a weighted ridge
     regression over this season's games. Instead of last season's games,
     each team starts from a PRESEASON RATING: last season's final rating,
     kept more for teams returning more of their production, plus roster
     talent. That start counts as PRIOR_WEIGHT games, so it fades as this
     season's games come in.
  2. Efficiency: the same regression on EPA per play with garbage time
     removed (CFBD advanced stats), over this season and last season's
     games (last season at EFF_CARRY).
Overall = POINTS_BLEND x points rating + EFF_BLEND x efficiency rating, on the
points scale. FCS opponents all share one "FCS" rating. Recent games count
more (weight halves every HALF_LIFE_WEEKS weeks).

  Offense = points the team would score against an average FBS defense
  Defense = points it would allow to an average FBS offense (lower is better)
  Overall = Offense - Defense, its expected margin against an average FBS
            team on a neutral field

MONITORING: before each game, the rating line (overall gap + home field) is
written to data/tracking/cfb_ratings_log.csv and frozen at kickoff; once the
game is final it's graded. build_site.py shows the record next to our model
and Vegas on the same games.

Usage:
  python src/cfb_ratings.py          # refresh ratings + log + grade
  python src/cfb_ratings_lab.py      # walk-forward test of settings on past seasons
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from fetch_cfb_data import _get, _headers, current_cfb_season
import espn_cfb

TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
RATINGS_PATH = os.path.join(TRACKING_DIR, "cfb_ratings.json")
LOG_PATH = os.path.join(TRACKING_DIR, "cfb_ratings_log.csv")

# Picked by the cfb_ratings_lab.py walk-forward on 2022-2026 (3,443 FBS games
# with a Vegas line): 72.1% of winners picked, 12.61-point average miss, vs
# 71.6% / 12.72 for the old points-only ratings that carried last season's
# games (Vegas: 73.2% / 11.97). Fading last season faster, or a heavier
# preseason rating, both did worse.
HALF_LIFE_WEEKS = 30
RIDGE = 0.5
PRIOR_WEIGHT = 3             # the preseason rating counts as this many games
EFF_CARRY = 0.3              # last season's games in the efficiency rating
POINTS_BLEND, EFF_BLEND = 0.87, 9.2
# Preseason rating (deviation from an average FBS team), fit in the lab on
# 2022-2025: a x last season + b x last season x (returning production -
# that year's average) + c x roster talent (z-score).
PRIOR_OFFENSE = (0.401, 0.242, 2.569)
PRIOR_DEFENSE = (0.536, 0.264, -1.646)
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


def fit_side(done, fbs, t_now, season_now, home_col, away_col, carry, prior=None, prior_w=0.0,
             half_life=HALF_LIFE_WEEKS, ridge=RIDGE, home_field=None):
    """Offense/defense ridge for one per-side stat (points, EPA/play) over the
    completed games `done`. Returns per-team offense/defense deviations from
    an average FBS team, home field, and the average FBS team's level.
    prior: team -> (offense dev, defense dev) to shrink toward instead of 0.
    carry 0 still keeps last season at a token weight so home field and the
    league average are defined before week 1.
    home_field: hold home field at this value instead of fitting it."""
    teams = sorted(fbs) + [FCS]
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    g = done.dropna(subset=[home_col, away_col]).copy()
    for side in ("home", "away"):
        g[side] = g[f"{side}_team"].where(g[f"{side}_team"].isin(fbs), FCS)
    g = g[(g["home"] != FCS) | (g["away"] != FCS)]
    past = season_now - g["season"].values
    w = 0.5 ** ((t_now - _order(g).values) / half_life) * np.where(past == 0, 1.0, max(carry, 1e-3) ** past)
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
    y = np.concatenate([g[home_col].values, g[away_col].values]).astype(float)
    ww = np.concatenate([w, w])

    lam = np.full(2 * n + 2, float(ridge))
    lam[2 * n:] = 0
    if home_field is not None:
        y = y - X[:, 2 * n] * home_field
        X[:, 2 * n] = 0
        lam[2 * n] = 1.0
    target = np.zeros(2 * n + 2)
    if prior:
        lam[:2 * n] += prior_w
        for t, (po, pdf) in prior.items():
            if t in idx:
                target[idx[t]], target[n + idx[t]] = po, pdf
    beta = np.linalg.solve(X.T @ (X * ww[:, None]) + np.diag(lam), X.T @ (ww * y) + lam * target)
    off, dfn, hfa, mu = beta[:n], beta[n:2 * n], beta[2 * n], beta[2 * n + 1]
    hfa = hfa if home_field is None else home_field
    f = np.array([idx[x] for x in sorted(fbs)])
    out = pd.DataFrame({"team": teams, "off": off - off[f].mean(), "def": dfn - dfn[f].mean()}).set_index("team")
    return out, float(hfa), float(mu + off[f].mean() + dfn[f].mean())


def preseason_prior(games, fbs_last, season, returning, talent):
    """team -> (offense dev, defense dev) to start `season` from: last
    season's final points rating scaled by returning production, plus
    roster talent. Teams new to FBS start halfway to last season's FCS level."""
    last_games = games[games["season"] == season - 1].dropna(subset=["home_score", "away_score"])
    if last_games.empty:
        return None
    last, _, _ = fit_side(last_games, fbs_last, _order(last_games).max() + 1, season - 1,
                          "home_score", "away_score", carry=0.0, half_life=1e9)
    ret = pd.Series(returning, dtype=float)
    ret_c = ret - ret.mean() if len(ret) else ret
    tal = pd.Series(talent, dtype=float)
    tal_z = (tal - tal.mean()) / tal.std() if len(tal) > 1 else tal * 0
    prior = {}
    for t in games.loc[games["season"] == season, ["home_team", "away_team"]].stack().unique():
        lo, ld = (last.at[t, "off"], last.at[t, "def"]) if t in last.index else \
                 (last.at[FCS, "off"] / 2, last.at[FCS, "def"] / 2)
        r, z = float(ret_c.get(t, 0.0)), float(tal_z.get(t, 0.0))
        prior[t] = (PRIOR_OFFENSE[0] * lo + PRIOR_OFFENSE[1] * lo * r + PRIOR_OFFENSE[2] * z,
                    PRIOR_DEFENSE[0] * ld + PRIOR_DEFENSE[1] * ld * r + PRIOR_DEFENSE[2] * z)
    prior[FCS] = (last.at[FCS, "off"], last.at[FCS, "def"])
    return prior


def fit_ratings(done, fbs, t_now, season_now, prior):
    """Offense/defense/overall for every FBS team (points scale) and home field.
    `done` needs home_score/away_score and, for the efficiency half,
    home_ppa/away_ppa; without efficiency data it falls back to points only."""
    recent = done[done["season"] >= season_now - 1]
    pts, hfa_p, base = fit_side(recent, fbs, t_now, season_now, "home_score", "away_score", carry=0.0,
                                prior=prior, prior_w=PRIOR_WEIGHT if prior else 0.0)
    off, dfn, hfa = pts["off"], pts["def"], hfa_p
    if "home_ppa" in done and done.loc[done["season"] == season_now, "home_ppa"].notna().any():
        eff, hfa_e, _ = fit_side(done, fbs, t_now, season_now, "home_ppa", "away_ppa", carry=EFF_CARRY)
        off = POINTS_BLEND * off + EFF_BLEND * eff["off"]
        dfn = POINTS_BLEND * dfn + EFF_BLEND * eff["def"]
        hfa = POINTS_BLEND * hfa_p + EFF_BLEND * hfa_e
    out = pd.DataFrame({"team": off.index, "offense": base + off.values, "defense": base + dfn.values})
    out["overall"] = out["offense"] - out["defense"]
    return out[out["team"] != FCS].reset_index(drop=True), float(hfa)


def season_efficiency(season):
    """(game id, team) -> offensive EPA per play with garbage time removed."""
    out = {}
    for season_type in ("regular", "postseason"):
        try:
            for r in _get("/stats/game/advanced", {"year": season, "seasonType": season_type,
                                                    "excludeGarbageTime": "true"}):
                ppa = (r.get("offense") or {}).get("ppa")
                if ppa is not None:
                    out[(r.get("gameId"), r.get("team"))] = float(ppa)
        except Exception as e:  # noqa: BLE001 - ratings fall back to points only
            print(f"  Skipping {season_type} {season} efficiency: {e}")
    return out


def team_values(path, season, key, value_keys):
    try:
        rows = _get(path, {"year": season})
    except Exception as e:  # noqa: BLE001 - the preseason rating just skips this input
        print(f"  Skipping {path} {season}: {e}")
        return {}
    out = {}
    for r in rows:
        team = r.get(key) or r.get("school")
        val = next((r[k] for k in value_keys if r.get(k) is not None), None)
        if team and val is not None:
            out[team] = float(val)
    return out


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


def _game_key(games):
    return (games["season"].astype(int).astype(str) + "|" + games["week"].astype(int).astype(str) + "|"
            + games["home_team"].astype(str) + "|" + games["away_team"].astype(str))


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
    # Games match on season, week and teams rather than id, since CFBD's and
    # ESPN's (espn_cfb.py) ids differ for the same game.
    log = pd.concat([log[~_game_key(log).isin(_game_key(fresh))], fresh], ignore_index=True)

    finals = done.assign(key=_game_key(done)).drop_duplicates("key").set_index("key")
    for i, key in _game_key(log).items():
        if pd.isna(log.at[i, "home_score"]) and key in finals.index:
            log.at[i, "home_score"] = finals.at[key, "home_score"]
            log.at[i, "away_score"] = finals.at[key, "away_score"]
    log = log.sort_values(["start", "id"]).reset_index(drop=True)
    log.to_csv(LOG_PATH, index=False)
    graded = log.dropna(subset=["home_score"])
    print(f"  Ratings log: {len(log)} games, {len(graded)} graded, {len(fresh)} logged or refreshed this run")


def run():
    if _headers() is None:
        print("CFBD_API_KEY not set - skipping CFB ratings.")
        return
    season = current_cfb_season()
    try:
        teams = fbs_teams(season)
    except Exception as e:  # noqa: BLE001 - CFBD out (quota, outage): ESPN keeps the ratings moving
        print(f"  CFBD unavailable ({e}) - updating the ratings from ESPN scores instead.")
        run_espn(season)
        return
    fbs = set(teams["team"])
    fbs_last = set(fbs_teams(season - 1)["team"])
    games = pd.concat([season_games(season - 1), season_games(season)], ignore_index=True)
    done = games.dropna(subset=["home_score", "away_score"]).copy()
    eff = {**season_efficiency(season - 1), **season_efficiency(season)}
    done["home_ppa"] = [eff.get((i, t), np.nan) for i, t in zip(done["id"], done["home_team"])]
    done["away_ppa"] = [eff.get((i, t), np.nan) for i, t in zip(done["id"], done["away_team"])]
    upcoming = games[games["season"] == season].copy()
    now = datetime.now(timezone.utc)

    returning = {t: v for t, v in team_values("/player/returning", season, "team",
                                              ("percentPPA", "percent_ppa")).items() if t in fbs}
    talent = {t: v for t, v in team_values("/talent", season, "team", ("talent",)).items() if t in fbs}
    prior = preseason_prior(games, fbs_last, season, returning, talent)
    print(f"  Efficiency on {done['home_ppa'].notna().mean():.0%} of games; returning production for "
          f"{len(returning)} teams, talent for {len(talent)}")

    cur = done[done["season"] == season]
    t_now = (_order(cur).max() + 1) if not cur.empty else season * 40
    ratings, hfa = fit_ratings(done, fbs, t_now, season, prior)
    ratings = ratings.merge(teams, on="team", how="left")
    for col in ("overall", "offense"):
        ratings[f"{col}_rank"] = ratings[col].rank(ascending=False, method="min").astype(int)
    ratings["defense_rank"] = ratings["defense"].rank(ascending=True, method="min").astype(int)
    ratings["record"] = ratings["team"].map(records(cur, fbs)).fillna("0-0")
    ratings = ratings.sort_values("overall", ascending=False)

    os.makedirs(TRACKING_DIR, exist_ok=True)
    out = {"updated": now.isoformat(timespec="seconds"), "season": season,
           "games_through_week": int(cur["week"].max()) if not cur.empty else 0,
           "home_field": round(hfa, 2), "half_life_weeks": HALF_LIFE_WEEKS, "preseason_weight": PRIOR_WEIGHT,
           "teams": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
                     for r in ratings[["team", "conference", "abbreviation", "logo", "record", "overall", "offense",
                                       "defense", "overall_rank", "offense_rank", "defense_rank"]].to_dict("records")]}
    with open(RATINGS_PATH, "w") as f:
        json.dump(out, f, indent=1)
    top = ", ".join(f"{r.team} {r.overall:+.1f}" for r in ratings.head(5).itertuples())
    print(f"  Rated {len(ratings)} FBS teams (home field {hfa:.1f}). Top 5: {top}")
    update_log(upcoming, done, ratings, hfa, now)
    if os.path.exists(espn_cfb.SNAPSHOT_PATH):
        os.remove(espn_cfb.SNAPSHOT_PATH)


def run_espn(season):
    """While CFBD is out (see espn_cfb.py): start from the last CFBD-built
    ratings (kept in cfb_ratings_cfbd.json so updates never compound) and
    move them with ESPN scores of the FBS-vs-FBS games played since. That
    start counts as PRIOR_WEIGHT games plus the weeks it had already seen,
    and home field stays where CFBD's ratings had it. No efficiency half:
    ESPN has no EPA."""
    if not os.path.exists(espn_cfb.SNAPSHOT_PATH):
        if not os.path.exists(RATINGS_PATH):
            print("  No ratings to start from - skipping.")
            return
        with open(RATINGS_PATH) as f:
            last = json.load(f)
        if last.get("source") == "espn":
            print("  No CFBD-built ratings to start from - skipping.")
            return
        with open(espn_cfb.SNAPSHOT_PATH, "w") as f:
            json.dump(last, f, indent=1)
    with open(espn_cfb.SNAPSHOT_PATH) as f:
        base = json.load(f)
    if base.get("season") != season:
        print("  The last CFBD ratings are from another season - skipping.")
        return

    start = pd.DataFrame(base["teams"])
    fbs = set(start["team"])
    games, _ = espn_cfb.season(season)
    if games.empty:
        print("  No ESPN games - keeping the ratings as they are.")
        return
    done = games.dropna(subset=["home_score", "away_score"]).copy()
    seen = int(base.get("games_through_week") or 0)
    new = done[(done["week"] > seen) & done["home_team"].isin(fbs) & done["away_team"].isin(fbs)]
    hfa = float(base["home_field"])
    avg = float(start["offense"].mean())

    ratings = start[["team", "offense", "defense"]].copy()
    if not new.empty:
        prior = {r.team: (r.offense - avg, r.defense - avg) for r in start.itertuples()}
        fit, _, level = fit_side(new, fbs, _order(new).max() + 1, season, "home_score", "away_score", carry=0.0,
                                 prior=prior, prior_w=PRIOR_WEIGHT + seen, home_field=hfa)
        fit = fit.drop(index=FCS)
        ratings = pd.DataFrame({"team": fit.index, "offense": level + fit["off"].values,
                                "defense": level + fit["def"].values})
    ratings["overall"] = ratings["offense"] - ratings["defense"]
    ratings = ratings.merge(start[["team", "conference", "abbreviation", "logo"]], on="team", how="left")
    for col in ("overall", "offense"):
        ratings[f"{col}_rank"] = ratings[col].rank(ascending=False, method="min").astype(int)
    ratings["defense_rank"] = ratings["defense"].rank(ascending=True, method="min").astype(int)
    ratings["record"] = ratings["team"].map(records(done, fbs)).fillna("0-0")
    ratings = ratings.sort_values("overall", ascending=False)

    now = datetime.now(timezone.utc)
    out = {"updated": now.isoformat(timespec="seconds"), "season": season, "source": "espn",
           "games_through_week": int(done["week"].max()) if not done.empty else seen,
           "home_field": round(hfa, 2), "half_life_weeks": HALF_LIFE_WEEKS, "preseason_weight": PRIOR_WEIGHT,
           "teams": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
                     for r in ratings[["team", "conference", "abbreviation", "logo", "record", "overall", "offense",
                                       "defense", "overall_rank", "offense_rank", "defense_rank"]].to_dict("records")]}
    with open(RATINGS_PATH, "w") as f:
        json.dump(out, f, indent=1)
    top = ", ".join(f"{r.team} {r.overall:+.1f}" for r in ratings.head(5).itertuples())
    print(f"  Rated {len(ratings)} FBS teams from ESPN ({len(new)} games since week {seen}). Top 5: {top}")
    update_log(games, done, ratings, hfa, now)


if __name__ == "__main__":
    run()
