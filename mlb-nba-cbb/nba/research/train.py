"""
train.py - retrains NBA Edge's margin model, and only changes how it's built
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
     results, and saves it to nba/model_weights.json only if it passes the
     checks in deploy_ok(). The saved model also carries a backtest on the
     latest finished season (fit only on the seasons before it) for the site.
  5. Appends what happened to nba/model_history.json, with the live picks'
     record, so there's a running log of how the model is doing.

The daily workflow runs this after nba/predict.py. It only retrains once a
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
import train_common  # noqa: E402  (the shared retrain engine)

WARMUP_UNTIL = "12-01"  # skip the first stored season's first weeks, before ratings have settled

DEFAULT_RECIPE = {"elo_k": M.ELO_K, "elo_carry": M.ELO_CARRY, "years": 3}  # the model before recipes existed
# On 2026-10-19 the bottom two (Elo K 20 and Elo only) made way for a
# "calib" version (win chances tuned to real win rates) and a "travel" one
# (time zones crossed since the last game).
# Ten versions (Anthony, 2026-10-17: ten per sport): the live recipe, the
# best Elo settings on three test windows (the latest games and the end of
# each of the two seasons before; lower K did best, so K 10 and 12 joined),
# and tryouts built on published methods (model.EXTRAS) - plain
# FiveThirtyEight-style Elo, Massey / SRS ratings and Pythagorean expectation.
# Massey plus Pythagorean together scored worse than Massey alone, so the
# fourth tryout is Massey on the best Elo setting instead.
_L = {"elo_k": 15, "elo_carry": 0.6, "years": 2}
RECIPES = [
    _L,
    {"elo_k": 15, "elo_carry": 0.75, "years": 2},
    {"elo_k": 10, "elo_carry": 0.6, "years": 2},
    {"elo_k": 12, "elo_carry": 0.6, "years": 2},
    {"elo_k": 10, "elo_carry": 0.6, "years": 2, "extras": ["massey"]},
    {**_L, "calib": True},
    {**_L, "extras": ["travel"]},
    # 2026-10-27 (Anthony: keep each version learning from this season): 3
    # years and Pythagorean, last on the holdout, made way for two whose fit
    # counts each older season half as much (season_decay).
    # 2026-11-05: Massey on K 15 and calib with older seasons at half, last on
    # the holdout, made way for two built on the new live travel version:
    # travel on the slower K 10 Elo, and travel with calibrated chances.
    {"elo_k": 10, "elo_carry": 0.6, "years": 2, "extras": ["travel"]},
    {**_L, "extras": ["travel"], "calib": True},
    {"elo_k": 10, "elo_carry": 0.6, "years": 2, "extras": ["massey"], "season_decay": 0.5},
]


class NBATrainer(train_common.Trainer):
    M = M
    store = store
    TITLE = "NBA model retrain"
    WATCH_KEY = "nba"
    RECIPES = RECIPES
    DEFAULT_RECIPE = DEFAULT_RECIPE
    HOLDOUT_GAMES = 250  # about three weeks of the season
    MIN_TRAIN_GAMES = 800
    MIN_NEW_GAMES = 50

    def walk(self, params):
        games, box = store.load_all()
        league = M.League(params)
        rows = []
        for g in games:
            feats = league.features_from_box(g, box.get(g["id"]))
            rows.append({"game": g, "f": feats,
                         "margin": g["home_pts"] - g["away_pts"]})
            league.update(g, box.get(g["id"]))
        return rows

    def usable(self, g, first):
        return g["season"] != first or g["date"][5:] >= WARMUP_UNTIL or g["date"][5:7] < "07"


if __name__ == "__main__":
    NBATrainer(HERE).main()
