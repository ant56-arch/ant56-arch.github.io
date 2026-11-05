"""
model.py - NBA Edge's game model: pre-game features and the win probability.

League walks every game in date order. Before each game it can describe both
teams as they stood that morning (features), then it learns from the result
(update). Training, the backtest and the daily picks all use this one walk, so
the model is never fed anything it couldn't have known before tip-off.

Features are home-minus-away differences plus a home-court flag:
  elo        - Elo rating (margin-of-victory adjusted, carried across seasons)
  net        - season point differential per game, shrunk toward 0 early on
  recent     - point differential over the last 10 games, shrunk the same way
  rest, b2b  - days since the last game (capped at 3) and back-to-back flags
  missing    - value of regular rotation players who aren't playing, from
               each player's average game score this season
Two optional features follow published rating methods (game_methods.py), and
only recipes that list them in "extras" use them:
  massey     - Massey / Simple Rating System point margin, opponent-adjusted
  pyth       - Pythagorean expectation from points for and against (log-odds)
  lineup     - (2026-11-05) strength of who is actually available: the summed
               value of the best LINEUP_PLAYERS rotation players playing,
               home minus away, from ESPN box scores (player-based rating)
The model predicts the home team's margin; the win chance is the normal CDF of
margin / sigma.
"""

import os
import sys
from collections import defaultdict, deque

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from game_methods import SeasonMethods  # noqa: E402
import team_model_common as TM  # noqa: E402
from team_model_common import WalkBase, basketball_mov, elo_update, regress_elo  # noqa: E402

# The win-chance helpers live in team_model_common; these names are this model's.
norm_cdf, norm_inv, predict_margin, win_prob = TM.norm_cdf, TM.norm_inv, TM.predict_margin, TM.win_prob

ELO_START = 1500
ELO_K = 20
ELO_HOME = 100
ELO_CARRY = 0.75  # share of a team's Elo gap from average kept over the offseason
RECENT_GAMES = 10
NET_SHRINK = 5  # games of "average" (0 margin) blended into season differential
RECENT_SHRINK = 3
ROTATION_GAMES = 10  # a player counts as a regular if he played in any of the team's last 10 games
PLAYER_PRIOR_GAMES = 8  # last season's average fades out over this many games this season

# Tunable settings of the walk itself. Retraining (research/train.py) tries
# other values and saves the winners with the model as "league".
DEFAULT_PARAMS = {"elo_k": ELO_K, "elo_carry": ELO_CARRY, "net_shrink": NET_SHRINK, "recent_shrink": RECENT_SHRINK}

FEATURES = ["home_court", "elo", "net", "recent", "rest", "b2b_home", "b2b_away", "missing_home", "missing_away"]
EXTRAS = {"massey": ["massey"], "pyth": ["pyth"], "travel": ["travel"], "lineup": ["lineup"]}
LINEUP_PLAYERS = 8  # a normal rotation
# Each team's home time zone (hours from UTC, standard time), for the travel tryout.
TEAM_TZ = {**{t: -5 for t in ("ATL", "BKN", "BOS", "CHA", "CLE", "DET", "IND", "MIA", "NY", "ORL", "PHI", "TOR", "WSH")},
           **{t: -6 for t in ("CHI", "DAL", "HOU", "MEM", "MIL", "MIN", "NO", "OKC", "SA")},
           **{t: -7 for t in ("DEN", "PHX", "UTAH")},
           **{t: -8 for t in ("GS", "LAC", "LAL", "POR", "SAC")}}
PYTH_EXPONENT = 14.0  # the usual NBA Pythagorean exponent (Morey / Hollinger)


def game_score(p):
    """Simplified Hollinger game score from an espn.boxscore row."""
    _, _, _mins, pts, reb, ast, stl, blk, tov, fgm, fga, ftm, fta, _pm = p
    return pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.5 * reb + stl + 0.7 * ast + 0.7 * blk - tov


class League(WalkBase):
    RECENT_GAMES = RECENT_GAMES

    def __init__(self, params=None):
        self.p = {**DEFAULT_PARAMS, **(params or {})}
        self.elo = defaultdict(lambda: ELO_START)
        self.season = None
        self.margins = defaultdict(list)  # team -> this season's margins
        self.last_date = {}
        self.last_tz = {}  # team -> time zone of the arena it last played in
        self.team_rosters = defaultdict(lambda: deque(maxlen=ROTATION_GAMES))  # team -> sets of player ids
        self.player_team = {}  # player -> team he last played for
        self.player_name = {}
        self.p_season = defaultdict(lambda: [0, 0.0])  # player -> [games, game score sum] this season
        self.p_prior = {}  # player -> last season's average game score
        self.methods = SeasonMethods(PYTH_EXPONENT, shrink=5.0, prior=5.0)
        self.methods_pending = []  # results not yet in self.methods: they go in when a later day is asked

    # ── season rollover ──
    def _start_season(self, season):
        if self.season is not None:
            regress_elo(self.elo, self.p["elo_carry"])
            self.p_prior = {pid: s / g for pid, (g, s) in self.p_season.items() if g >= 10}
            self.p_season.clear()
            self.margins.clear()
            self.last_tz.clear()
            self.team_rosters.clear()
            self.methods.reset()
            self.methods_pending = []
        self.season = season

    # ── player values ──
    def player_value(self, pid):
        g, s = self.p_season.get(pid, (0, 0.0))
        prior = self.p_prior.get(pid)
        if prior is None:
            return s / g if g else 0.0
        w = min(g, PLAYER_PRIOR_GAMES) / PLAYER_PRIOR_GAMES
        return w * (s / g if g else 0.0) + (1 - w) * prior

    def rotation(self, team):
        """Players who played for this team in any of its last 10 games and
        haven't turned up for another team since."""
        ids = set().union(*self.team_rosters[team]) if self.team_rosters[team] else set()
        return {pid for pid in ids if self.player_team.get(pid) == team}

    def missing_value(self, team, playing_ids):
        """Summed value of rotation players who aren't in playing_ids."""
        return sum(max(self.player_value(pid), 0.0) for pid in self.rotation(team) - set(playing_ids))

    def available_value(self, team, playing_ids):
        """Summed value of the best LINEUP_PLAYERS rotation players who are playing."""
        vals = sorted((max(self.player_value(pid), 0.0) for pid in self.rotation(team) & set(playing_ids)), reverse=True)
        return sum(vals[:LINEUP_PLAYERS])

    def missing_players(self, team, playing_ids, top=4):
        out = [(self.player_value(pid), pid) for pid in self.rotation(team) - set(playing_ids)]
        out.sort(reverse=True)
        return [(self.player_name.get(pid, ""), round(v, 1)) for v, pid in out[:top] if v >= 5]

    # ── features ──
    def features(self, g, home_missing=0.0, away_missing=0.0, home_avail=None, away_avail=None):
        self._check_season(g["season"])
        self._methods_through(g["date"])
        h, a = g["home"], g["away"]
        h_net, h_recent = self.team_form(h)
        a_net, a_recent = self.team_form(a)
        h_rest, a_rest = self.rest_days(h, g["date"]), self.rest_days(a, g["date"])
        return {
            "home_court": 0.0 if g.get("neutral") else 1.0,
            "elo": (self.elo[h] - self.elo[a]) / 100,
            "net": h_net - a_net,
            "recent": h_recent - a_recent,
            "rest": float(h_rest - a_rest),
            "b2b_home": 1.0 if h_rest == 0 else 0.0,
            "b2b_away": 1.0 if a_rest == 0 else 0.0,
            "missing_home": home_missing / 10,
            "missing_away": away_missing / 10,
            "massey": self.methods.massey(h) - self.methods.massey(a),
            "pyth": self.methods.pyth(h) - self.methods.pyth(a),
            # Time zones crossed since each team's last game, road team minus home
            # team; 0 at a neutral site, where the home team's zone isn't the venue's.
            "travel": 0.0 if g.get("neutral") else float(self.tz_moved(a, h) - self.tz_moved(h, h)),
            # None (no box score or no report) counts as a full rotation.
            "lineup": ((self.available_value(h, self.rotation(h)) if home_avail is None else home_avail)
                       - (self.available_value(a, self.rotation(a)) if away_avail is None else away_avail)) / 10,
        }

    def tz_moved(self, team, host):
        here = TEAM_TZ.get(host)
        last = self.last_tz.get(team)
        return 0 if here is None or last is None else abs(here - last)

    def features_from_box(self, g, box):
        """Features for a past game, taking who played from its box score."""
        self._check_season(g["season"])
        box = box or {}

        def played(team):
            return [p[0] for p in box.get(team, {}).get("players", [])]

        hm = self.missing_value(g["home"], played(g["home"])) if g["home"] in box else 0.0
        am = self.missing_value(g["away"], played(g["away"])) if g["away"] in box else 0.0
        ha = self.available_value(g["home"], played(g["home"])) if g["home"] in box else None
        aa = self.available_value(g["away"], played(g["away"])) if g["away"] in box else None
        return self.features(g, hm, am, ha, aa)

    # ── learning from a result ──
    def update(self, g, box=None):
        self._check_season(g["season"])
        h, a = g["home"], g["away"]
        margin = g["home_pts"] - g["away_pts"]
        home_adv = 0 if g.get("neutral") else ELO_HOME
        elo_update(self.elo, h, a, margin, home_adv, self.p["elo_k"], basketball_mov)

        self.margins[h].append(margin)
        self.margins[a].append(-margin)
        self.methods_pending.append((g["date"], h, a, g["home_pts"], g["away_pts"], g.get("neutral")))
        self.last_date[h] = self.last_date[a] = g["date"]
        if h in TEAM_TZ:
            self.last_tz[h] = self.last_tz[a] = TEAM_TZ[h]

        for team in (h, a):
            rows = (box or {}).get(team, {}).get("players", [])
            if not rows:
                continue
            ids = set()
            for p in rows:
                pid = p[0]
                ids.add(pid)
                self.player_team[pid] = team
                self.player_name[pid] = p[1]
                rec = self.p_season[pid]
                rec[0] += 1
                rec[1] += game_score(p)
            self.team_rosters[team].append(ids)
