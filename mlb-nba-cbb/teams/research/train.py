"""
train.py - retrains the MLB team model, and only changes how it's built when
the change is proven on recent games.

Walks every stored game in order (model.League), so each game's features are
what was known that morning, and fits the home team's win chance by logistic
regression. Each run:

  1. Holds out the most recent HOLDOUT_GAMES games.
  2. Fits every candidate recipe in RECIPES - how fast Elo reacts (elo_k), how
     much of it carries over the winter (elo_carry), how much a starter's line
     is shrunk toward average (sp_shrink), and how many years of games to
     learn from - on the games before the holdout, including the recipe the
     live model uses, and scores each on the holdout it never saw.
  3. Switches recipe only if the best candidate beats the current recipe's log
     loss by SWITCH_MARGIN. Otherwise the current recipe stays.
  4. Refits the chosen recipe on every game, so it learns from the newest
     results, and saves it to teams/model_weights.json only if it passes the
     checks in deploy_ok(). The saved model also carries a backtest on the
     latest finished season (fit only on the seasons before it) for the site.
  5. Appends what happened to teams/model_history.json, with the live picks'
     record, so there's a running log of how the model is doing.

The daily workflow runs this after teams/predict.py. It only retrains once a
week, and only when at least MIN_NEW_GAMES have been played since the live
model's last training day, so it does nothing in the offseason. FORCE=1 skips
both checks (the research workflow sets it).
"""

import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.append(os.path.dirname(HERE))
import model as M  # noqa: E402
import store  # noqa: E402
import train_common  # noqa: E402  (the shared retrain engine)

WARMUP_UNTIL = "07-01"  # skip the first stored season's first half: no pitcher history yet, ratings unsettled
L2 = 1.0  # ridge penalty on every coefficient but home field

DEFAULT_RECIPE = {"elo_k": M.ELO_K, "elo_carry": M.ELO_CARRY, "sp_shrink": M.SP_SHRINK_IP, "years": 2}
# Ten versions (Anthony, 2026-10-17: ten per sport): the live recipe, the
# best settings on three test windows (the latest games and the end of each
# of the two regular seasons before; a slower Elo, K 2, and more starter
# shrinkage did best, so they joined), and tryouts built on published methods
# (model.EXTRAS) - plain FiveThirtyEight-style Elo, Massey / SRS ratings and
# Pythagorean expectation. Massey plus Pythagorean together added nothing over
# either alone, so the fourth tryout is Massey on the best Elo setting.
_L = {"elo_k": 3, "elo_carry": 0.67, "sp_shrink": 60, "years": 2}
_SLOW = {"elo_k": 2, "elo_carry": 0.5, "sp_shrink": 80, "years": 3}
RECIPES = [
    _L,
    {"elo_k": 3, "elo_carry": 0.5, "sp_shrink": 60, "years": 3},
    {"elo_k": 3, "elo_carry": 0.67, "sp_shrink": 60, "years": 3},
    {"elo_k": 2, "elo_carry": 0.5, "sp_shrink": 60, "years": 3},
    _SLOW,
    {**_SLOW, "elo_carry": 0.67},
    {**_L, "extras": ["massey"]},
    {**_SLOW, "extras": ["massey"]},
    # 2026-10-27 (Anthony: keep each version learning from this season): Elo
    # only and Pythagorean, last on the holdout, made way for two whose fit
    # counts each older season half as much (season_decay).
    {**_L, "season_decay": 0.5},
    {**_SLOW, "season_decay": 0.5},
]


def home_rate_log_loss(rate, rows):
    return -sum(math.log(rate if r["home_won"] else 1 - rate) for r in rows) / len(rows)


class TeamsTrainer(train_common.Trainer):
    M = M
    store = store
    TITLE = "MLB team model retrain"
    WATCH_KEY = "mlb_games"
    RECIPES = RECIPES
    DEFAULT_RECIPE = DEFAULT_RECIPE
    BANDS = [(0.5, 0.55), (0.55, 0.6), (0.6, 0.65), (0.65, 1.01)]
    HOLDOUT_GAMES = 300  # about two weeks of the regular season
    MIN_TRAIN_GAMES = 1500
    MIN_NEW_GAMES = 60
    SWITCH_MARGIN = 0.001  # log loss a new recipe must win by
    SANITY_MARGIN = 0.005  # how much worse than the live model the chosen recipe (fit without the holdout) may score on it
    ELO_ONLY = BASELINE_FEATURES = ["home_field", "elo"]
    NAME_WIDTH = 50
    LIVE_SKIP_VOID = True
    SEASON_DONE = "10-01"  # a season counts once its regular season is over

    def league_params(self, recipe):
        return {"elo_k": recipe["elo_k"], "elo_carry": recipe["elo_carry"], "sp_shrink": recipe["sp_shrink"]}

    def walk(self, params):
        league = M.League(params)
        rows = []
        for g in store.load_all():
            feats = league.features_for_past(g)
            rows.append({"game": g, "f": feats,
                         "home_won": g["home_runs"] > g["away_runs"]})
            league.update(g)
        return rows

    def usable(self, g, first):
        return g["season"] != first or g["date"][5:] >= WARMUP_UNTIL

    def won(self, r):
        return r["home_won"]

    def predict(self, weights, r):
        return M.win_prob(weights, r["f"]), None

    def fit(self, rows, features=None, season_decay=None):
        """Ridge-penalized logistic regression by Newton's method. season_decay
        (Anthony, 2026-10-26: keep learning from this season): each older season
        counts this much as much as the one after it."""
        features = features or self.M.FEATURES
        X = np.array([[r["f"][k] for k in features] for r in rows])
        y = np.array([r["home_won"] for r in rows], dtype=float)
        sw = np.ones(len(rows))
        if season_decay:
            latest = max(r["game"]["season"] for r in rows)
            sw = np.array([season_decay ** (latest - r["game"]["season"]) for r in rows])
            sw *= len(rows) / sw.sum()
        pen = np.full(X.shape[1], L2)
        pen[features.index("home_field")] = 0.0
        w = np.zeros(X.shape[1])
        for _ in range(50):
            p = 1 / (1 + np.exp(-(X @ w)))
            grad = X.T @ (sw * (p - y)) + pen * w
            hess = (X * (sw * p * (1 - p))[:, None]).T @ X + np.diag(pen)
            step = np.linalg.solve(hess, grad)
            w -= step
            if np.max(np.abs(step)) < 1e-8:
                break
        return {"features": features, "coef": {k: round(float(c), 5) for k, c in zip(features, w)}}

    def fit_recipe(self, rows, recipe):
        w = self.fit(rows, self.recipe_features(recipe), recipe.get("season_decay"))
        w["league"] = self.league_params(recipe)
        return w

    def baseline_log_loss(self, before, holdout):
        home_rate = float(np.mean([r["home_won"] for r in before]))
        return home_rate_log_loss(home_rate, holdout)

    def label_training(self, w, train):
        pass

    def finite(self, final):
        return all(math.isfinite(v) for v in final["coef"].values())

    def season_backtest(self, recipe):
        """The site's backtest: fit on the seasons before the latest finished
        one, then pick every game of that season. A season counts once its
        regular season is over (October), so the backtest is always the latest
        season; its postseason fills in as played."""
        split = self.backtest_split(recipe)
        if split is None:
            return {}
        first, test_season, train, test = split
        if len(train) < self.MIN_TRAIN_GAMES:
            return {}
        w = self.fit(train, self.recipe_features(recipe), recipe.get("season_decay"))
        test_regular = [r for r in test if r["game"]["type"] == "regular"]
        post = [r for r in test if r["game"]["type"] != "regular"]
        bt = self.evaluate(w, test_regular)
        home_rate = float(np.mean([r["home_won"] for r in train]))

        elo_bt = self.evaluate(self.fit(train, ["home_field", "elo"]), test_regular)
        return {
            "trained_on": f"{first} to {test_season - 1}",
            "backtest_season": str(test_season),
            "backtest": bt,
            "backtest_postseason": self.evaluate(w, post) if post else None,
            "baselines": {"elo_only_accuracy": elo_bt["accuracy"], "elo_only_log_loss": elo_bt["log_loss"],
                          "home_team_accuracy": bt["home_win_rate"],
                          "home_rate_log_loss": round(home_rate_log_loss(home_rate, test_regular), 4)},
        }

    def recipe_name(self, r):
        extras = (" (Elo only)" if r.get("elo_only") else "") + "".join(f" + {kind}" for kind in r.get("extras", []))
        extras += f", older seasons x{r['season_decay']}" if r.get("season_decay") else ""
        return f"Elo K {r['elo_k']}, carry {r['elo_carry']}, SP shrink {r['sp_shrink']}, {r['years']} years{extras}"


if __name__ == "__main__":
    TeamsTrainer(HERE).main()
