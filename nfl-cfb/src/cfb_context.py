"""
cfb_context.py
Extra inputs the CFB refit can try on top of the efficiency model (Anthony,
2026-10-17: 10 tryout versions per sport, using methods others use):

  power  our own power ratings (cfb_ratings.py) as they stood before the game:
         overall gap + home field, rebuilt week by week from earlier games only
  bye    rest gap in days (a bye week shows up as +7), capped at 7 either way
  elo    an Elo rating that moves with every result and carries across seasons
  pyth   Pythagorean record gap from this season's points for and against

Each works on CFBD's full /games list (every FBS and FCS game, so a
non-Power opponent's last game counts too) and gives one value per game id,
for finished and upcoming games alike. The refit (fit_cfb_model.py) and the
live picks (models/cfb_game_predictions.py) use the same functions.
"""

import numpy as np
import pandas as pd

import cfb_ratings as cr

FEATURES = {"power": ["power_diff"], "bye": ["rest_diff"], "elo": ["elo_diff"], "pyth": ["pyth_diff"]}
COLUMNS = [c for cols in FEATURES.values() for c in cols]
ELO_K, ELO_HOME, ELO_CARRY = 25.0, 55.0, 2 / 3
FCS_ELO = 1300.0  # where a team never seen before starts if it isn't FBS
PYTH_EXP, PYTH_PRIOR = 2.37, 2.0
REST_DAYS, REST_CAP = 7.0, 7.0


def _in_order(games):
    g = games.copy()
    g["kick"] = pd.to_datetime(g["start"], utc=True, errors="coerce")
    return g.sort_values(["season", "kick", "id"], kind="stable")


def _neutral(v):
    return bool(v) if pd.notna(v) else False


def rest_features(games):
    """rest_diff for every game: home team's days since its last game this
    season minus the away team's (a team's opener counts as a normal week)."""
    g = _in_order(games)
    last, out = {}, []
    for r in g.itertuples(index=False):
        rest = []
        for t in (r.home_team, r.away_team):
            prev = last.get((r.season, t))
            rest.append(REST_DAYS if prev is None or pd.isna(r.kick) else (r.kick - prev).total_seconds() / 86400)
            if not pd.isna(r.kick):
                last[(r.season, t)] = r.kick
        out.append((r.id, float(np.clip(round(rest[0]) - round(rest[1]), -REST_CAP, REST_CAP))))
    return pd.DataFrame(out, columns=["id", "rest_diff"])


def elo_walk(games, fbs=(), start=None):
    """elo_diff before every game (in 100s of Elo points), walking finished
    games in date order and pulling every team 1/3 back to the middle between
    seasons. start: {"season": s, "ratings": {...}} to begin from the table as
    it stood before season s (the refit saves one for the live picks).
    Returns (features, the table before the last season in games)."""
    elo, season, out, snap = {}, None, [], None
    if start:
        elo, season = dict(start["ratings"]), int(start["season"])
    last_season = int(games["season"].max())
    for r in _in_order(games).itertuples(index=False):
        if r.season != season:
            if season is not None and elo:
                mean = sum(elo.values()) / len(elo)
                elo = {t: mean + ELO_CARRY * (v - mean) for t, v in elo.items()}
            season = r.season
            if season == last_season:
                snap = {"season": int(season), "ratings": {t: round(v, 2) for t, v in elo.items()}}
        h = elo.setdefault(r.home_team, 1500.0 if r.home_team in fbs else FCS_ELO)
        a = elo.setdefault(r.away_team, 1500.0 if r.away_team in fbs else FCS_ELO)
        out.append((r.id, (h - a) / 100))
        if pd.isna(r.home_score) or pd.isna(r.away_score):
            continue
        margin = r.home_score - r.away_score
        diff = h + (0 if _neutral(r.neutral) else ELO_HOME) - a
        expected = 1 / (1 + 10 ** (-diff / 400))
        won = 1.0 if margin > 0 else 0.5 if margin == 0 else 0.0
        winner_diff = diff if margin > 0 else -diff
        mult = np.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2) if margin else 1.0
        shift = ELO_K * mult * (won - expected)
        elo[r.home_team], elo[r.away_team] = h + shift, a - shift
    return pd.DataFrame(out, columns=["id", "elo_diff"]), snap


def pyth_features(games):
    """pyth_diff before every game: the gap in log-odds of each team's
    Pythagorean win rate from this season's finished games, each starting
    from PYTH_PRIOR games at the league average."""
    pf, pa, season, tot, out = {}, {}, None, [0.0, 0], []
    for r in _in_order(games).itertuples(index=False):
        if r.season != season:
            pf, pa, tot, season = {}, {}, [0.0, 0], r.season
        avg = tot[0] / tot[1] if tot[1] else 28.0

        def lo(t):
            f = pf.get(t, 0.0) + PYTH_PRIOR * avg
            x = pa.get(t, 0.0) + PYTH_PRIOR * avg
            p = f ** PYTH_EXP / (f ** PYTH_EXP + x ** PYTH_EXP)
            return np.log(p / (1 - p))
        out.append((r.id, lo(r.home_team) - lo(r.away_team)))
        if pd.isna(r.home_score) or pd.isna(r.away_score):
            continue
        for t, f, x in ((r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)):
            pf[t] = pf.get(t, 0.0) + f
            pa[t] = pa.get(t, 0.0) + x
            tot[0] += f
            tot[1] += 1
    return pd.DataFrame(out, columns=["id", "pyth_diff"])


def power_features(games, seasons, fbs, eff, returning, talent):
    """power_diff before every game of `seasons`: cfb_ratings.fit_ratings on
    the games finished before that week (this season and last), starting from
    the preseason rating, exactly as the Ratings tab builds them each week.
    fbs/returning/talent: season -> teams / {team: value}; eff: (game id,
    team) -> EPA per play. A game with a non-FBS team gets 0."""
    g = games.copy()
    g["home_ppa"] = [eff.get((i, t), np.nan) for i, t in zip(g["id"], g["home_team"])]
    g["away_ppa"] = [eff.get((i, t), np.nan) for i, t in zip(g["id"], g["away_team"])]
    g["_o"] = cr._order(g).values
    out = []
    for s in seasons:
        two = g[g["season"].isin([s - 1, s])]
        done = two.dropna(subset=["home_score", "away_score"])
        prior = cr.preseason_prior(two, fbs.get(s - 1, set()), s, returning.get(s, {}), talent.get(s, {}))
        cur = two[two["season"] == s]
        for t in sorted(cur["_o"].unique()):
            before = done[done["_o"] < t]
            if before.empty:
                continue
            ratings, hfa = cr.fit_ratings(before, fbs.get(s, set()), t, s, prior)
            for r in cur[cur["_o"] == t].itertuples(index=False):
                line = cr.rating_line(ratings, hfa, r.home_team, r.away_team, _neutral(r.neutral))
                out.append((r.id, 0.0 if np.isnan(line) else line))
        print(f"    power ratings walked through {s}")
    return pd.DataFrame(out, columns=["id", "power_diff"])


def power_live(games, ratings_path=None):
    """power_diff for upcoming games from the current cfb_ratings.json."""
    import json
    import os
    path = ratings_path or cr.RATINGS_PATH
    if not os.path.exists(path):
        return pd.DataFrame(columns=["id", "power_diff"])
    with open(path) as f:
        data = json.load(f)
    ratings = pd.DataFrame(data.get("teams", []))
    hfa = float(data.get("home_field", 0.0))
    out = []
    for r in games.itertuples(index=False):
        line = cr.rating_line(ratings, hfa, r.home_team, r.away_team, _neutral(r.neutral)) if not ratings.empty else np.nan
        out.append((r.id, 0.0 if np.isnan(line) else line))
    return pd.DataFrame(out, columns=["id", "power_diff"])
