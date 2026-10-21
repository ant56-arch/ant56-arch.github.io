"""
team_pages.py - builds the pages for a team-picks sport (NBA, NHL and CBB Edge)
into dist/<slug>/.

Run after the MLB build (build_site.py wipes dist/). Reads the sport's
picks_history.json, model_weights.json and model_history.json and writes:
  index.html    - today's games with a pick, win chance and moneyline pick for
                  each, and the record (game picks and moneyline)
  history.html  - any past day's picks and how they did
  accuracy.html - predicted vs. actual over the season, and last season's backtest
  model.html    - how the model retrains itself
  terms.html, privacy.html
  summary.json  - today's most confident picks, read by the home page
plus a page per game.

TeamSite holds everything the three sports share. Each sport's build_pages.py
subclasses it with its own names, wording and model factors, and overrides the
few parts that differ (game notes, CBB's Ratings tab). Shares MLB Edge's
stylesheet, scripts and page helpers; nba.js adds the History day picker.
"""

import json
import os
import shutil
from collections import defaultdict
from datetime import date, datetime
from html import escape

from build_site import (team_accuracy_spec, backtest_months, asset_version, write_assets, bb_board, slim_footer, bb_game,
                        bb_game_pages, bb_home_parts, ET, NOW, card, ml_day, ml_history, pct, record_band_html,
                        season_record, daily_results, ml_streak, script_json)
import extras
import games as games_mod
import accuracy_page
import model_page
import chrome
import moneyline

ROOT = os.path.dirname(os.path.abspath(__file__))
HOME_URL = "https://ant56-arch.github.io/"

def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def day_label(iso):
    return date.fromisoformat(iso).strftime("%a, %b %-d")


def tip_time(p):
    return datetime.fromisoformat(p["start"]).astimezone(ET).strftime("%-I:%M %p")


def graded(picks):
    return [p for p in picks if p.get("correct") is not None and not p.get("void")]


def season_of(iso):
    """Seasons that cross New Year are named for both years: 2026-10-21 and
    2027-04-01 are both in 2026-27."""
    d = date.fromisoformat(iso)
    start = d.year if d.month >= 7 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def wl(picks):
    w = sum(p["correct"] for p in picks)
    return w, len(picks) - w


class TeamSite:
    """One sport's site. The defaults are NBA Edge's."""
    sport = "NBA"
    slug = "nba"
    tagline = "Who wins every NBA game tonight and how likely it is, from a model graded against every final score."
    top_n = 3
    strong = 70  # win chance, in percent, that counts as a strong pick
    favicon_letter = "M8 23V9h3.3l6.9 8.6V9H24v14h-3.3l-6.9-8.6V23z"
    tabs = [("index.html", "Home"), ("history.html", "History"), ("accuracy.html", "Accuracy"), ("model.html", "Model")]
    sources = "Scores, box scores, injury reports and Vegas odds via ESPN."
    has_games_feed = True  # ESPN scoreboard for the board, games.json and the Schedule redirect
    has_schedule = True    # a tab on the home site's Schedule page
    board_note = ("The percentage by each team is its chance to win, and the odds are our pick's moneyline. Value means "
                  "our chance is at least 6% higher than Vegas's. Tap a game for injuries and rest.")
    no_games = "No NBA games today."
    preseason = "The season tips off in late October"
    summary_empty = "No NBA picks yet. They start on opening night in late October."
    unit, unit_short = "points", "pts"
    postseason = "the play-in and playoffs"
    retrain_after = 50  # new games before the weekly check retrains
    looks_at = ", including injuries on the day"
    factor_labels = {
        "home_court": ("Home court", "points for the home team"),
        "elo": ("Team strength gap", "points per 100 rating points"),
        "net": ("Season point differential gap", "points per point of differential"),
        "recent": ("Last 10 games form gap", "points per point of differential"),
        "rest": ("Extra rest", "points per extra day off vs. the opponent"),
        "b2b_home": ("Home team on a back-to-back", ""),
        "b2b_away": ("Away team on a back-to-back", ""),
        "missing_home": ("Home team's missing players", "per 10 points of the missing players' Game Score"),
        "missing_away": ("Away team's missing players", "per 10 points of the missing players' Game Score"),
        "travel": ("Time zones traveled", "points per time zone the away team moved"),
        "massey": ("Schedule-adjusted margin gap", "points per point of opponent-adjusted margin"),
        "pyth": ("Expected record gap", "from points scored and allowed"),
    }

    def __init__(self):
        self.here = os.path.join(ROOT, self.slug)
        self.out_dir = os.path.join(ROOT, "dist", self.slug)
        self.favicon = ('data:image/svg+xml,'
                        '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
                        '%3Crect width=%2232%22 height=%2232%22 fill=%22%23121314%22/%3E'
                        f'%3Cpath d=%22{self.favicon_letter}%22 fill=%22%23e5793b%22/%3E'
                        '%3C/svg%3E')

    # ── Sport-specific pieces ────────────────────────────────────────────────
    def logo_url(self, p, side):
        return f"https://a.espncdn.com/i/teamlogos/{self.slug}/500/scoreboard/{p[side].lower()}.png"

    team_label = None  # bb_game's default name for each team

    def game_notes(self, p):
        notes = []
        for side in ("away", "home"):
            if p.get(f"{side}_out"):
                notes.append(f"{p[side]} without {', '.join(p[f'{side}_out'])}")
        rest = p.get("rest", {})
        b2b = [p[s] for s in ("away", "home") if rest.get(s) == 0]
        if b2b:
            notes.append(f"{' and '.join(b2b)} on a back-to-back")
        return "; ".join(notes)

    def game_facts(self, p):
        notes = self.game_notes(p)
        return [("Projected", f"{escape(p['pick'])} by {p['margin']:.1f}", "points, from the model's ratings"),
                ("Injuries and rest", escape(notes) or '<span class="faint">Nothing notable</span>', "")]

    def recipe_setup(self, recipe):
        k, carry, years = recipe.get("elo_k", 20), recipe.get("elo_carry", 0.75), recipe.get("years", 3)
        speed = "steady" if k <= 15 else "medium" if k <= 20 else "fast"
        return [
            ("Learns from:", f"the last {years} seasons of games"),
            ("Team ratings:", f"{speed} - each result moves a team's strength rating by up to {k} points"),
            ("Over the summer:", f"keeps {carry:.0%} of each team's rating; the rest resets toward average"),
        ]

    def backtest_top(self, bt):
        """The backtest's record for the day's top picks, and how many that is."""
        return bt["top3"], self.top_n

    def index_extra(self):
        """Anything the Home tab adds under the games."""
        return ""

    def extra_pages(self):
        """Pages beyond the shared ones, as {file name: html}."""
        return {}

    # ── Page chrome ──────────────────────────────────────────────────────────
    def page_shell(self, title, active, body_html, charts=False):
        chart_js = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>' if charts else ""
        ver = asset_version()
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | {self.sport} Edge</title>
<meta name="description" content="{self.tagline}">
<link rel="icon" href="{self.favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v={ver}">
{chart_js}
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
{chrome.page_top(self.sport, title, self.tabs, active, NOW.strftime("%b %-d, %-I:%M %p") + " ET", self.tagline)}
  <main id="main-content">
  {body_html}
  </main>
  {slim_footer(f"{self.sport} Edge", self.sources)}
</div>
<script src="site.js?v={ver}"></script>
<script src="nba.js?v={ver}"></script>
</body>
</html>"""

    # ── Home ─────────────────────────────────────────────────────────────────
    # The Home tab leads with the all-time record (every live pick since
    # opening night, never reset, never the backtest), then the day's surest
    # picks and a short row per game whose details open on tap.
    def record_band(self):
        g = graded(self.history["picks"])
        eyebrow = f"{self.sport} Edge &middot; our picks to win"
        if not g:
            return record_band_html(eyebrow, wait="Starts on opening night")
        w, l = wl(g)
        d = date.fromisoformat(min(p["date"] for p in g))
        return record_band_html(eyebrow, f"{w}-{l}", pct(w / len(g), 1),
                                f"Since {d:%b} {d.day}, {d.year}. Every pick graded against the final score, and it "
                                "never resets.")

    def build_index(self):
        picks = self.history["picks"]
        today = NOW.date().isoformat()
        body = self.record_band()
        if picks:
            latest = max(p["date"] for p in picks)
            heading = "Today's Games" if latest == today else "Latest Games"
            day = [p for p in picks if p["date"] == latest]
            if latest != today:
                body += card("Today's Games", "", f'<div class="empty-state">{self.no_games} Picks resume on '
                             'the next game day.</div>')
            body += extras.board_section(f"{heading}: {day_label(latest)}", self.board_note,
                                         bb_board(day, {g["id"]: g for g in self.all_games()}, self.espn_games,
                                                  self.sport))
        else:
            body += card("Today's Games", "", f'<div class="empty-state">{self.preseason}, and '
                         'picks start on opening night. Until then, the <a href="accuracy.html">Accuracy tab</a> shows '
                         'how the model did on every game of last season.</div>')
        return self.page_shell("Home", "index.html", body + self.index_extra())

    def backtest_stats(self):
        bt = self.model.get("backtest") or {}
        if not bt:
            return []
        strong = [b for b in bt["bands"] if b["range"][0] >= self.strong / 100]
        top, n_top = self.backtest_top(bt)
        stats = [(f"{bt['correct']}-{bt['games'] - bt['correct']}", f"{self.model['backtest_season']} backtest",
                  f"{pct(bt['accuracy'], 1)} of every game"),
                 (pct(top["accuracy"], 1), f"Top {n_top} picks each day", f"{top['correct']}-{top['picks'] - top['correct']}")]
        if strong:
            n = sum(b["n"] for b in strong)
            right = sum(round(b["actual"] * b["n"]) for b in strong)
            stats.append((pct(right / n, 1), f"Picks at {self.strong}%+", f"{right}-{n - right}"))
        return stats

    # ── History ──────────────────────────────────────────────────────────────
    def build_history(self):
        by_day = defaultdict(list)
        for p in self.history["picks"]:
            by_day[p["date"]].append(p)
        if not by_day:
            body = card("History", "Every day's picks", '<div class="empty-state">No picks yet. The first ones go up '
                        'on opening night.</div>')
            return self.page_shell("History", "history.html", body)
        days = {}
        for d, picks in by_day.items():
            g = graded(picks)
            w, l = wl(g)
            days[d] = {
                "label": day_label(d) + f", {d[:4]}",
                "summary": {"wins": w, "losses": l, "voided": sum(1 for p in picks if p.get("void")), "ml": ml_day(picks)},
                "games": [{
                    "matchup": f"{p['away']} {'vs' if p.get('neutral') else '@'} {p['home']}", "pick": p["pick"],
                    "prob": p["prob"], "correct": p.get("correct"), "void": bool(p.get("void")),
                    "ml": ml_history(p),
                    "score": (f"{p['away']} {p['away_pts']}, {p['home']} {p['home_pts']}"
                              if p.get("home_pts") is not None else ""),
                } for p in sorted(picks, key=lambda p: -p["prob"])],
            }
        data = {"order": sorted(days, reverse=True), "days": days}
        body = card("History", "Every day's picks and how they did. Choose a day.",
                    '<select id="day-select" class="week-picker" aria-label="Day"></select>'
                    '<div id="day-content" style="margin-top:16px;"></div>'
                    f'<script>const NBA_HISTORY = {script_json(data)};</script>')
        return self.page_shell("History", "history.html", body)

    # ── Accuracy ─────────────────────────────────────────────────────────────
    def build_accuracy(self):
        """The Accuracy tab, laid out like every sport's (accuracy_page)."""
        model = self.model
        bt = model.get("backtest")
        backtest = None
        if bt:
            note = (f"Fit on {model['trained_on'].split(' to ')[0]} through the season before {model['backtest_season']}, "
                    f"then tested on all {bt['games']} regular-season games of {model['backtest_season']}. It picked "
                    f"{pct(bt['accuracy'], 1)} of them right (it expected {pct(bt['predicted_accuracy'], 1)}), and its "
                    f"projected margins were off by {bt['margin_mae']:.1f} {self.unit} on average.")
            post = model.get("backtest_postseason")
            if post:
                note += f" In {self.postseason} it went {post['correct']}-{post['games'] - post['correct']}."
            backtest = {"subtitle": f"Every regular-season game of {model['backtest_season']}, picked by a model that "
                                    "never saw that season",
                        "tiles": self.backtest_stats(), "groups": backtest_months(bt),
                        "rows": accuracy_page.band_rows(bt["bands"]), "note": note}
        body = accuracy_page.render(team_accuracy_spec(self.history["picks"], season_of, self.strong, backtest=backtest))
        return self.page_shell("Accuracy", "accuracy.html", body, charts=accuracy_page.has_charts(body))

    # ── Schedule tab and scoreboard strip ────────────────────────────────────
    def attach_picks(self, slate):
        """Each game gets the model's pick and win chance, if it made one."""
        picks = {(p["date"], p["away"], p["home"]): p for p in self.history["picks"]}
        for g in slate["games"]:
            day = games_mod.start_et(g).date().isoformat()
            p = picks.get((day, g["away"]["abbr"], g["home"]["abbr"]))
            if p:
                g["pick"] = {"text": f"{p['pick']} {p['prob']:.0f}%",
                             "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"])}
        return slate

    # ── Model tab ────────────────────────────────────────────────────────────
    def build_model(self, runs):
        model = self.model
        runs = list(reversed(runs))

        def skill(ll, baseline):
            return None if ll is None or not baseline else 1 - ll / baseline

        rows = []
        for r in runs:
            label, tone = model_page.decision(r)
            base = r["holdout"].get("home_rate_log_loss")
            chosen_ll = r["best_recipe"]["log_loss"] if r.get("switched_recipe") else r.get("current_recipe_log_loss")
            rows.append({
                "date": model_page.short_date(r["run_at"]), "data_through": model_page.short_date(r.get("data_through")),
                "tested": len(r.get("candidates", [])), "decision": label, "tone": tone,
                "reason": r["reason"].capitalize() + ".",
                "before": skill(r["live_model"].get("holdout_log_loss"), base),
                "after": skill(chosen_ll, base) if r.get("deployed") else None,
            })
        last = runs[0] if runs else {}
        now_w, before_w = model.get("coef", {}), last.get("weights_before") or {}
        factors = [{"label": self.factor_labels.get(f, (f, ""))[0], "note": self.factor_labels.get(f, (f, ""))[1],
                    "now": now_w[f], "before": before_w.get(f), "fmt": lambda v: f"{v:+.2f} {self.unit_short}"}
                   for f in model.get("features", []) if f in now_w]
        trained = model.get("trained_at")
        spec = {
            "intro": "Once a week during the season it checks itself against the newest games and only changes when a "
                     "new version clearly predicts better.",
            "tiles": [
                (model_page.short_date(trained)[:-6] if trained else "-", "Last retrained",
                 f"games through {model_page.short_date(model.get('trained_through'))}" if model.get("trained_through") else ""),
                (f"{model.get('training_games', 0):,}", "Games learned from",
                 " to ".join(model_page.short_date(d) for d in model.get("training_dates", []))),
                ("Weekly", "Next check", f"once {self.retrain_after}+ new games are in; waits in the offseason"),
                (rows[0]["decision"].split(" ")[0] if rows else "-", "Last decision",
                 f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
            ],
            "setup": self.recipe_setup(model.get("recipe", {})) + [
                ("Looks at:", f"{len(now_w)} factors for every game, listed below{self.looks_at}"),
            ],
            "runs": rows,
            "score_name": "Edge over a blind guess",
            "score_note": model_page.BLIND_GUESS_NOTE,
            "score_fmt": lambda v: pct(v, 1),
            "higher_better": True,
            "factors": factors,
            "factors_note": f"Each number is how many {self.unit} of margin that factor adds for the home team (negative "
                            "helps the away team). Before is the model that was live until the last retrain.",
            "empty": "No retrains logged yet. The first one runs about a week into the season.",
        }
        return self.page_shell("Model", "model.html", model_page.render(spec))

    # ── Home page summary ────────────────────────────────────────────────────
    def all_games(self):
        """Every pick in the shared game shape (extras.py), for game pages and the home site."""
        return [bb_game(p, self.sport, self.slug, self.logo_url, self.game_facts, self.team_label)
                for p in self.history["picks"]]

    def build_summary(self):
        """summary.json for the sport's games on the home page (github.com/ant56-arch/ant56-arch.github.io)."""
        picks = self.history["picks"]
        summary = {"updated": NOW.isoformat(), "heading": None, "picks": [], "record": None,
                   "empty": self.summary_empty, "result_labels": ["WIN", "LOSS"],
                   "retrained": self.model.get("trained_at"), "model_url": "model.html"}
        if picks:
            latest = max(p["date"] for p in picks)
            prefix = "Today" if latest == NOW.date().isoformat() else "Latest"
            summary["heading"] = f"{prefix}: {day_label(latest)}"
            top = sorted((p for p in picks if p["date"] == latest), key=lambda p: -p["prob"])[:self.top_n]
            summary["picks"] = [{
                "label": f"{p['pick']} over {p['away'] if p['pick'] == p['home'] else p['home']}",
                "sub": f"{p['away']} {'vs' if p.get('neutral') else '@'} {p['home']} · {tip_time(p)} ET",
                "value": f"{p['prob']:.0f}%",
                "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"]),
            } for p in top]
            # The all-time record the Home tab leads with, never reset by season.
            g = graded(picks)
            if g:
                w, l = wl(g)
                d = date.fromisoformat(min(p["date"] for p in g))
                summary["record"] = {"value": f"{w}-{l}", "label": "our picks to win",
                                     "sub": pct(w / len(g), 1), "since": f"{d:%b} {d.day}, {d.year}"}
                summary["season_record"] = season_record(g, season_of, wl)
                summary["daily"] = daily_results(g, wl)
            summary["ml_streak"] = ml_streak(picks)
            ml = moneyline.record(picks)
            if ml:  # optional: the home page can show it next to the record
                summary["ml_record"] = {"value": f"{ml['wins']}-{ml['losses']}", "label": "moneyline",
                                        "sub": f"{ml['picks']} picks graded"}
        # Only picks actually made count here, never last season's backtest.
        bb_home_parts(summary, picks, self.all_games())
        return summary

    # ── Build ────────────────────────────────────────────────────────────────
    def build(self):
        self.history = load_json(os.path.join(self.here, "picks_history.json"), {"picks": []})
        self.model = load_json(os.path.join(self.here, "model_weights.json"), {})
        slate = self.attach_picks(games_mod.load(self.slug)) if self.has_games_feed else None
        self.espn_games = slate["games"] if slate else ()
        if os.path.exists(self.out_dir):
            shutil.rmtree(self.out_dir)
        os.makedirs(self.out_dir)
        pages = {"index.html": self.build_index()}
        pages.update(self.extra_pages())
        pages.update({
            "history.html": self.build_history(),
            "accuracy.html": self.build_accuracy(),
        })
        if slate and self.has_schedule:
            pages["schedule.html"] = games_mod.schedule_redirect(self.slug)
        pages.update({
            "model.html": self.build_model(load_json(os.path.join(self.here, "model_history.json"), {"runs": []})["runs"]),
            "terms.html": games_mod.legal_redirect("terms"),
            "privacy.html": games_mod.legal_redirect("privacy"),
        })
        pages.update(bb_game_pages(self.all_games(), self.page_shell))
        for name, html in pages.items():
            with open(os.path.join(self.out_dir, name), "w") as f:
                f.write(html)
        with open(os.path.join(self.out_dir, "summary.json"), "w") as f:
            json.dump(self.build_summary(), f, indent=1)
        if slate:
            games_mod.write_json(os.path.join(self.out_dir, "games.json"), self.slug, slate, NOW.isoformat())
        write_assets(self.out_dir)
        print(f"Built {len(pages)} {self.sport} pages in {self.out_dir}")
