"""
rating_walks.py
The Elo and Pythagorean math both football context builders use
(game_context.py for the NFL, cfb_context.py for CFB). Each sport keeps its
own constants, game order, team keys and output columns; the per-game math
lives here once.
"""

import numpy as np
import pandas as pd


def regress_to_mean(elo, carry):
    """Pull every rating `carry` of the way back toward the league mean
    (between seasons)."""
    mean = sum(elo.values()) / len(elo)
    return {t: mean + carry * (v - mean) for t, v in elo.items()}


def elo_shift(h, a, margin, neutral, k, home_edge):
    """Points the home team's Elo moves after a final (the away team's moves
    the other way): FiveThirtyEight's margin-of-victory multiplier with its
    autocorrelation correction."""
    diff = h + (0 if neutral else home_edge) - a
    expected = 1 / (1 + 10 ** (-diff / 400))
    won = 1.0 if margin > 0 else 0.5 if margin == 0 else 0.0
    winner_diff = diff if margin > 0 else -diff
    mult = np.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2) if margin else 1.0
    return k * mult * (won - expected)


def pyth_walk(rows, default_avg, exp, prior):
    """Yields (row, pyth_diff) for each game row (namedtuples with season,
    home_team, away_team, home_score, away_score, already in game order):
    the gap in log-odds of each team's Pythagorean win rate from this
    season's earlier finished games, each starting from `prior` games at the
    league average (default_avg points before any game is final)."""
    pf, pa, season, tot = {}, {}, None, [0.0, 0]
    for r in rows:
        if r.season != season:
            pf, pa, tot, season = {}, {}, [0.0, 0], r.season
        avg = tot[0] / tot[1] if tot[1] else default_avg

        def lo(t):
            f = pf.get(t, 0.0) + prior * avg
            x = pa.get(t, 0.0) + prior * avg
            p = f ** exp / (f ** exp + x ** exp)
            return np.log(p / (1 - p))
        yield r, lo(r.home_team) - lo(r.away_team)
        if pd.isna(r.home_score) or pd.isna(r.away_score):
            continue
        for t, f, x in ((r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)):
            pf[t] = pf.get(t, 0.0) + f
            pa[t] = pa.get(t, 0.0) + x
            tot[0] += f
            tot[1] += 1
