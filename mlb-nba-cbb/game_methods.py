"""
game_methods.py - two well-known ways to rate teams from this season's scores,
shared by the NHL, NBA, MLB and CBB game models as optional tryout features.

  massey  Massey / Simple Rating System: each team's average margin, adjusted
          for how strong its opponents were (rating = own margin + average
          opponent rating, solved by repeating until it settles). Home games
          count with the league's average home edge taken out. Pulled toward
          0 with `shrink` games of an average team, so early-season ratings
          stay modest.
  pyth    Pythagorean expectation (Bill James; Pomeroy for basketball): the
          win rate a team "should" have from points scored and allowed,
          pf^x / (pf^x + pa^x), with `prior` games of league-average scoring
          mixed in. Given as log-odds so the home-minus-away difference
          is the log5 matchup.

Both reset at the start of each season. Nothing here sees a game before it
is added, so a walk that asks for features first and adds the result after
never peeks.
"""

import math
from collections import defaultdict

SRS_ROUNDS = 12


class SeasonMethods:
    def __init__(self, exponent, shrink=5.0, prior=5.0):
        self.x, self.shrink, self.prior = exponent, shrink, prior
        self.reset()

    def reset(self):
        self.games = defaultdict(list)  # team -> [(opponent, margin with home edge removed)]
        self.pf = defaultdict(float)
        self.pa = defaultdict(float)
        self.n = defaultdict(int)
        self.home_margin = [0.0, 0]     # sum of home margins, home games (non-neutral)
        self._srs = None

    def add(self, home, away, hp, ap, neutral=False):
        if not neutral:
            self.home_margin[0] += hp - ap
            self.home_margin[1] += 1
        self.games[home].append((away, hp - ap, 0 if neutral else 1))
        self.games[away].append((home, ap - hp, 0 if neutral else -1))
        self.pf[home] += hp
        self.pa[home] += ap
        self.pf[away] += ap
        self.pa[away] += hp
        self.n[home] += 1
        self.n[away] += 1
        self._srs = None

    def _solve(self):
        edge = self.home_margin[0] / self.home_margin[1] / 2 if self.home_margin[1] else 0.0
        adj = {t: [(o, m - edge * side) for o, m, side in gs] for t, gs in self.games.items()}
        r = defaultdict(float)
        for _ in range(SRS_ROUNDS):
            new = defaultdict(float)
            for t, gs in adj.items():
                new[t] = sum(m + r[o] for o, m in gs) / (len(gs) + self.shrink)
            mean = sum(new.values()) / len(new) if new else 0.0
            r = defaultdict(float, {t: v - mean for t, v in new.items()})
        self._srs = r

    def massey(self, team):
        if self._srs is None:
            self._solve()
        return self._srs.get(team, 0.0)

    def pyth(self, team):
        games = sum(self.n.values())
        avg = sum(self.pf.values()) / games if games else 1.0
        pf = self.pf[team] + self.prior * avg
        pa = self.pa[team] + self.prior * avg
        p = pf ** self.x / (pf ** self.x + pa ** self.x)
        p = min(max(p, 1e-4), 1 - 1e-4)
        return math.log(p / (1 - p))
