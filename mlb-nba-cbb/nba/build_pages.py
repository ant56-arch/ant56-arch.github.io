"""
build_pages.py - generates the NBA Edge pages into dist/nba/.

Run after the MLB build (build_site.py wipes dist/). Reads
nba/picks_history.json and nba/model_weights.json and writes:
  index.html    - today's games with a pick, win chance and moneyline pick for
                  each, and the record (game picks and moneyline)
  history.html  - any past day's picks and how they did
  accuracy.html - predicted vs. actual over the season, and last season's backtest
  terms.html, privacy.html
  summary.json  - today's three most confident picks, read by the home page

Shares MLB Edge's stylesheet, scripts and page helpers; nba.js adds the
History day picker for games.
"""

import json
import os
import shutil
import sys
from collections import defaultdict
from datetime import date, datetime
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from build_site import (team_accuracy_spec, backtest_months, asset_version, write_assets, bb_board, slim_footer, bb_game, bb_game_pages, bb_home_parts, ET, NOW,  # noqa: E402
                        card, ml_day, ml_history, pct, record_band_html, season_record, daily_results, ml_streak, script_json)
import extras  # noqa: E402
import games as games_mod  # noqa: E402
import accuracy_page  # noqa: E402
import model_page  # noqa: E402
import moneyline  # noqa: E402

OUT_DIR = os.path.join(ROOT, "dist", "nba")

HOME_URL = "https://ant56-arch.github.io/"
MLB_EDGE = f"{HOME_URL}mlb"
SPORT_LINKS = [("All", HOME_URL), ("NFL", f"{HOME_URL}nfl/index.html"), ("NBA", None), ("MLB", f"{MLB_EDGE}/"),
               ("NHL", f"{HOME_URL}nhl/index.html"), ("CFB", f"{HOME_URL}cfb/index.html"), ("CBB", f"{HOME_URL}cbb/index.html"),
               ("Soccer", f"{HOME_URL}soccer/index.html"),
               ("Betting", f"{HOME_URL}bets.html"), ("Schedule", f"{HOME_URL}schedule.html")]
TAGLINE = "Who wins every NBA game tonight and how likely it is, from a model graded against every final score."
TOP_N = 3
STRONG = 70  # win chance, in percent, that counts as a strong pick

FAVICON = ('data:image/svg+xml,'
           '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
           '%3Crect width=%2232%22 height=%2232%22 fill=%22%23121314%22/%3E'
           '%3Cpath d=%22M8 23V9h3.3l6.9 8.6V9H24v14h-3.3l-6.9-8.6V23z%22 fill=%22%23e5793b%22/%3E'
           '%3C/svg%3E')


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def day_label(iso):
    return date.fromisoformat(iso).strftime("%a, %b %-d")


def tip_time(p):
    return datetime.fromisoformat(p["start"]).astimezone(ET).strftime("%-I:%M %p")


def logo(abbr):
    return (f'<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/{abbr.lower()}.png" '
            f'alt="" loading="lazy" onerror="this.style.display=\'none\'">')


def graded(picks):
    return [p for p in picks if p.get("correct") is not None and not p.get("void")]


def season_of(iso):
    """NBA seasons run October to June; 2026-10-21 and 2027-04-01 are both in 2026-27."""
    d = date.fromisoformat(iso)
    start = d.year if d.month >= 7 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def top_per_day(picks, n=TOP_N):
    by_day = defaultdict(list)
    for p in picks:
        by_day[p["date"]].append(p)
    return [p for day in by_day.values() for p in sorted(day, key=lambda p: -p["prob"])[:n]]


def wl(picks):
    w = sum(p["correct"] for p in picks)
    return w, len(picks) - w

# The Sports Edge brand mark in the top bar, same on every Edge site.
BRAND_MARK = ('<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 3h22l-8 26H1z" fill="#e5793b"/>'
              '<path transform="translate(4.3 0) skewX(-15)" d="M10 9h12v3.2h-8.4v2.3h7.4v3h-7.4v2.3H22V23H10z" '
              'fill="#121314"/></svg>')


# ── Page chrome ──────────────────────────────────────────────────────────────
def page_shell(title, active, body_html, charts=False):
    tabs = [("index.html", "Home"), ("history.html", "History"), ("accuracy.html", "Accuracy"),
            ("model.html", "Model")]
    nav = "".join(
        f'<a href="{href}" class="active" aria-current="page">{label}</a>' if href == active
        else f'<a href="{href}">{label}</a>' for href, label in tabs)
    switcher = "".join(
        f'<a href="#" class="sport-tab active" aria-current="page">{name}</a>' if url is None
        else f'<a href="{url}" class="sport-tab">{name}</a>' for name, url in SPORT_LINKS)
    chart_js = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>' if charts else ""
    ver = asset_version()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | NBA Edge</title>
<meta name="description" content="{TAGLINE}">
<link rel="icon" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v={ver}">
{chart_js}
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="{HOME_URL}">{BRAND_MARK}<span class="brand-name">Sports <span>Edge</span></span></a>
    <nav class="sport-switcher" aria-label="Sport">{switcher}</nav>
  </div>
</header>
<header class="masthead" data-sport="NBA">
  <div class="masthead-inner">
    <h1 class="wordmark">NBA <span>EDGE</span></h1>
    <div class="tagline">{TAGLINE}</div>
    <div class="updated-chip">Updated {NOW.strftime("%b %-d, %Y %-I:%M %p")} ET</div>
  </div>
</header>
<nav class="tabs" aria-label="Sections"><div class="tabs-inner">{nav}</div></nav>
<div class="wrap">
  <main id="main-content">
  {body_html}
  </main>
  {footer()}
</div>
<script src="site.js?v={ver}"></script>
<script src="nba.js?v={ver}"></script>
</body>
</html>"""


def footer():
    return slim_footer("NBA Edge", "Scores, box scores, injury reports and moneyline prices via ESPN.")


# ── Home ─────────────────────────────────────────────────────────────────────
# The Home tab leads with the all-time record (every live pick since opening
# night, never reset, never the backtest), then the day's surest picks and a
# short row per game whose details open on tap.
def game_notes(p):
    notes = []
    for side in ("away", "home"):
        if p.get(f"{side}_out"):
            notes.append(f"{p[side]} without {', '.join(p[f'{side}_out'])}")
    rest = p.get("rest", {})
    b2b = [p[s] for s in ("away", "home") if rest.get(s) == 0]
    if b2b:
        notes.append(f"{' and '.join(b2b)} on a back-to-back")
    return "; ".join(notes)


def record_band(history):
    g = graded(history["picks"])
    eyebrow = "NBA Edge &middot; our picks to win"
    if not g:
        return record_band_html(eyebrow, wait="Starts on opening night")
    w, l = wl(g)
    d = date.fromisoformat(min(p["date"] for p in g))
    return record_band_html(eyebrow, f"{w}-{l}", pct(w / len(g), 1),
                            f"Since {d:%b} {d.day}, {d.year}. Every pick graded against the final score, and it "
                            "never resets.")


BOARD_NOTE = ("The percentage by each team is its chance to win, and the odds are our pick's moneyline. Value means "
              "our chance beats the odds by 6 points or more. Tap a game for injuries and rest.")


def build_index(history, model, espn_games=()):
    picks = history["picks"]
    today = NOW.date().isoformat()
    body = record_band(history)
    if picks:
        latest = max(p["date"] for p in picks)
        heading = "Today's Games" if latest == today else "Latest Games"
        day = [p for p in picks if p["date"] == latest]
        if latest != today:
            body += card("Today's Games", "", '<div class="empty-state">No NBA games today. Picks resume on '
                         'the next game day.</div>')
        body += extras.board_section(f"{heading}: {day_label(latest)}", BOARD_NOTE,
                                     bb_board(day, {g["id"]: g for g in all_games(history)}, espn_games, "NBA"))
    else:
        body += card("Today's Games", "", '<div class="empty-state">The season tips off in late October, and '
                     'picks start on opening night. Until then, the <a href="accuracy.html">Accuracy tab</a> shows '
                     'how the model did on every game of last season.</div>')
    return page_shell("Home", "index.html", body)


def backtest_stats(model):
    bt = model.get("backtest") or {}
    if not bt:
        return []
    strong = [b for b in bt["bands"] if b["range"][0] >= STRONG / 100]
    stats = [(f"{bt['correct']}-{bt['games'] - bt['correct']}", f"{model['backtest_season']} backtest",
              f"{pct(bt['accuracy'], 1)} of every game"),
             (pct(bt["top3"]["accuracy"], 1), f"Top {TOP_N} picks each day",
              f"{bt['top3']['correct']}-{bt['top3']['picks'] - bt['top3']['correct']}")]
    if strong:
        n = sum(b["n"] for b in strong)
        right = sum(round(b["actual"] * b["n"]) for b in strong)
        stats.append((pct(right / n, 1), f"Picks at {STRONG}%+", f"{right}-{n - right}"))
    return stats


# ── History ──────────────────────────────────────────────────────────────────
def build_history(history):
    by_day = defaultdict(list)
    for p in history["picks"]:
        by_day[p["date"]].append(p)
    if not by_day:
        body = card("History", "Every day's picks", '<div class="empty-state">No picks yet. The first ones go up '
                    'on opening night.</div>')
        return page_shell("History", "history.html", body)
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
    return page_shell("History", "history.html", body)


# ── Accuracy ─────────────────────────────────────────────────────────────────
def build_accuracy(history, model):
    """The Accuracy tab, laid out like every sport's (accuracy_page)."""
    bt = model.get("backtest")
    backtest = None
    if bt:
        note = (f"Fit on {model['trained_on'].split(' to ')[0]} through the season before {model['backtest_season']}, "
                f"then tested on all {bt['games']} regular-season games of {model['backtest_season']}. It picked "
                f"{pct(bt['accuracy'], 1)} of them right (it expected {pct(bt['predicted_accuracy'], 1)}), and its "
                f"projected margins were off by {bt['margin_mae']:.1f} points on average.")
        post = model.get("backtest_postseason")
        if post:
            note += f" In the play-in and playoffs it went {post['correct']}-{post['games'] - post['correct']}."
        backtest = {"subtitle": f"Every regular-season game of {model['backtest_season']}, picked by a model that "
                                "never saw that season",
                    "tiles": backtest_stats(model), "groups": backtest_months(bt),
                    "rows": accuracy_page.band_rows(bt["bands"]), "note": note}
    body = accuracy_page.render(team_accuracy_spec(history["picks"], season_of, STRONG, backtest=backtest))
    return page_shell("Accuracy", "accuracy.html", body, charts=accuracy_page.has_charts(body))


# ── Schedule tab and scoreboard strip ────────────────────────────────────────
def attach_picks(slate, history):
    """Each game gets the model's pick and win chance, if it made one."""
    picks = {(p["date"], p["away"], p["home"]): p for p in history["picks"]}
    for g in slate["games"]:
        day = games_mod.start_et(g).date().isoformat()
        p = picks.get((day, g["away"]["abbr"], g["home"]["abbr"]))
        if p:
            g["pick"] = {"text": f"{p['pick']} {p['prob']:.0f}%",
                         "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"])}
    return slate


# ── Model tab ────────────────────────────────────────────────────────────────
FACTOR_LABELS = {
    "home_court": ("Home court", "points for the home team"),
    "elo": ("Team rating (Elo) gap", "points per 100 rating points"),
    "net": ("Season point differential gap", "points per point of differential"),
    "recent": ("Last 10 games form gap", "points per point of differential"),
    "rest": ("Extra rest", "points per extra day off vs. the opponent"),
    "b2b_home": ("Home team on a back-to-back", ""),
    "b2b_away": ("Away team on a back-to-back", ""),
    "missing_home": ("Home team's missing players", "per 10 points of missing player value"),
    "missing_away": ("Away team's missing players", "per 10 points of missing player value"),
}


def recipe_setup(recipe):
    k, carry, years = recipe.get("elo_k", 20), recipe.get("elo_carry", 0.75), recipe.get("years", 3)
    speed = "steady" if k <= 15 else "medium" if k <= 20 else "fast"
    return [
        ("Learns from:", f"the last {years} seasons of games"),
        ("Team ratings:", f"{speed} - each result moves a team's Elo rating by up to {k} points"),
        ("Over the summer:", f"keeps {carry:.0%} of each team's rating; the rest resets toward average"),
    ]


def build_model(model, runs):
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
            "tested": len(r.get("candidates", [])), "decision": label, "tone": tone, "reason": r["reason"].capitalize() + ".",
            "before": skill(r["live_model"].get("holdout_log_loss"), base),
            "after": skill(chosen_ll, base) if r.get("deployed") else None,
        })
    last = runs[0] if runs else {}
    now_w, before_w = model.get("coef", {}), last.get("weights_before") or {}
    factors = [{"label": FACTOR_LABELS.get(f, (f, ""))[0], "note": FACTOR_LABELS.get(f, (f, ""))[1],
                "now": now_w[f], "before": before_w.get(f), "fmt": lambda v: f"{v:+.2f} pts"}
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
            ("Weekly", "Next check", "once 50+ new games are in; waits in the offseason"),
            (rows[0]["decision"].split(" ")[0] if rows else "-", "Last decision",
             f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
        ],
        "setup": recipe_setup(model.get("recipe", {})) + [
            ("Looks at:", f"{len(now_w)} factors for every game, listed below, including injuries on the day"),
        ],
        "runs": rows,
        "score_name": "Better than guessing",
        "score_fmt": lambda v: pct(v, 1),
        "higher_better": True,
        "factors": factors,
        "factors_note": "Each number is how many points of margin that factor adds for the home team (negative "
                        "helps the away team). Before is the model that was live until the last retrain.",
        "empty": "No retrains logged yet. The first one runs about a week into the season.",
    }
    return page_shell("Model", "model.html", model_page.render(spec))


# ── Home page summary ────────────────────────────────────────────────────────
def game_facts(p):
    notes = game_notes(p)
    return [("Projected", f"{escape(p['pick'])} by {p['margin']:.1f}", "points, from the model's ratings"),
            ("Injuries and rest", escape(notes) or '<span class="faint">Nothing notable</span>', "")]


def all_games(history):
    """Every pick in the shared game shape (extras.py), for game pages and the home site."""
    return [bb_game(p, "NBA", "nba",
                    lambda p, side: f"https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/{p[side].lower()}.png",
                    game_facts) for p in history["picks"]]


def build_summary(history, model):
    """summary.json for the NBA card on the home page (github.com/ant56-arch/ant56-arch.github.io)."""
    picks = history["picks"]
    summary = {"updated": NOW.isoformat(), "heading": None, "picks": [], "record": None,
               "empty": "No NBA picks yet. They start on opening night in late October.", "result_labels": ["WIN", "LOSS"],
               "retrained": model.get("trained_at"), "model_url": "model.html"}
    if picks:
        latest = max(p["date"] for p in picks)
        prefix = "Today" if latest == NOW.date().isoformat() else "Latest"
        summary["heading"] = f"{prefix}: {day_label(latest)}"
        top = sorted((p for p in picks if p["date"] == latest), key=lambda p: -p["prob"])[:TOP_N]
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
    bb_home_parts(summary, picks, all_games(history))
    return summary


# ── Legal pages ──────────────────────────────────────────────────────────────
def main():
    history = load_json(os.path.join(HERE, "picks_history.json"), {"picks": []})
    model = load_json(os.path.join(HERE, "model_weights.json"), {})
    games_slate = attach_picks(games_mod.load("nba"), history)
    if os.path.exists(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)
    pages = {
        "index.html": build_index(history, model, games_slate["games"]),
        "history.html": build_history(history),
        "accuracy.html": build_accuracy(history, model),
        "schedule.html": games_mod.schedule_redirect("nba"),
        "model.html": build_model(model, load_json(os.path.join(HERE, "model_history.json"), {"runs": []})["runs"]),
        "terms.html": games_mod.legal_redirect("terms"),
        "privacy.html": games_mod.legal_redirect("privacy"),
    }
    pages.update(bb_game_pages(all_games(history), page_shell))
    for name, html in pages.items():
        with open(os.path.join(OUT_DIR, name), "w") as f:
            f.write(html)
    with open(os.path.join(OUT_DIR, "summary.json"), "w") as f:
        json.dump(build_summary(history, model), f, indent=1)
    games_mod.write_json(os.path.join(OUT_DIR, "games.json"), "nba", games_slate, NOW.isoformat())
    write_assets(OUT_DIR)
    print(f"Built {len(pages)} NBA pages in {OUT_DIR}")


if __name__ == "__main__":
    main()
