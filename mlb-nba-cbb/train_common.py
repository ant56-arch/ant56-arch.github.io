"""
train_common.py - the retrain engine the team-sport models share (nba/, nhl/,
cbb/ and teams/ research/train.py). Each sport's train.py is a thin file: its
recipes and settings in a Trainer subclass, plus the few steps that really
differ (how the league is walked, the MLB model's logistic fit). Each run:

  1. Holds out the most recent HOLDOUT_GAMES games.
  2. Fits every candidate recipe in RECIPES on the games before the holdout,
     including the recipe the live model uses, and scores each on the holdout
     it never saw.
  3. Switches recipe only if the best candidate beats the current recipe's log
     loss by SWITCH_MARGIN. Otherwise the current recipe stays.
  4. Refits the chosen recipe on every game, so it learns from the newest
     results, and saves it to <sport>/model_weights.json only if it passes the
     checks in deploy_ok(). The saved model also carries a backtest on the
     latest finished season (fit only on the seasons before it) for the site.
  5. Appends what happened to <sport>/model_history.json, with the live picks'
     record, so there's a running log of how the model is doing.

It only retrains once a week, and only when at least MIN_NEW_GAMES have been
played since the live model's last training day. FORCE=1 skips both checks.
"""

import json
import math
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import model_watch  # noqa: E402  (the repo root's cold-stretch check)

ET = ZoneInfo("America/New_York")  # the site's days are US Eastern, like espn.ET


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def summary(lines):
    text = "\n".join(lines)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text + "\n")


def season_label(s):
    return f"{s - 1}-{str(s)[2:]}"


class Trainer:
    """A margin model (home margin by least squares, win chance from a normal
    curve), as NBA, NHL and CBB use. Subclasses set the settings below and
    walk(); the MLB team model overrides the fit for its logistic regression."""

    M = None  # the sport's model module
    store = None  # the sport's store module
    TITLE = ""  # summary heading, e.g. "NBA model retrain"
    WATCH_KEY = ""  # model_watch sport key
    RECIPES = []
    DEFAULT_RECIPE = {}
    BANDS = [(0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 1.01)]
    HOLDOUT_GAMES = 250
    MIN_TRAIN_GAMES = 800
    MIN_NEW_GAMES = 50
    RETRAIN_EVERY_DAYS = 7
    SWITCH_MARGIN = 0.002  # log loss a new recipe must win by
    SANITY_MARGIN = 0.01  # how much worse than the live model the chosen recipe (fit without the holdout) may score on it
    TOP_N = 3  # most confident picks per day
    TOP_KEY = "top3"  # "top" also records TOP_N
    ELO_ONLY = ["home_court", "elo"]  # the features of an "elo_only" recipe
    BASELINE_FEATURES = ["home_court", "elo"]  # the backtest's ratings-only baseline
    BASELINE_NAME = "elo_only"
    SIGMA_GRID = (4.0, 20.0, 0.05)  # calibrated_sigma's search, np.arange arguments
    SEASON_DONE = "07-01"  # a season is finished once today is past this day of its year
    NAME_WIDTH = 32  # recipe column width in the printed log
    LIVE_SKIP_VOID = False  # leave voided picks out of live_record

    def __init__(self, here):
        self.here = here
        self.out = os.path.join(here, "model_weights.json")
        self.history_path = os.path.join(here, "model_history.json")
        self.picks = os.path.join(here, "picks_history.json")
        self._walks = {}

    # --- the sport's own steps -------------------------------------------

    def league_params(self, recipe):
        return {"elo_k": recipe["elo_k"], "elo_carry": recipe["elo_carry"]}

    def walk(self, params):
        """One row per stored game ({"game", "f", "margin"}), in order."""
        raise NotImplementedError

    def usable(self, g, first):
        """Whether a game counts in training (the first stored season's early
        weeks don't, before ratings have settled)."""
        return True

    def recipe_name(self, r):
        return f"Elo K {r['elo_k']}, carry {r['elo_carry']}, {r['years']} years{self.extras_text(r)}"

    def extras_text(self, r):
        extras = (" (Elo only)" if r.get("elo_only") else "") + "".join(f" + {kind}" for kind in r.get("extras", []))
        extras += " + calib" if r.get("calib") else ""
        extras += f", older seasons x{r['season_decay']}" if r.get("season_decay") else ""
        return extras

    # --- rows and fits ----------------------------------------------------

    def recipe_features(self, recipe):
        base = self.ELO_ONLY if recipe.get("elo_only") else self.M.FEATURES
        return base + [c for kind in recipe.get("extras", []) for c in self.M.EXTRAS[kind]]

    def build_rows(self, params=None):
        """One row per stored game with that morning's features, walking the
        league with the given settings. Cached per setting."""
        key = json.dumps(params or {}, sort_keys=True)
        if key in self._walks:
            return self._walks[key]
        rows = self.walk(params)
        first = rows[0]["game"]["season"] if rows else None
        for r in rows:
            r["usable"] = self.usable(r["game"], first)
        self._walks[key] = rows
        return rows

    def won(self, r):
        return r["margin"] > 0

    def predict(self, weights, r):
        """(home win chance, predicted margin) for a row."""
        return self.M.win_prob(weights, r["f"])

    def calibrated_sigma(self, pred, won):
        """The spread that makes the margins' win chances best match how often
        the home team actually won (lowest log loss), for "calib" versions. The
        leftover spread of the margins, the default, can run timid."""
        best = None
        for s in np.arange(*self.SIGMA_GRID):
            p = np.clip(np.array([self.M.norm_cdf(m / s) for m in pred]), 1e-9, 1 - 1e-9)
            ll = -np.mean(np.where(won, np.log(p), np.log(1 - p)))
            if best is None or ll < best[0]:
                best = (ll, float(s))
        return best[1]

    def fit(self, rows, features=None, calib=False, season_decay=None):
        """season_decay (Anthony, 2026-10-26: keep learning from this season):
        each older season counts this much as much as the one after it, so 0.5
        makes this season count double last season."""
        features = features or self.M.FEATURES
        X = np.array([[r["f"][k] for k in features] for r in rows])
        y = np.array([r["margin"] for r in rows], dtype=float)
        if season_decay:
            latest = max(r["game"]["season"] for r in rows)
            sw = np.sqrt(np.array([season_decay ** (latest - r["game"]["season"]) for r in rows]))
            coef, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
        else:
            coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        sigma = float(np.std(y - X @ coef))
        if calib:
            sigma = self.calibrated_sigma(X @ coef, y > 0)
        return {"features": features, "coef": {k: round(float(c), 4) for k, c in zip(features, coef)},
                "sigma": round(sigma, 3)}

    def fit_recipe(self, rows, recipe):
        w = self.fit(rows, self.recipe_features(recipe), recipe.get("calib", False), recipe.get("season_decay"))
        w["league"] = self.league_params(recipe)
        return w

    # --- scoring ------------------------------------------------------------

    def evaluate(self, weights, rows):
        preds = []
        for r in rows:
            p_home, m = self.predict(weights, r)
            home_won = self.won(r)
            pick_home = p_home >= 0.5
            p = {"date": r["game"]["date"], "p_home": p_home, "conf": p_home if pick_home else 1 - p_home,
                 "correct": pick_home == home_won, "home_won": home_won}
            if m is not None:
                p["margin_err"] = abs(m - r["margin"])
            preds.append(p)
        n = len(preds)
        log_loss = -sum(math.log(max(1e-9, p["p_home"] if p["home_won"] else 1 - p["p_home"])) for p in preds) / n
        brier = sum((p["p_home"] - p["home_won"]) ** 2 for p in preds) / n

        bands = []
        for lo, hi in self.BANDS:
            b = [p for p in preds if lo <= p["conf"] < hi]
            if b:
                bands.append({"range": [lo, min(hi, 1.0)], "n": len(b),
                              "predicted": round(sum(p["conf"] for p in b) / len(b), 4),
                              "actual": round(sum(p["correct"] for p in b) / len(b), 4)})

        by_day = defaultdict(list)
        for p in preds:
            by_day[p["date"]].append(p)
        top = [p for day in by_day.values() for p in sorted(day, key=lambda p: -p["conf"])[:self.TOP_N]]

        by_month = defaultdict(list)
        for p in preds:
            by_month[p["date"][:7]].append(p)
        months = [{"month": mo, "n": len(ps), "correct": sum(p["correct"] for p in ps),
                   "predicted": round(sum(p["conf"] for p in ps) / len(ps), 4)} for mo, ps in sorted(by_month.items())]

        out = {
            "games": n,
            "correct": sum(p["correct"] for p in preds),
            "accuracy": round(sum(p["correct"] for p in preds) / n, 4),
            "predicted_accuracy": round(sum(p["conf"] for p in preds) / n, 4),
            "log_loss": round(log_loss, 4),
            "brier": round(brier, 4),
        }
        if preds and "margin_err" in preds[0]:
            out["margin_mae"] = round(sum(p["margin_err"] for p in preds) / n, 2)
        out["home_win_rate"] = round(sum(p["home_won"] for p in preds) / n, 4)
        top_stats = {"days": len(by_day), "picks": len(top), "correct": sum(p["correct"] for p in top),
                     "accuracy": round(sum(p["correct"] for p in top) / len(top), 4)}
        out[self.TOP_KEY] = {"n": self.TOP_N, **top_stats} if self.TOP_KEY == "top" else top_stats
        out["bands"] = bands
        out["months"] = months
        return out

    def raw_log_loss(self, weights, rows):
        """Unrounded log loss, for comparing recipes whose scores are close."""
        total = 0.0
        for r in rows:
            p, _ = self.predict(weights, r)
            total -= math.log(max(1e-9, p if self.won(r) else 1 - p))
        return total / len(rows)

    def baseline_log_loss(self, before, holdout):
        """Log loss on the holdout of always taking the home-team win rate of
        the games before it."""
        home_rate = np.mean([self.won(r) for r in before])
        return -np.mean([math.log(home_rate if self.won(r) else 1 - home_rate) for r in holdout])

    # --- training and the backtest ------------------------------------------

    def train_recipe(self, recipe, before_idx=None):
        """Fit a recipe on usable games before index before_idx (all games if
        None), within its window of years. None if there are too few games."""
        rows = self.build_rows(self.league_params(recipe))
        pool = rows if before_idx is None else rows[:before_idx]
        if not pool:
            return None
        last = date.fromisoformat(pool[-1]["game"]["date"])
        since = (last - timedelta(days=365 * recipe["years"])).isoformat()
        train = [r for r in pool if r["usable"] and r["game"]["date"] > since]
        if len(train) < self.MIN_TRAIN_GAMES:
            return None
        w = self.fit_recipe(train, recipe)
        w["recipe"] = recipe
        w["training_games"] = len(train)
        w["training_dates"] = [train[0]["game"]["date"], train[-1]["game"]["date"]]
        self.label_training(w, train)
        return w

    def label_training(self, w, train):
        w["trained_on"] = f"{season_label(train[0]['game']['season'])} to {season_label(train[-1]['game']['season'])}"

    def backtest_split(self, recipe):
        """(first training season, test season, training rows, test rows) for
        the backtest on the latest finished season, or None before there are
        two finished seasons."""
        rows = self.build_rows(self.league_params(recipe))
        seasons = sorted({r["game"]["season"] for r in rows})
        finished = [s for s in seasons
                    if s < seasons[-1] or datetime.now(ET).date().isoformat() >= f"{s}-{self.SEASON_DONE}"]
        if len(finished) < 2:
            return None
        test_season = finished[-1]
        first = max(seasons[0], test_season - recipe["years"])
        train = [r for r in rows if r["usable"] and first <= r["game"]["season"] < test_season]
        test = [r for r in rows if r["game"]["season"] == test_season]
        return first, test_season, train, test

    def season_backtest(self, recipe):
        """The site's backtest: fit on the seasons before the latest finished
        one, then pick every game of that season."""
        split = self.backtest_split(recipe)
        if split is None:
            return {}
        first, test_season, train, test = split
        w = self.fit_recipe(train, recipe)
        test_regular = [r for r in test if r["game"]["type"] == "regular"]
        post = [r for r in test if r["game"]["type"] != "regular"]
        bt = self.evaluate(w, test_regular)

        base_bt = self.evaluate(self.fit(train, self.BASELINE_FEATURES), test_regular)
        return {
            "backtest_trained_on": f"{season_label(first)} to {season_label(test_season - 1)}",
            "backtest_season": season_label(test_season),
            "backtest": bt,
            "backtest_postseason": self.evaluate(w, post) if post else None,
            "baselines": {f"{self.BASELINE_NAME}_accuracy": base_bt["accuracy"],
                          f"{self.BASELINE_NAME}_log_loss": base_bt["log_loss"],
                          "home_team_accuracy": bt["home_win_rate"]},
        }

    def live_record(self, days=14):
        picks = load(self.picks, {}).get("picks", [])
        since = (datetime.now(ET).date() - timedelta(days=days)).isoformat()
        g = [p for p in picks if p["date"] >= since and p.get("correct") is not None
             and not (self.LIVE_SKIP_VOID and p.get("void"))]
        if not g:
            return None
        return {"days": days, "picks": len(g), "accuracy": round(sum(p["correct"] for p in g) / len(g), 4),
                "predicted": round(sum(p["prob"] for p in g) / len(g) / 100, 4)}

    def finite(self, final):
        return all(math.isfinite(v) for v in list(final["coef"].values()) + [final["sigma"]]) and final["sigma"] > 0

    def deploy_ok(self, final, live_ll, chosen_ll, baseline_ll):
        """Sanity checks before the refit replaces the live model: finite
        numbers, it beats always taking the usual home-team rate on games it
        never saw, and on the recent games it isn't clearly worse than the model
        it replaces. Both scores are the chosen recipe fit without the holdout:
        the refit has seen the holdout, so its own score there would flatter it."""
        if not self.finite(final):
            return False, "the refit has non-finite coefficients"
        if chosen_ll >= baseline_ll:
            return False, "the chosen recipe didn't beat the home-team rate on held-out games"
        if live_ll is not None and chosen_ll > live_ll + self.SANITY_MARGIN:
            return False, "the chosen recipe scored worse than the live model on recent games"
        return True, ""

    # --- the run --------------------------------------------------------------

    def main(self):
        force = os.environ.get("FORCE", "").lower() in ("1", "true", "yes")
        slump = None if force else model_watch.early_retrain(self.WATCH_KEY)
        if slump:
            print(model_watch.slump_text(slump).capitalize() + ".")
        live = load(self.out, {})
        history = load(self.history_path, {"runs": []})
        current = live.get("recipe", self.DEFAULT_RECIPE)
        recipe_name = self.recipe_name

        rows = self.build_rows(self.league_params(current))
        if not rows:
            print("No stored games.")
            return
        latest = rows[-1]["game"]["date"]
        live_through = live.get("trained_through")
        new_games = sum(1 for r in rows if live_through is None or r["game"]["date"] > live_through)
        if not force and not slump:
            last_run = history["runs"][-1]["run_at"][:10] if history["runs"] else None
            if last_run and date.fromisoformat(last_run) > date.today() - timedelta(days=self.RETRAIN_EVERY_DAYS):
                print(f"Retrained {last_run}; next retrain once a week has passed.")
                return
            if new_games < self.MIN_NEW_GAMES:
                print(f"{new_games} games since the live model's last training day ({live_through}); "
                      f"waiting for {self.MIN_NEW_GAMES}.")
                return

        n_hold = self.HOLDOUT_GAMES
        cut = len(rows) - n_hold
        holdout_from = rows[cut]["game"]["date"]
        print(f"{len(rows)} games through {latest}; holdout: last {n_hold} games from {holdout_from}")

        def holdout(recipe):
            return self.build_rows(self.league_params(recipe))[cut:]

        baseline_ll = self.baseline_log_loss(rows[:cut], holdout(current))

        candidates = self.RECIPES + ([current] if current not in self.RECIPES else [])
        results = []
        for recipe in candidates:
            w = self.train_recipe(recipe, cut)
            if w is None:
                continue
            ll = self.raw_log_loss(w, holdout(recipe))
            results.append((recipe, w, ll))
            print(f"  {recipe_name(recipe):<{self.NAME_WIDTH}} log loss {ll:.4f}")
        if not results:
            print("No recipe had enough games to fit.")
            return

        cur = next((t for t in results if t[0] == current), None)
        best = min(results, key=lambda t: t[2])
        switched = cur is None or (best[0] != current and best[2] < cur[2] - self.SWITCH_MARGIN)
        chosen = best if switched else cur
        chosen_recipe = chosen[0]

        live_ll = (self.raw_log_loss(live, holdout(live.get("recipe", self.DEFAULT_RECIPE)))
                   if live.get("coef") else None)
        final = self.train_recipe(chosen_recipe)
        ok, why = self.deploy_ok(final, live_ll, chosen[2], baseline_ll)

        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if ok:
            final.update(self.season_backtest(chosen_recipe))
            final.update({
                "trained_at": now,
                "trained_through": latest,
                "recent_holdout": {"from": holdout_from, "games": n_hold,
                                   **{k: v for k, v in self.evaluate(chosen[1], holdout(chosen_recipe)).items()
                                      if k not in ("months", "bands")}},
            })
            with open(self.out, "w") as f:
                json.dump(final, f, indent=1)

        history["runs"].append({
            "run_at": now,
            "data_through": latest,
            "holdout": {"from": holdout_from, "games": n_hold, "home_rate_log_loss": round(baseline_ll, 4)},
            "live_model": {"trained_at": live.get("trained_at"), "recipe": live.get("recipe", self.DEFAULT_RECIPE),
                           "holdout_log_loss": round(live_ll, 4) if live_ll is not None else None},
            "current_recipe_log_loss": round(cur[2], 4) if cur else None,
            "best_recipe": {"recipe": best[0], "log_loss": round(best[2], 4)},
            "candidates": [{"recipe": r, "log_loss": round(ll, 4), "accuracy": self.evaluate(w, holdout(r))["accuracy"]}
                           for r, w, ll in results],
            "switched_recipe": bool(switched and ok),
            "deployed": ok,
            "reason": "; ".join(x for x in (
                model_watch.slump_text(slump) if slump else "",
                why or ("new recipe beat the current one on held-out games" if switched
                        else "kept the recipe, refit with the newest games")) if x),
            "trigger": "cold stretch" if slump else ("manual" if force else "weekly"),
            "live_picks_last_14_days": self.live_record(),
            "weights_before": live.get("coef"),
            "weights_after": (final if ok else live).get("coef"),
        })
        with open(self.history_path, "w") as f:
            json.dump(history, f, indent=1)

        summary([f"### {self.TITLE} ({latest})",
                 f"- Holdout: last {n_hold} games, from {holdout_from}",
                 f"- Current recipe ({recipe_name(current)}): "
                 + (f"log loss {cur[2]:.4f}" if cur else "couldn't be fit"),
                 f"- Best candidate ({recipe_name(best[0])}): log loss {best[2]:.4f}",
                 f"- Recipe: {'switched to ' + recipe_name(chosen_recipe) if switched else 'unchanged'}",
                 f"- Deployed: {'yes, refit through ' + latest if ok else 'no - ' + why}"])
