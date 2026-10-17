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
Two optional features need box scores, and only recipes that list them in
"extras" use them (EXTRAS):
  shot_share - share of shots on goal over the last 20 games, minus 50%,
               pulled toward 50% with 5 games of an even split
  goalie     - the goalies a team has been starting: each goalie's goals saved
               above an average goalie per 100 shots (recent games count
               most, pulled toward average with 500 shots), weighted by his
               share of the team's last 10 starts. No starter has to be known
               before the game, so picks and training see the same thing.
Two more optional features follow published rating methods (game_methods.py):
  massey     - Massey / Simple Rating System goal margin, opponent-adjusted
  pyth       - Pythagorean expectation from goals for and against (log-odds)
The model predicts the home team's goal margin; the win chance is the normal
CDF of margin / sigma. A game decided in overtime or a shootout counts as a
one-goal win, which is how its final score reads.
"""

import math
import os
import sys
from collections import defaultdict
from datetime import date

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from game_methods import SeasonMethods  # noqa: E402

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
EXTRAS = {"shots": ["shot_share"], "goalies": ["goalie"], "massey": ["massey"], "pyth": ["pyth"]}
PYTH_EXPONENT = 2.0    # hockey's usual Pythagorean exponent
SHOT_GAMES = 20
SHOT_SHRINK = 5        # games of an even shot split mixed in
GOALIE_PRIOR = 500     # shots of average goaltending mixed into each goalie
GOALIE_DECAY = 0.98    # a goalie's past shots fade by this much each time he plays
START_GAMES = 10       # starts that set a team's goalie mix


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


class League:
    def __init__(self, params=None):
        self.p = {**DEFAULT_PARAMS, **(params or {})}
        self.elo = defaultdict(lambda: ELO_START)
        self.season = None
        self.margins = defaultdict(list)  # team -> this season's goal margins
        self.last_date = {}
        self.shots = defaultdict(list)    # team -> [(for, against)] over recent games with box scores
        self.goalie = defaultdict(lambda: [0.0, 0.0])  # goalie id -> [shots against, saves], decayed
        self.starts = defaultdict(list)   # team -> recent starting goalie ids
        self.lg = [0.0, 0.0]              # league shots against, saves (decayed)
        self.methods = SeasonMethods(PYTH_EXPONENT, shrink=8.0, prior=8.0)

    # ── season rollover ──
    def _start_season(self, season):
        if self.season is not None:
            mean = sum(self.elo.values()) / max(len(self.elo), 1)
            for t in list(self.elo):
                self.elo[t] = mean + self.p["elo_carry"] * (self.elo[t] - mean)
            self.margins.clear()
            self.methods.reset()
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

    def shot_share(self, team):
        last = self.shots[team][-SHOT_GAMES:]
        f, a = sum(x[0] for x in last), sum(x[1] for x in last)
        even = 30.0 * SHOT_SHRINK
        return (f + even) / (f + a + 2 * even) - 0.5

    def goalie_quality(self, team):
        starts = self.starts[team][-START_GAMES:]
        if not starts:
            return 0.0
        avg = self.lg[1] / self.lg[0] if self.lg[0] else 0.9
        total = 0.0
        for gid in starts:
            sa, sv = self.goalie[gid]
            total += 100 * (sv - avg * sa) / (sa + GOALIE_PRIOR)
        return total / len(starts)

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
            "shot_share": self.shot_share(h) - self.shot_share(a),
            "goalie": self.goalie_quality(h) - self.goalie_quality(a),
            "massey": self.methods.massey(h) - self.methods.massey(a),
            "pyth": self.methods.pyth(h) - self.methods.pyth(a),
        }

    # ── learning from a result ──
    def update_box(self, g, box):
        """Shots and goalies from a box score ({team: {"sog", "goalies"}})."""
        h, a = g["home"], g["away"]
        if not box or h not in box or a not in box:
            return
        hs, as_ = box[h].get("sog"), box[a].get("sog")
        if hs is not None and as_ is not None:
            self.shots[h].append((hs, as_))
            self.shots[a].append((as_, hs))
            for t in (h, a):
                del self.shots[t][:-SHOT_GAMES]
        for t in (h, a):
            goalies = box[t].get("goalies") or []
            if not goalies:
                continue
            self.starts[t].append(goalies[0][0])
            del self.starts[t][:-START_GAMES]
            for gid, _, sa, sv, _ in goalies:
                rec = self.goalie[gid]
                rec[0] = rec[0] * GOALIE_DECAY + sa
                rec[1] = rec[1] * GOALIE_DECAY + sv
                self.lg[0] = self.lg[0] * 0.999 + sa
                self.lg[1] = self.lg[1] * 0.999 + sv

    def update(self, g, box=None):
        self._check_season(g["season"])
        self.update_box(g, box)
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
        self.methods.add(h, a, g["home_pts"], g["away_pts"], g.get("neutral"))
        self.last_date[h] = self.last_date[a] = g["date"]


def predict_margin(weights, feats):
    return sum(weights["coef"][k] * feats[k] for k in weights["features"])


def win_prob(weights, feats):
    """(home win probability, projected home goal margin)."""
    m = predict_margin(weights, feats)
    return norm_cdf(m / weights["sigma"]), m
