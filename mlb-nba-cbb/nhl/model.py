"""
model.py - NHL Edge's game model: pre-game features and the win probability.

League walks every game in date order. Before each game it can describe both
teams as they stood that morning (features), then it learns from the result
(update). Training, the backtest and the daily picks all use this one walk, so
the model is never fed anything it couldn't have known before puck drop.

Features are home-minus-away differences plus a home-ice flag:
  elo        - Elo rating (goal-margin adjusted, carried across seasons)
  net        - season goal differential per game, shrunk toward 0 early on
  recent     - goal differential over the last 10 games, shrunk the same way
  rest, b2b  - days since the last game (capped at 3) and back-to-back flags
The model predicts the home team's goal margin; the win chance is the normal
CDF of margin / sigma. A game decided in overtime or a shootout counts as a
one-goal win, which is how its final score reads.
"""

import math
from collections import defaultdict
from datetime import date

ELO_START = 1500
ELO_K = 8
ELO_HOME = 35
ELO_CARRY = 0.7  # share of a team's Elo gap from average kept over the offseason
RECENT_GAMES = 10
NET_SHRINK = 8  # games of "average" (0 margin) blended into season differential
RECENT_SHRINK = 5

# Tunable settings of the walk itself. Retraining (research/train.py) tries
# other values and saves the winners with the model as "league".
DEFAULT_PARAMS = {"elo_k": ELO_K, "elo_carry": ELO_CARRY, "net_shrink": NET_SHRINK, "recent_shrink": RECENT_SHRINK}

FEATURES = ["home_ice", "elo", "net", "recent", "rest", "b2b_home", "b2b_away"]


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


class League:
    def __init__(self, params=None):
        self.p = {**DEFAULT_PARAMS, **(params or {})}
        self.elo = defaultdict(lambda: ELO_START)
        self.season = None
        self.margins = defaultdict(list)  # team -> this season's goal margins
        self.last_date = {}

    # ── season rollover ──
    def _start_season(self, season):
        if self.season is not None:
            mean = sum(self.elo.values()) / max(len(self.elo), 1)
            for t in list(self.elo):
                self.elo[t] = mean + self.p["elo_carry"] * (self.elo[t] - mean)
            self.margins.clear()
        self.season = season

    def _check_season(self, season):
        if season != self.season:
            self._start_season(season)

    # ── features ──
    def team_form(self, team):
        m = self.margins[team]
        net = sum(m) / (len(m) + self.p["net_shrink"])
        last = m[-RECENT_GAMES:]
        recent = sum(last) / (len(last) + self.p["recent_shrink"])
        return net, recent

    def rest_days(self, team, day):
        last = self.last_date.get(team)
        if last is None:
            return 3
        return max(0, min(3, (date.fromisoformat(day) - date.fromisoformat(last)).days - 1))

    def features(self, g):
        self._check_season(g["season"])
        h, a = g["home"], g["away"]
        h_net, h_recent = self.team_form(h)
        a_net, a_recent = self.team_form(a)
        h_rest, a_rest = self.rest_days(h, g["date"]), self.rest_days(a, g["date"])
        return {
            "home_ice": 0.0 if g.get("neutral") else 1.0,
            "elo": (self.elo[h] - self.elo[a]) / 100,
            "net": h_net - a_net,
            "recent": h_recent - a_recent,
            "rest": float(h_rest - a_rest),
            "b2b_home": 1.0 if h_rest == 0 else 0.0,
            "b2b_away": 1.0 if a_rest == 0 else 0.0,
        }

    # ── learning from a result ──
    def update(self, g):
        self._check_season(g["season"])
        h, a = g["home"], g["away"]
        margin = g["home_pts"] - g["away_pts"]
        home_adv = 0 if g.get("neutral") else ELO_HOME
        diff = self.elo[h] + home_adv - self.elo[a]
        expected = 1 / (1 + 10 ** (-diff / 400))
        won = 1.0 if margin > 0 else 0.0
        winner_diff = diff if margin > 0 else -diff
        # Bigger wins move ratings more, less so when the favorite won.
        mult = math.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2)
        shift = self.p["elo_k"] * mult * (won - expected)
        self.elo[h] += shift
        self.elo[a] -= shift
        self.margins[h].append(margin)
        self.margins[a].append(-margin)
        self.last_date[h] = self.last_date[a] = g["date"]


def predict_margin(weights, feats):
    return sum(weights["coef"][k] * feats[k] for k in weights["features"])


def win_prob(weights, feats):
    """(home win probability, projected home goal margin)."""
    m = predict_margin(weights, feats)
    return norm_cdf(m / weights["sigma"]), m
