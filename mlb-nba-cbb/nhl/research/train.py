"""
train.py - retrains NHL Edge's goal-margin model, and only changes how it's built
when the change is proven on recent games.

Walks every stored game in order (model.League), so each game's features are
what was known that morning, and fits the home margin by least squares. Each
run:

  1. Holds out the most recent HOLDOUT_GAMES games.
  2. Fits every candidate recipe in RECIPES - how fast Elo reacts (elo_k), how
     much of it carries over the summer (elo_carry), and how many years of
     games to learn from - on the games before the holdout, including the
     recipe the live model uses, and scores each on the holdout it never saw.
  3. Switches recipe only if the best candidate beats the current recipe's log
     loss by SWITCH_MARGIN. Otherwise the current recipe stays.
  4. Refits the chosen recipe on every game, so it learns from the newest
     results, and saves it to nhl/model_weights.json only if it passes the
     checks in deploy_ok(). The saved model also carries a backtest on the
     latest finished season (fit only on the seasons before it) for the site.
  5. Appends what happened to nhl/model_history.json, with the live picks'
     record, so there's a running log of how the model is doing.

The daily workflow runs this after nhl/predict.py. It only retrains once a
week, and only when at least MIN_NEW_GAMES have been played since the live
model's last training day, so it does nothing in the offseason. FORCE=1 skips
both checks (the research workflow sets it).
"""

import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.append(os.path.dirname(HERE))
import model as M  # noqa: E402
import store  # noqa: E402
import xg  # noqa: E402
import train_common  # noqa: E402  (the shared retrain engine)

WARMUP_UNTIL = "12-01"  # skip the first stored season's first weeks, before ratings have settled

DEFAULT_RECIPE = {"elo_k": M.ELO_K, "elo_carry": M.ELO_CARRY, "years": 3}
# The two Elo K 12 / carry 0.5 tryouts were dropped on 2026-10-17: they
# finished last at every retrain. Their places went to two tryouts with new
# inputs from box scores (model.EXTRAS): shot share, and that plus goalies.
# The Elo K 5 and K 12 / carry 0.85 tryouts were dropped on 2026-10-18 for
# two "calib" versions, whose win chances are stretched to match how often
# teams actually won (calibrated_sigma), after live picks ran too timid.
# Ten versions (Anthony, 2026-10-17: ten per sport): the live recipe, the
# best plain-Elo settings, and tryouts built on published methods - plain
# FiveThirtyEight-style Elo, Massey / SRS ratings and Pythagorean expectation.
_L = {"elo_k": 8, "elo_carry": 0.7, "years": 3}
# 2026-10-26 (Anthony: use the best free data): the plain version and plain
# Elo-only, last on the holdout, made way for two with MoneyPuck expected
# goals (xg.py): one on the live version, one on the full model.
RECIPES = [
    {**_L, "extras": ["shots"]},
    {**_L, "extras": ["xg", "shots", "goalies"]},
    {**_L, "elo_only": True, "extras": ["shots", "goalies"], "calib": True},
    {**_L, "elo_only": True, "extras": ["xg", "shots", "goalies"], "calib": True},
    {**_L, "elo_only": True, "extras": ["shots", "goalies"]},
    {**_L, "extras": ["shots", "goalies", "pyth"]},
    # 2026-10-27 (Anthony: keep each version learning from this season): the
    # two Massey versions, last on the holdout, made way for two whose fit
    # counts each older season half as much (season_decay).
    {**_L, "elo_only": True, "extras": ["shots", "goalies"], "calib": True, "season_decay": 0.5},
    {**_L, "elo_only": True, "extras": ["xg", "shots", "goalies"], "calib": True, "season_decay": 0.5},
    # 2026-11-05: the full model with shots and goalies, with and without
    # calib, last on the holdout, made way for the live version with a slower
    # (K 6) and a faster (K 10) Elo.
    {**_L, "elo_k": 6, "elo_only": True, "extras": ["shots", "goalies"], "calib": True},
    {**_L, "elo_k": 10, "elo_only": True, "extras": ["shots", "goalies"], "calib": True},
]


class NHLTrainer(train_common.Trainer):
    M = M
    store = store
    TITLE = "NHL model retrain"
    WATCH_KEY = "nhl"
    RECIPES = RECIPES
    DEFAULT_RECIPE = DEFAULT_RECIPE
    HOLDOUT_GAMES = 250  # about three weeks of the season
    MIN_TRAIN_GAMES = 800
    MIN_NEW_GAMES = 50
    ELO_ONLY = BASELINE_FEATURES = ["home_ice", "elo"]
    # calibrated_sigma's search: the leftover spread of the margins runs too
    # timid (live picks rated 56% won 63%).
    SIGMA_GRID = (0.8, 4.0, 0.01)

    def walk(self, params):
        games, box = store.load_all()
        xg.merge_into_box(games, box)
        league = M.League(params)
        rows = []
        for g in games:
            feats = league.features(g)
            rows.append({"game": g, "f": feats, "margin": g["home_pts"] - g["away_pts"]})
            league.update(g, box.get(g["id"]))
        return rows

    def usable(self, g, first):
        return g["season"] != first or g["date"][5:] >= WARMUP_UNTIL or g["date"][5:7] < "07"


if __name__ == "__main__":
    NHLTrainer(HERE).main()
