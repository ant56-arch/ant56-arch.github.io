"""Feature definitions shared by predict.py (live) and research/train_model.py
(training), so a stat means exactly the same thing in both places.

Every rate is shrunk toward a prior in proportion to how little data backs it:
a hitter 3-for-5 over two weeks isn't a .600 hitter. This also covers the first
weeks of a season, when nobody has enough at-bats yet.
"""

LEAGUE_AVG = 0.245
LEAGUE_AB_PER_GAME = 3.7
LEAGUE_ERA = 4.20
LEAGUE_WHIP = 1.28
LEAGUE_K9 = 8.6

SEASON_PRIOR_AB = 60
RECENT_PRIOR_AB = 25
AB_PER_GAME_PRIOR_GAMES = 10
PITCHER_PRIOR_IP = 25
RECENT_WINDOW_DAYS = 14

CANDIDATE_FEATURES = [
    "season_avg",
    "recent_form_avg",
    "ab_per_game",
    "is_home",
    "platoon",
    "park_factor",
    "opp_pitcher_era",
    "opp_pitcher_whip",
    "opp_pitcher_k9",
]

# Inputs only the recipes that list them in "extras" use (research/train_model.py).
#   statcast - Baseball Savant's expected batting average (xBA: what a hitter's
#              contact should have produced, from exit speed and launch angle)
#              and strikeout rate for the hitter, and xBA allowed for the
#              opposing starter, all from the season before, so nothing a
#              game couldn't know in advance. statcast/*.csv, from Baseball
#              Savant's leaderboards (free).
EXTRA_FEATURES = {"statcast": ["batter_xba", "batter_k", "opp_pitcher_xba"]}
ALL_FEATURES = CANDIDATE_FEATURES + [c for cols in EXTRA_FEATURES.values() for c in cols]
STATCAST_PRIOR_PA = 200
LEAGUE_K = 0.225

FACTOR_GROUPS = {
    "season_avg": ["season_avg"],
    "recent_form": ["recent_form_avg"],
    "playing_time": ["ab_per_game"],
    "pitcher_matchup": ["opp_pitcher_era", "opp_pitcher_whip", "opp_pitcher_k9"],
    "platoon": ["platoon"],
    "park_factor": ["park_factor"],
    "home_away": ["is_home"],
    "contact_quality": ["batter_xba", "batter_k", "opp_pitcher_xba"],
}

PARK_FACTORS = {
    "Coors Field": 1.15, "Great American Ball Park": 1.08, "Fenway Park": 1.07,
    "Globe Life Field": 1.05, "Daikin Park": 1.04, "American Family Field": 1.04,
    "Wrigley Field": 1.03, "Oriole Park at Camden Yards": 1.03, "Camden Yards": 1.03,
    "Truist Park": 1.02, "Chase Field": 1.02, "Citizens Bank Park": 1.02,
    "Yankee Stadium": 1.01, "Rogers Centre": 1.00, "Kauffman Stadium": 1.00,
    "Angel Stadium": 1.00, "Target Field": 1.00, "Sutter Health Park": 1.00,
    "Busch Stadium": 0.99, "Dodger Stadium": 0.99, "UNIQLO Field at Dodger Stadium": 0.99,
    "Progressive Field": 0.99, "PNC Park": 0.98, "Nationals Park": 0.97,
    "T-Mobile Park": 0.97, "Tropicana Field": 0.97, "George M. Steinbrenner Field": 0.97,
    "Comerica Park": 0.96, "Rate Field": 0.96, "Petco Park": 0.96, "Oracle Park": 0.95,
    "loanDepot park": 0.95, "Citi Field": 0.95,
}


def shrink(total, n, prior, prior_n):
    return (total + prior * prior_n) / (n + prior_n)


def batter_features(season_hits, season_ab, season_games, recent_hits, recent_ab, prior_avg=LEAGUE_AVG):
    season_avg = shrink(season_hits, season_ab, prior_avg, SEASON_PRIOR_AB)
    return {
        "season_avg": season_avg,
        "recent_form_avg": shrink(recent_hits, recent_ab, season_avg, RECENT_PRIOR_AB),
        "ab_per_game": shrink(season_ab, season_games, LEAGUE_AB_PER_GAME, AB_PER_GAME_PRIOR_GAMES),
    }


def pitcher_features(era, whip, k9, ip):
    """Unknown pitcher (TBD starter, debut) falls back to league average."""
    if era is None or whip is None or k9 is None or not ip:
        return {"opp_pitcher_era": LEAGUE_ERA, "opp_pitcher_whip": LEAGUE_WHIP, "opp_pitcher_k9": LEAGUE_K9}
    return {
        "opp_pitcher_era": shrink(era * ip, ip, LEAGUE_ERA, PITCHER_PRIOR_IP),
        "opp_pitcher_whip": shrink(whip * ip, ip, LEAGUE_WHIP, PITCHER_PRIOR_IP),
        "opp_pitcher_k9": shrink(k9 * ip, ip, LEAGUE_K9, PITCHER_PRIOR_IP),
    }


def innings_to_float(ip_str):
    """MLB reports innings like '45.2' meaning 45 and 2/3."""
    if ip_str in (None, ""):
        return 0.0
    whole, _, outs = str(ip_str).partition(".")
    return int(whole or 0) + int(outs or 0) / 3


def matchup_features(is_home, batter_hand, pitcher_hand, venue, park_factors=None):
    """park_factors: the trained model's venue table (learned from results, so
    new or renamed ballparks are covered); PARK_FACTORS when it has none."""
    # Switch hitters always bat opposite-handed.
    platoon = batter_hand == "S" or (batter_hand and pitcher_hand and batter_hand != pitcher_hand)
    return {
        "is_home": 1.0 if is_home else 0.0,
        "platoon": 1.0 if platoon else 0.0,
        "park_factor": (park_factors or PARK_FACTORS).get(venue, 1.0),
    }


_statcast = {}


def _load_statcast():
    import csv
    import os
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "statcast")
    for kind in ("batter", "pitcher"):
        table = {}
        try:
            with open(os.path.join(here, f"{kind}s.csv")) as f:
                for r in csv.DictReader(f):
                    table[(int(r["player_id"]), int(r["year"]))] = r
        except FileNotFoundError:
            pass
        _statcast[kind] = table


def statcast_features(player_id, pitcher_id, season):
    """Last season's Baseball Savant numbers, pulled toward league average by
    STATCAST_PRIOR_PA plate appearances. Unknown players get league average."""
    if not _statcast:
        _load_statcast()

    def row(kind, pid):
        try:
            return _statcast[kind].get((int(pid), int(season) - 1))
        except (TypeError, ValueError):
            return None

    def val(r, col, league, scale=1.0):
        if not r or r.get(col) in (None, "") or not r.get("pa"):
            return league
        pa = float(r["pa"])
        return shrink(float(r[col]) * scale * pa, pa, league, STATCAST_PRIOR_PA)

    b, p = row("batter", player_id), row("pitcher", pitcher_id)
    return {"batter_xba": val(b, "est_ba", LEAGUE_AVG), "batter_k": val(b, "k_percent", LEAGUE_K, 0.01),
            "opp_pitcher_xba": val(p, "est_ba", LEAGUE_AVG)}
