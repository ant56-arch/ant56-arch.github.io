"""
game_context.py
Game-day context the opponent-adjusted ratings (team_ratings.py) don't see,
for the extra tryouts in fit_model.py's recipe search:

  "rest"      rest_diff   home team's days of rest minus the away team's,
                          capped at a week either way (byes, Thursday games)
              travel_tz   time zones the away team crossed (0 at a neutral site)
              div_home    home field in a division game (1 home, 0 neutral or
                          non-division), so division home field can differ
  "injuries"  inj_off_diff / inj_def_diff
                          how much of each side's usual lineup is on the
                          official injury report, away minus home (positive
                          helps the home team). A player counts with his share
                          of snaps over his last 4 games, times how likely his
                          status is to keep him out. QBs are left out: the
                          ratings' qb_diff already uses the starting QB.
  "elo"       elo_diff    FiveThirtyEight-style Elo, home minus away, in
                          hundreds of points: K 20, a margin-of-victory
                          multiplier that shrinks for big favorites, 1/3 pulled
                          back to average each offseason. Walks every game
                          nflverse has, so it needs the full history.
  "pyth"      pyth_diff   Pythagorean expectation (points scored^2.37 over
                          scored^2.37 + allowed^2.37) for this season so far,
                          with 2 games of league-average scoring mixed in,
                          home minus away in log-odds (the log5 matchup)
  "home"      home_season how far this season's league-wide home margin (true
                          home games, earlier days only) sits from the last
                          3 seasons', with HOME_PRIOR games of "no change"
                          mixed in, so a season where home teams stop winning
                          can lower home field (0 at a neutral site)

Every input comes from nflverse and is known before kickoff: rest days and
division games from the schedule, injuries from the Wednesday-Friday reports,
snap shares from earlier games only. Games with no injury report count as
nobody missing.
"""

import os

import numpy as np
import pandas as pd

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
KEY = ["season", "week", "home_team", "away_team"]

FEATURES = {
    "rest": ["rest_diff", "travel_tz", "div_home"],
    "injuries": ["inj_off_diff", "inj_def_diff"],
    "elo": ["elo_diff"],
    "pyth": ["pyth_diff"],
    "home": ["home_season"],
}
ELO_K, ELO_HOME, ELO_CARRY = 20.0, 48.0, 2 / 3
PYTH_EXP, PYTH_PRIOR = 2.37, 2.0
HOME_PRIOR, HOME_SEASONS = 64, 3
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

# Hours behind Eastern at each team's home stadium (Arizona keeps standard
# time, so it is 2 or 3 behind; 2.5 splits the season).
TEAM_TZ = {
    "ARI": 2.5, "ATL": 0, "BAL": 0, "BUF": 0, "CAR": 0, "CHI": 1, "CIN": 0, "CLE": 0, "DAL": 1,
    "DEN": 2, "DET": 0, "GB": 1, "HOU": 1, "IND": 0, "JAX": 0, "KC": 1, "LA": 3, "LAC": 3,
    "LV": 3, "MIA": 0, "MIN": 1, "NE": 0, "NO": 1, "NYG": 0, "NYJ": 0, "OAK": 3, "PHI": 0,
    "PIT": 0, "SD": 3, "SEA": 3, "SF": 3, "STL": 1, "TB": 0, "TEN": 1, "WAS": 0,
}

# Chance each report status keeps a player off the field. Probable (dropped
# after 2015) almost always played.
STATUS_OUT = {"Out": 1.0, "Doubtful": 0.9, "Questionable": 0.25, "Probable": 0.03}
SNAP_GAMES = 4  # a player's usual role: his average snap share over his last 4 games


def rest_features(schedules):
    """rest_diff, travel_tz and div_home for every game in schedules."""
    g = schedules[KEY + ["home_rest", "away_rest", "div_game", "location"]].copy()
    home = (g["location"] != "Neutral").astype(float)
    g["rest_diff"] = (g["home_rest"].fillna(7) - g["away_rest"].fillna(7)).clip(-7, 7)
    tz = (g["away_team"].map(TEAM_TZ) - g["home_team"].map(TEAM_TZ)).abs().fillna(0)
    g["travel_tz"] = tz * home
    g["div_home"] = g["div_game"].fillna(0).astype(float) * home
    return g[KEY + FEATURES["rest"]]


def _in_order(schedules):
    g = schedules.copy()
    g["_day"] = g["gameday"].astype(str).str[:10]
    return g.sort_values(["season", "_day", "week"], kind="stable")


ELO_ALIAS = {"OAK": "LV", "SD": "LAC", "STL": "LA"}  # a relocated team keeps its rating


def elo_features(schedules):
    """elo_diff before every game in schedules (finished or not), walking the
    finished games in date order."""
    elo, season, out = {}, None, []
    for r in _in_order(schedules).itertuples(index=False):
        hk, ak = ELO_ALIAS.get(r.home_team, r.home_team), ELO_ALIAS.get(r.away_team, r.away_team)
        if r.season != season:
            if season is not None and elo:
                mean = sum(elo.values()) / len(elo)
                elo = {t: mean + ELO_CARRY * (v - mean) for t, v in elo.items()}
            season = r.season
        h, a = elo.get(hk, 1500.0), elo.get(ak, 1500.0)
        out.append((r.season, r.week, r.home_team, r.away_team, (h - a) / 100))
        if pd.isna(r.home_score) or pd.isna(r.away_score):
            continue
        margin = r.home_score - r.away_score
        diff = h + (0 if r.location == "Neutral" else ELO_HOME) - a
        expected = 1 / (1 + 10 ** (-diff / 400))
        won = 1.0 if margin > 0 else 0.5 if margin == 0 else 0.0
        winner_diff = diff if margin > 0 else -diff
        mult = np.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2) if margin else 1.0
        shift = ELO_K * mult * (won - expected)
        elo[hk], elo[ak] = h + shift, a - shift
    return pd.DataFrame(out, columns=KEY + ["elo_diff"])


def pyth_features(schedules):
    """pyth_diff before every game in schedules, from this season's finished games."""
    pf, pa, season, out = {}, {}, None, []
    tot = [0.0, 0]
    for r in _in_order(schedules).itertuples(index=False):
        if r.season != season:
            pf, pa, tot, season = {}, {}, [0.0, 0], r.season
        avg = tot[0] / tot[1] if tot[1] else 22.0

        def lo(t):
            f = pf.get(t, 0.0) + PYTH_PRIOR * avg
            x = pa.get(t, 0.0) + PYTH_PRIOR * avg
            p = f ** PYTH_EXP / (f ** PYTH_EXP + x ** PYTH_EXP)
            return np.log(p / (1 - p))
        out.append((r.season, r.week, r.home_team, r.away_team, lo(r.home_team) - lo(r.away_team)))
        if pd.isna(r.home_score) or pd.isna(r.away_score):
            continue
        for t, f, x in ((r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)):
            pf[t] = pf.get(t, 0.0) + f
            pa[t] = pa.get(t, 0.0) + x
            tot[0] += f
            tot[1] += 1
    return pd.DataFrame(out, columns=KEY + ["pyth_diff"])


def home_features(schedules):
    """home_season before every game in schedules, from finished true home
    games on earlier days (a game never sees its own day's results)."""
    g = _in_order(schedules)
    home = (g["location"] != "Neutral").astype(float)
    margin = (g["home_score"] - g["away_score"]).where(home == 1)
    by_day = (pd.DataFrame({"season": g["season"], "_day": g["_day"], "m": margin})
              .dropna().groupby(["season", "_day"])["m"].agg(["sum", "count"]))
    by_season = by_day.groupby(level="season").sum()
    out = []
    for r, day, h in zip(g.itertuples(index=False), g["_day"], home):
        past = by_season.loc[[s for s in by_season.index if r.season - HOME_SEASONS <= s < r.season]]
        base = past["sum"].sum() / past["count"].sum() if past["count"].sum() else 0.0
        if r.season in by_day.index.get_level_values("season"):
            done = by_day.loc[r.season]
            done = done[done.index < day]
        else:
            done = by_day.iloc[0:0]
        n = done["count"].sum()
        mean = done["sum"].sum() / n if n else base
        out.append((r.season, r.week, r.home_team, r.away_team, h * n / (n + HOME_PRIOR) * (mean - base)))
    return pd.DataFrame(out, columns=KEY + ["home_season"])


def full_history(schedules, cache_dir=None):
    """Every NFL game nflverse has, for the Elo walk. Falls back to the
    schedules given if the download fails."""
    try:
        games = pd.read_csv(GAMES_URL)
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
            games.to_csv(os.path.join(cache_dir, "games_all.csv"), index=False)
        return games
    except Exception as e:  # noqa: BLE001
        cached = os.path.join(cache_dir or "", "games_all.csv")
        if cache_dir and os.path.exists(cached):
            return pd.read_csv(cached)
        print(f"  Full game history unavailable ({e}); Elo starts from the schedules given.")
        return schedules


def _usual_shares(snaps):
    """Each player's offense and defense snap share over his last SNAP_GAMES
    games, as known before each later week: one row per (player, t) where t is
    the season-week the share applies from."""
    s = snaps[["pfr_player_id", "season", "week", "offense_pct", "defense_pct"]].dropna(subset=["pfr_player_id"])
    s = s[(s["offense_pct"] > 0) | (s["defense_pct"] > 0)].copy()
    s["t"] = s["season"] * 100 + s["week"]
    s = s.sort_values(["pfr_player_id", "t"])
    grp = s.groupby("pfr_player_id")
    s["off_share"] = grp["offense_pct"].transform(lambda x: x.rolling(SNAP_GAMES, min_periods=1).mean())
    s["def_share"] = grp["defense_pct"].transform(lambda x: x.rolling(SNAP_GAMES, min_periods=1).mean())
    return s[["pfr_player_id", "t", "off_share", "def_share"]]


def injury_load(injuries, snaps, players):
    """Per (season, week, team): the snap share of the usual lineup on the
    injury report, offense and defense, weighted by each status's chance of
    sitting. Only snaps from before that week count."""
    inj = injuries[injuries["report_status"].isin(STATUS_OUT.keys()) & (injuries["position"] != "QB")]
    inj = inj[["season", "week", "team", "gsis_id", "report_status"]].dropna(subset=["gsis_id"])
    ids = players[["gsis_id", "pfr_id"]].dropna().drop_duplicates("gsis_id")
    inj = inj.merge(ids, on="gsis_id", how="inner").rename(columns={"pfr_id": "pfr_player_id"})
    if inj.empty:
        return pd.DataFrame(columns=["season", "week", "team", "inj_off", "inj_def"])
    inj["t"] = inj["season"] * 100 + inj["week"]
    shares = _usual_shares(snaps)
    # Shares as of the game before this week: the latest snap row with t < week.
    shares = shares.assign(t=shares["t"] + 1)
    inj = pd.merge_asof(inj.sort_values("t"), shares.sort_values("t"), on="t", by="pfr_player_id",
                        direction="backward")
    w = inj["report_status"].map(STATUS_OUT)
    inj["inj_off"] = inj["off_share"].fillna(0) * w
    inj["inj_def"] = inj["def_share"].fillna(0) * w
    return inj.groupby(["season", "week", "team"], as_index=False)[["inj_off", "inj_def"]].sum()


def injury_features(schedules, load):
    g = schedules[KEY].copy()
    for side in ("home", "away"):
        g = g.merge(load.rename(columns={"team": f"{side}_team", "inj_off": f"{side}_inj_off",
                                         "inj_def": f"{side}_inj_def"}),
                    on=["season", "week", f"{side}_team"], how="left")
    g = g.fillna({c: 0.0 for c in ("home_inj_off", "away_inj_off", "home_inj_def", "away_inj_def")})
    g["inj_off_diff"] = g["away_inj_off"] - g["home_inj_off"]
    g["inj_def_diff"] = g["away_inj_def"] - g["home_inj_def"]
    return g[KEY + FEATURES["injuries"]]


# ── nflverse downloads (cached) ──────────────────────────────────────────────
def _cached_csv(url, dest, refresh=False):
    if refresh or not os.path.exists(dest):
        df = pd.read_csv(url, low_memory=False)
        df.to_csv(dest, index=False)
        return df
    return pd.read_csv(dest, low_memory=False)


def load_injury_inputs(seasons, cache_dir, current_season=None):
    """Injury reports, snap counts and the player id map for these seasons.
    Past seasons are cached in cache_dir; the current season is always fresh.
    A season that isn't published yet is skipped."""
    os.makedirs(cache_dir, exist_ok=True)
    inj, snaps = [], []
    for s in seasons:
        fresh = s == current_season
        for kind, out, url in (("injuries", inj, f"{BASE}/injuries/injuries_{s}.csv"),
                               ("snap_counts", snaps, f"{BASE}/snap_counts/snap_counts_{s}.csv")):
            try:
                out.append(_cached_csv(url, os.path.join(cache_dir, f"{kind}_{s}.csv"), refresh=fresh))
            except Exception as e:  # noqa: BLE001 - a missing season just counts as no reports
                print(f"  No {kind} for {s}: {e}")
    players = _cached_csv(f"{BASE}/players/players.csv", os.path.join(cache_dir, "players.csv"),
                          refresh=current_season is not None)
    cat = lambda frames: pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()  # noqa: E731
    return cat(inj), cat(snaps), players


def context_features(schedules, kinds, injury_inputs=None, history=None):
    """KEY + the features of each kind in kinds, one row per game in schedules.
    history: every game to walk the Elo through (defaults to schedules)."""
    out = schedules[KEY].copy()
    if "elo" in kinds:
        h = history if history is not None else schedules
        out = out.merge(elo_features(h).drop_duplicates(KEY), on=KEY, how="left")
    if "pyth" in kinds:
        out = out.merge(pyth_features(schedules).drop_duplicates(KEY), on=KEY, how="left")
    if "home" in kinds:
        out = out.merge(home_features(schedules).drop_duplicates(KEY), on=KEY, how="left")
    if "rest" in kinds:
        out = out.merge(rest_features(schedules), on=KEY, how="left")
    if "injuries" in kinds:
        injuries, snaps, players = injury_inputs
        if injuries.empty or snaps.empty:
            load = pd.DataFrame(columns=["season", "week", "team", "inj_off", "inj_def"])
        else:
            load = injury_load(injuries, snaps, players)
        out = out.merge(injury_features(schedules, load), on=KEY, how="left")
    return out.drop_duplicates(KEY)
