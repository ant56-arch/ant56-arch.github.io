"""
team_model_common.py - the pieces the NBA, NHL, CBB and MLB team models
(nba/, nhl/, cbb/, teams/ model.py) share: the win-chance curves, the Elo
margin-of-victory update and offseason regression, and the League walk's
season check, rest days, recent form and day-by-day Massey / Pythagorean
bookkeeping (game_methods.py).
"""

import math
from datetime import date


# ── win chances ─────────────────────────────────────────────────────────────
def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def norm_inv(p):
    """The z with norm_cdf(z) = p."""
    from statistics import NormalDist
    return NormalDist().inv_cdf(p)


def sigmoid(z):
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))


def predict_margin(weights, feats):
    return sum(weights["coef"][k] * feats[k] for k in weights["features"])


def win_prob(weights, feats):
    """(home win probability, projected home margin) of a margin model."""
    m = predict_margin(weights, feats)
    return norm_cdf(m / weights["sigma"]), m


# ── Elo ─────────────────────────────────────────────────────────────────────
def basketball_mov(margin, winner_diff):
    """FiveThirtyEight's NBA margin-of-victory multiplier."""
    return ((abs(margin) + 3) ** 0.8) / (7.5 + 0.006 * winner_diff)


def low_score_mov(margin, winner_diff):
    """The hockey / baseball multiplier: bigger wins move ratings more, less so
    when the favorite won."""
    return math.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2)


def elo_update(elo, h, a, margin, home_adv, k, mov):
    """Move both teams' Elo (a dict) after a game with this home margin."""
    diff = elo[h] + home_adv - elo[a]
    expected = 1 / (1 + 10 ** (-diff / 400))
    won = 1.0 if margin > 0 else 0.0
    winner_diff = diff if margin > 0 else -diff
    shift = k * mov(margin, winner_diff) * (won - expected)
    elo[h] += shift
    elo[a] -= shift


def regress_elo(elo, carry):
    """The offseason: each team keeps `carry` of its gap from the average."""
    mean = sum(elo.values()) / max(len(elo), 1)
    for t in list(elo):
        elo[t] = mean + carry * (elo[t] - mean)


# ── the League walk ─────────────────────────────────────────────────────────
class WalkBase:
    """Shared League methods. A subclass sets self.season, self.last_date,
    self.margins, self.methods and self.methods_pending, and _start_season()."""

    REST_CAP = 3  # days of rest that count; more is the same as this
    RECENT_GAMES = 10

    def _check_season(self, season):
        if season != self.season:
            self._start_season(season)

    def rest_days(self, team, day):
        last = self.last_date.get(team)
        if last is None:
            return self.REST_CAP
        return max(0, min(self.REST_CAP, (date.fromisoformat(day) - date.fromisoformat(last)).days - 1))

    def team_form(self, team):
        """(season margin per game, margin over the last RECENT_GAMES), each
        shrunk toward 0 with the "net_shrink" / "recent_shrink" settings."""
        m = self.margins[team]
        net = sum(m) / (len(m) + self.p["net_shrink"])
        last = m[-self.RECENT_GAMES:]
        recent = sum(last) / (len(last) + self.p["recent_shrink"])
        return net, recent

    def _methods_through(self, day):
        """Add every pending result from before `day` to the Massey /
        Pythagorean ratings, so they stand as they did that morning (a game
        earlier the same day isn't known at pick time) and are solved once a
        day (the solve is the slow part of a walk)."""
        ready = [x for x in self.methods_pending if x[0] < day]
        if ready:
            for _, *game in ready:
                self.methods.add(*game)
            self.methods_pending = [x for x in self.methods_pending if x[0] >= day]
