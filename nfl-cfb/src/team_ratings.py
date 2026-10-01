"""
team_ratings.py
Opponent-adjusted team ratings and starting-QB ratings: the inputs to the NFL
game model's spread (fit_model.py fits the weights, game_predictions.py uses
them for upcoming games).

WHY: the older inputs were each team's raw recency-weighted EPA and rate
stats. Raw numbers don't know who a team played (a 3-0 start against three
bad defenses looks like a great offense), carry a team's numbers from one
season into the next at full strength, and have no idea who's playing
quarterback. A 2016-2025 walk-forward backtest (every game predicted only
from games before it) put the average spread miss at 10.27 points for the
old inputs and 10.02 for these, with straight-up picks 63.9% -> 64.5%.

THE RATINGS, rebuilt before every week from the games before it:
  - points rating: a ridge regression of every game's final margin on
    "home team rating - away team rating + home field". It's the classic
    power rating, adjusted for schedule.
  - success-rate rating: the same idea on play-by-play success rate, with a
    separate offense and defense rating per team (offense's success rate in a
    game = league average + its offense rating + the opponent's defense
    rating), so a team's offense is credited for whom it faced.
  - QB rating: the game's starting QB's EPA per dropback in his own past
    starts, shrunk toward a replacement-level QB when he has few dropbacks.
    nflverse's schedule lists the expected starter for upcoming games, so a
    backup starting shows up before kickoff.
Older games count less: weight halves every RATING_HALF_LIFE_WEEKS weeks,
and every season boundary multiplies the weight by SEASON_CARRYOVER, so last
year's team fades but still anchors the first few weeks.
"""

import numpy as np
import pandas as pd

RATING_HALF_LIFE_WEEKS = 8
SEASON_CARRYOVER = 0.6
HISTORY_WEEKS = 60           # about three seasons; older games weigh ~nothing
RIDGE_SUCCESS = 1.0
RIDGE_POINTS = 20.0
QB_HALF_LIFE_WEEKS = 16
QB_PRIOR_DROPBACKS = 150     # a new QB is treated as replacement level until he has a few starts
QB_PRIOR_EPA = -0.05

FEATURES = ["points_rating_diff", "success_rating_diff", "qb_diff", "home_field"]


def team_game_table(pbp):
    """One row per team per game: success rate on offense, the main passer
    and the team's EPA per pass play."""
    p = pbp[pbp["play_type"].isin(["pass", "run"]) & pbp["posteam"].notna() & pbp["epa"].notna()]
    base = (p.groupby(["game_id", "posteam", "defteam"])
            .agg(success=("success", "mean"), plays=("epa", "size")).reset_index())
    passes = p[p["pass"] == 1]
    pass_epa = passes.groupby(["game_id", "posteam"]).agg(pass_epa=("epa", "mean"), dropbacks=("epa", "size")).reset_index()
    qb = (p[p["qb_dropback"] == 1].groupby(["game_id", "posteam", "passer_player_id"]).size()
          .reset_index(name="n").sort_values("n").drop_duplicates(["game_id", "posteam"], keep="last")
          [["game_id", "posteam", "passer_player_id"]].rename(columns={"passer_player_id": "qb"}))
    out = base.merge(pass_epa, on=["game_id", "posteam"], how="left").merge(qb, on=["game_id", "posteam"], how="left")
    return out.rename(columns={"posteam": "team", "defteam": "opp"})


def _week_index(schedules):
    keys = schedules[["season", "week"]].drop_duplicates().sort_values(["season", "week"]).reset_index(drop=True)
    keys["t"] = np.arange(len(keys))
    return keys


def _weights(t_hist, season_hist, t, season, half_life):
    return 0.5 ** ((t - t_hist) / half_life) * SEASON_CARRYOVER ** (season - season_hist)


def _solve(X, y, w, ridge, free):
    A = X.T @ (X * w[:, None])
    b = X.T @ (w * y)
    R = np.eye(X.shape[1]) * ridge
    for i in free:
        R[i, i] = 0.0
    return np.linalg.solve(A + R, b)


def _points_ratings(hist, idx, n, w):
    X = np.zeros((len(hist), n + 1))
    rows = np.arange(len(hist))
    X[rows, hist["home_team"].map(idx).values] = 1
    X[rows, hist["away_team"].map(idx).values] -= 1
    X[:, n] = (hist["location"] != "Neutral").astype(float).values
    beta = _solve(X, hist["result"].values.astype(float), w, RIDGE_POINTS, [n])
    return beta[:n]


def _success_ratings(hist, idx, n, w):
    X = np.zeros((len(hist), 2 * n + 2))
    rows = np.arange(len(hist))
    X[rows, hist["team"].map(idx).values] = 1
    X[rows, n + hist["opp"].map(idx).values] = 1
    X[:, 2 * n] = hist["is_home"].values
    X[:, 2 * n + 1] = 1
    beta = _solve(X, hist["success"].values.astype(float), w, RIDGE_SUCCESS, [2 * n, 2 * n + 1])
    return beta[:n], beta[n:2 * n]


class _QBRatings:
    def __init__(self, tg):
        q = tg.dropna(subset=["qb", "pass_epa", "dropbacks"]).sort_values("t")
        self.by_qb = {k: (g["t"].values, g["pass_epa"].values, g["dropbacks"].values) for k, g in q.groupby("qb")}
        # each team's most recent starter, for games with no listed starter
        self.by_team = {k: (g["t"].values, g["qb"].values) for k, g in tg.dropna(subset=["qb"]).sort_values("t").groupby("team")}
        self.r = 0.5 ** (1 / QB_HALF_LIFE_WEEKS)

    def last_starter(self, team, t):
        ts, qbs = self.by_team.get(team, (np.array([]), np.array([])))
        prior = ts < t
        return qbs[prior][-1] if prior.any() else None

    def value(self, qb, team, t):
        if not isinstance(qb, str) or not qb:
            qb = self.last_starter(team, t)
        ts, epa, n = self.by_qb.get(qb, (np.array([]), np.array([]), np.array([])))
        prior = ts < t
        w = self.r ** (t - ts[prior]) * n[prior]
        return float((np.sum(w * epa[prior]) + QB_PRIOR_DROPBACKS * QB_PRIOR_EPA) / (np.sum(w) + QB_PRIOR_DROPBACKS))


def game_features(pbp, schedules, from_season=None, half_life=RATING_HALF_LIFE_WEEKS):
    """Pre-game features for every scheduled game (completed and upcoming) in
    from_season onward, each built only from games played before its week.
    Returns one row per game: season, week, home_team, away_team + FEATURES."""
    sched = schedules.copy()
    weeks = _week_index(sched)
    sched = sched.merge(weeks, on=["season", "week"])
    done = sched[sched["result"].notna()]

    tg = team_game_table(pbp).merge(sched[["game_id", "season", "t", "home_team"]], on="game_id")
    tg["is_home"] = (tg["team"] == tg["home_team"]).astype(float)
    teams = sorted(set(sched["home_team"]) | set(sched["away_team"]))
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    qbs = _QBRatings(tg)

    target = sched if from_season is None else sched[sched["season"] >= from_season]
    rows = []
    for (season, week, t), week_games in target.groupby(["season", "week", "t"]):
        hist_g = done[(done["t"] < t) & (done["t"] >= t - HISTORY_WEEKS)]
        hist_p = tg[(tg["t"] < t) & (tg["t"] >= t - HISTORY_WEEKS) & tg["success"].notna()]
        if len(hist_g) < 50 or len(hist_p) < 100:
            continue
        pts = _points_ratings(hist_g, idx, n, _weights(hist_g["t"].values, hist_g["season"].values, t, season, half_life))
        off, dfn = _success_ratings(hist_p, idx, n, _weights(hist_p["t"].values, hist_p["season"].values, t, season, half_life))
        for g in week_games.itertuples():
            h, a = idx[g.home_team], idx[g.away_team]
            rows.append({
                "season": season, "week": week, "home_team": g.home_team, "away_team": g.away_team,
                "points_rating_diff": pts[h] - pts[a],
                "success_rating_diff": (off[h] + dfn[a]) - (off[a] + dfn[h]),
                "qb_diff": (qbs.value(getattr(g, "home_qb_id", None), g.home_team, t)
                            - qbs.value(getattr(g, "away_qb_id", None), g.away_team, t)),
                "home_field": 0.0 if g.location == "Neutral" else 1.0,
            })
    return pd.DataFrame(rows)
