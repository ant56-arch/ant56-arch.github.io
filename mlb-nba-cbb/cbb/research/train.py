"""
train.py - retrains CBB Edge's margin model, and only changes how it's built
when the change is proven on recent games.

Walks every stored game in order (model.League), so each game's features are
what was known that morning, and fits the home margin by least squares. Each
run:

  1. Holds out the most recent HOLDOUT_GAMES games.
  2. Fits every candidate recipe in RECIPES - how much more recent games count
     in the team ratings (half_life, in days; none = every game the same), how
     much of last season's rating a team starts with (carry), and how many
     years of games to learn from - on the games before the holdout, including
     the recipe the live model uses, and scores each on the holdout it never saw.
  3. Switches recipe only if the best candidate beats the current recipe's log
     loss by SWITCH_MARGIN. Otherwise the current recipe stays.
  4. Refits the chosen recipe on every game, so it learns from the newest
     results, and saves it to cbb/model_weights.json only if it passes the
     checks in deploy_ok(). The saved model also carries a backtest on the
     latest finished season (fit only on the seasons before it) for the site.
  5. Appends what happened to cbb/model_history.json, with the live picks'
     record, so there's a running log of how the model is doing.

The daily workflow runs this after cbb/predict.py. It only retrains once a
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

DEFAULT_RECIPE = {"half_life": M.DEFAULT_PARAMS["half_life"], "carry": M.DEFAULT_PARAMS["carry"], "years": 3}
# On 2026-10-19 the bottom two (Elo only and Massey) made way for two
# "calib" versions, with win chances tuned to real win rates.
# Ten versions (Anthony, 2026-10-17: ten per sport): the live recipe, the
# best rating settings on three test windows (the latest games and the end of
# each of the two regular seasons before), and tryouts built on published
# methods (model.EXTRAS) - plain FiveThirtyEight-style Elo, Massey / SRS
# ratings and Pythagorean expectation. Massey plus Pythagorean together scored
# worse than Pythagorean alone, so the fourth tryout is Pythagorean on the
# best rating setting instead.
_L = {"half_life": 60, "carry": 0.6, "years": 3}
_BEST = {"half_life": None, "carry": 0.4, "years": 3}
RECIPES = [
    _BEST,
    {"half_life": None, "carry": 0.4, "years": 2},
    {"half_life": None, "carry": 0.6, "years": 3},
    {**_BEST, "extras": ["pyth"]},
    {**_L, "calib": True},
    {**_BEST, "calib": True},
    # 2026-10-27 (Anthony: keep each version learning from this season): the
    # two half-life 60 versions last on the holdout made way for two whose fit
    # counts each older season half as much (season_decay).
    {**_L, "season_decay": 0.5},
    {**_BEST, "season_decay": 0.5},
    # 2026-11-11 (weekly swap): half-life 60 with and without Pythagorean, last
    # on the holdout, made way for two built on the new live version (no
    # fade, carry 0.6): on 2 years of games, and with carry 0.75.
    {"half_life": None, "carry": 0.6, "years": 2},
    {"half_life": None, "carry": 0.75, "years": 3},
]


class CBBTrainer(train_common.Trainer):
    M = M
    store = store
    TITLE = "CBB model retrain"
    WATCH_KEY = "cbb"
    RECIPES = RECIPES
    DEFAULT_RECIPE = DEFAULT_RECIPE
    HOLDOUT_GAMES = 600  # about a week and a half of the season
    MIN_TRAIN_GAMES = 3000
    MIN_NEW_GAMES = 300
    TOP_N = 5  # most confident picks per day
    TOP_KEY = "top"
    # home court and the adjusted efficiency margin, like KenPom's own predictions
    BASELINE_FEATURES = ["home_court", "em"]
    BASELINE_NAME = "ratings_only"
    SEASON_DONE = "05-01"

    def league_params(self, recipe):
        return {"half_life": recipe["half_life"], "carry": recipe["carry"]}

    def walk(self, params):
        games, box = store.load_all()
        league = M.League(params, M.division_one(games))
        rows = []
        for g in games:
            if g["home_pts"] == g["away_pts"]:
                continue
            if league.di_game(g):  # picks are only made between Division I teams
                feats = league.features(g)
                rows.append({"game": g, "f": feats,
                             "margin": g["home_pts"] - g["away_pts"]})
            league.update(g, box.get(g["id"]))
        return rows

    def usable(self, g, first):
        # The first stored season has no last-season ratings to start from, so
        # its November and December games are left out of training.
        return g["season"] != first or g["date"][5:7] < "07"

    def recipe_name(self, r):
        hl = f"half-life {r['half_life']} days" if r["half_life"] else "no recency weighting"
        return f"{hl}, carry {r['carry']}, {r['years']} years{self.extras_text(r)}"


if __name__ == "__main__":
    CBBTrainer(HERE).main()
