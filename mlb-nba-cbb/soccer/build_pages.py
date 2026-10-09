"""
build_pages.py - generates the Soccer Edge pages into dist/soccer/.

Run after the MLB build (build_site.py wipes dist/). Reads
soccer/picks_history.json, soccer/model_weights.json, soccer/model_history.json
and soccer/ratings.json and writes:
  index.html    - the record, then today's and tomorrow's matches as game
                  cards with home win / draw / away win chances, our pick (the
                  likeliest of the three, a draw included) and its price;
                  buttons filter by competition
  history.html  - any past day's picks and how they did
  accuracy.html - predicted vs. actual for live picks, and last season's
                  walk-forward backtest against the closing odds
  model.html    - how the model retrains, league levels and the top clubs
  game-<id>.html, terms.html, privacy.html, schedule.html (redirects)
  summary.json  - record, top picks, slate, units and last results for the
                  home site; games.json for the Schedule tab

Built the same way as NHL Edge (nhl/build_pages.py), sharing MLB Edge's
stylesheet, scripts and page helpers. Sport pages show odds, never units.
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
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
from build_site import (team_accuracy_spec, backtest_months, asset_version, write_assets, slim_footer, bb_game_pages, card_game, game_units, lock_note, ET, NOW,  # noqa: E402
                        card, ml_day, ml_history, pct, price_line, record_band_html, season_record, daily_results, script_json)
import extras  # noqa: E402
import games as games_mod  # noqa: E402
import accuracy_page  # noqa: E402
import model_page  # noqa: E402
import moneyline  # noqa: E402

OUT_DIR = os.path.join(ROOT, "dist", "soccer")

HOME_URL = "https://ant56-arch.github.io/"
MLB_EDGE = f"{HOME_URL}mlb"
SPORT_LINKS = [("All", HOME_URL), ("NFL", f"{HOME_URL}nfl/index.html"), ("NBA", f"{HOME_URL}nba/index.html"),
               ("MLB", f"{MLB_EDGE}/"), ("NHL", f"{HOME_URL}nhl/index.html"),
               ("CFB", f"{HOME_URL}cfb/index.html"), ("CBB", f"{HOME_URL}cbb/index.html"), ("Soccer", None),
               ("Betting", f"{HOME_URL}bets.html"), ("Schedule", f"{HOME_URL}schedule.html")]
TAGLINE = ("Home win, draw or away win for every Premier League, La Liga and Champions League match, from a model "
           "graded against every final score.")
TOP_N = 3
COMPS = {"EPL": "Premier League", "LALIGA": "La Liga", "UCL": "Champions League"}
LEAGUE_NAMES = {"E0": "Premier League", "SP1": "La Liga", "D1": "Bundesliga", "I1": "Serie A", "F1": "Ligue 1",
                "P1": "Primeira Liga", "N1": "Eredivisie", "B1": "Belgian Pro League", "T1": "Super Lig",
                "SC0": "Scottish Premiership", "OTHER": "Elsewhere (Champions League only)"}
SIDE_WORD = {"home": "Home win", "draw": "Draw", "away": "Away win"}

FAVICON = ('data:image/svg+xml,'
           '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
           '%3Crect width=%2232%22 height=%2232%22 fill=%22%23121314%22/%3E'
           '%3Ccircle cx=%2216%22 cy=%2216%22 r=%229.5%22 fill=%22none%22 stroke=%22%23e5793b%22 stroke-width=%223%22/%3E'
           '%3Cpath d=%22M16 11.5l4.3 3.1-1.6 5h-5.4l-1.6-5z%22 fill=%22%23e5793b%22/%3E'
           '%3C/svg%3E')

BRAND_MARK = ('<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 3h22l-8 26H1z" fill="#e5793b"/>'
              '<path transform="translate(4.3 0) skewX(-15)" d="M10 9h12v3.2h-8.4v2.3h7.4v3h-7.4v2.3H22V23H10z" '
              'fill="#121314"/></svg>')


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def day_label(iso):
    return date.fromisoformat(iso).strftime("%a, %b %-d")


def kick_time(p):
    return datetime.fromisoformat(p["start"]).astimezone(ET).strftime("%-I:%M %p")


def graded(picks):
    return [p for p in picks if p.get("correct") is not None and not p.get("void")]


def season_label(iso):
    """European seasons run July to June; 2026-10-07 and 2027-04-01 are both in 2026-27."""
    d = date.fromisoformat(iso[:10])
    start = d.year if d.month >= 7 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def wl(picks):
    w = sum(p["correct"] for p in picks)
    return w, len(picks) - w


def is_draw(p):
    return p.get("pick") == "Draw"


def pick_text(p):
    """ "ARS" or "Draw"."""
    return p["pick"]


def matchup(p):
    return f"{p['away']} {'vs' if p.get('neutral') else '@'} {p['home']}"


def score_text(p):
    """ "CHE 1, ARS 1" from the 90-minute score, with what extra time made it."""
    if p.get("home_pts") is None:
        return ""
    s = f"{p['away']} {p['away_pts']}, {p['home']} {p['home_pts']}"
    if p.get("extra") and p.get("ft"):
        s += f" after 90 ({p['away']} {p['ft'][1]}, {p['home']} {p['ft'][0]} {p['extra']})"
    return s


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
<title>{title} | Soccer Edge</title>
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
<header class="masthead" data-sport="Soccer">
  <div class="masthead-inner">
    <h1 class="wordmark">SOCCER <span>EDGE</span></h1>
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
    return slim_footer("Soccer Edge", "Scores and moneyline prices via ESPN; league results and closing odds via "
                                      "football-data.co.uk.")


# ── The game shape (extras.py) ───────────────────────────────────────────────
def facts(p):
    pr, xg = p.get("probs") or {}, p.get("xg") or {}
    out = [("Chances", f"{escape(p['home'])} {pr.get('home', 0):.0f}% &middot; Draw {pr.get('draw', 0):.0f}% "
                       f"&middot; {escape(p['away'])} {pr.get('away', 0):.0f}%",
            "after 90 minutes plus stoppage; extra time and penalties don't count"),
           ("Expected goals", f"{escape(p['home'])} {xg.get('home', 0):.1f}, {escape(p['away'])} {xg.get('away', 0):.1f}",
            "from each club's attack and defence ratings")]
    ml = p.get("ml")
    if ml and ml.get("draw_ml") is not None:
        out.append(("Three-way odds", f"{escape(p['home'])} {extras.price_text(ml['home_ml'])} &middot; Draw "
                                      f"{extras.price_text(ml['draw_ml'])} &middot; {escape(p['away'])} "
                                      f"{extras.price_text(ml['away_ml'])}", ml.get("book") or ""))
    if p.get("extra") and p.get("ft"):
        out.append(("After extra time", f"{escape(p['home'])} {p['ft'][0]}, {escape(p['away'])} {p['ft'][1]} ({p['extra']})",
                    "the pick was graded on the 90-minute score"))
    if p.get("void"):
        out.append(("Result", "No decision", "postponed, or no 90-minute score to grade on"))
    return out


def lines(p):
    pr, xg = p.get("probs") or {}, p.get("xg") or {}
    return [("Draw", f"{pr.get('draw', 0):.0f}%", "ours" if is_draw(p) else "", "chance"),
            ("Exp. goals", f"{xg.get('away', 0):.1f}-{xg.get('home', 0):.1f}", "", f"{escape(p['away'])}-{escape(p['home'])}"),
            price_line(p)]


def soccer_game(p):
    """A pick in the shared game shape (extras.py), with each team's own win
    chance and the draw's in the lines strip."""
    gid = str(p["game_id"])
    final = p.get("correct") is not None and not p.get("void")
    start = datetime.fromisoformat(p["start"]).astimezone(ET)
    label = " · ".join((COMPS.get(p["comp"], p["comp"]), f"{start:%a, %b} {start.day}", f"{start:%-I:%M %p} ET"))
    pr = p.get("probs") or {}

    def team(side):
        return {"abbr": p[side], "name": p.get(f"{side}_name") or p[side], "record": p.get(f"{side}_record") or "",
                "logo": p.get(f"{side}_logo") or "", "chance": pr.get(side),
                "score": p.get(f"{side}_pts") if final else None}
    draw = is_draw(p)
    ml = p.get("ml")
    other = (f"{p['home']} and {p['away']}" if draw else p["away"] if p["pick"] == p["home"] else p["home"])
    if draw:
        sub = "chance of a draw after 90 minutes"
    else:
        sub = f"chance {p['pick']} beats {other} in regular time"
    return {
        "sport": "Soccer", "id": gid, "file": f"game-{gid}.html", "url": f"/soccer/game-{gid}.html",
        "date": p["date"], "start": p["start"], "label": label, "neutral": bool(p.get("neutral")),
        "away": team("away"), "home": team("home"), "group": p["comp"],
        "pick": p["pick"], "other": other, "prob": p["prob"],
        "pick_name": "Draw" if draw else None, "pick_label": "Our pick", "pick_sub": sub,
        "final": final, "hit": p.get("correct") if final else None, "void": bool(p.get("void")),
        "ml": {"price": ml["price"], "book": ml["book_prob"], "value": ml.get("value"),
               "units": ml.get("units"), "won": ml.get("won")} if ml else None,
        "why": [], "facts": facts(p), "hitters": [], "note": lock_note(p),
    }


def all_games(history):
    return [soccer_game(p) for p in history["picks"]]


# ── Home ─────────────────────────────────────────────────────────────────────
def record_band(history):
    g = graded(history["picks"])
    eyebrow = "Soccer Edge &middot; our picks"
    if not g:
        return record_band_html(eyebrow, wait="Starts with the first graded match")
    w, l = wl(g)
    d = date.fromisoformat(min(p["date"] for p in g))
    draws = [p for p in g if is_draw(p)]
    side = (f"Draw picks {sum(p['correct'] for p in draws)}-{len(draws) - sum(p['correct'] for p in draws)}"
            if draws else "")
    return record_band_html(eyebrow, f"{w}-{l}", pct(w / len(g), 1),
                            f"Since {d:%b} {d.day}, {d.year}. Every pick graded on the 90-minute result, and it "
                            "never resets.", side=side)


BOARD_NOTE = ("Each club's chance to win, with the draw's below. Our pick is the likeliest of the three, a draw "
              "included, at its moneyline; Value means our chance beats the odds by 6+ points. 90 minutes only.")


def comp_chips(picks):
    counts = defaultdict(int)
    for p in picks:
        counts[p["comp"]] += 1
    if len(counts) < 2:
        return ""
    return ('<div class="comp-chips" role="group" aria-label="Competition">'
            f'<button type="button" data-group="all" aria-pressed="true">All<span>{len(picks)}</span></button>'
            + "".join(f'<button type="button" data-group="{c}" aria-pressed="false">{name}<span>{counts[c]}</span></button>'
                      for c, name in COMPS.items() if counts.get(c)) + "</div>")


def board(picks, espn_games):
    games = {g["id"]: g for g in all_games({"picks": picks})}
    cards = [card_game(games[str(p["game_id"])], p, espn_games, lines(p)) for p in picks]
    return comp_chips(picks) + extras.game_board(cards)


def build_index(history, espn_games=()):
    picks = history["picks"]
    today = NOW.date().isoformat()
    body = record_band(history)
    upcoming = [p for p in picks if p["date"] >= today]
    if upcoming:
        first = min(p["date"] for p in upcoming)
        heading = "Today's Matches" if first == today else f"Next Matches: {day_label(first)}"
        if first != today:
            body += card("Today's Matches", "", '<div class="empty-state">No Premier League, La Liga or Champions '
                         'League matches today.</div>')
        body += extras.board_section(heading, BOARD_NOTE, board(upcoming, espn_games))
    elif picks:
        latest = max(p["date"] for p in picks)
        body += card("Today's Matches", "", '<div class="empty-state">No Premier League, La Liga or Champions '
                     'League matches today. Picks go up the day before each match day.</div>')
        body += extras.board_section(f"Latest Matches: {day_label(latest)}", BOARD_NOTE,
                                     board([p for p in picks if p["date"] == latest], espn_games))
    else:
        body += card("Today's Matches", "", '<div class="empty-state">Picks start once the model has been trained '
                     'on past seasons. Until then, the <a href="accuracy.html">Accuracy tab</a> shows how it did on '
                     'last season.</div>')
    return page_shell("Home", "index.html", body)


# ── History ──────────────────────────────────────────────────────────────────
def ml_text(p):
    r = ml_history(p)
    if r and is_draw(p):
        r["text"] = f"Draw {moneyline.price_text(p['ml']['price'])}"
    return r


def build_history(history):
    by_day = defaultdict(list)
    for p in history["picks"]:
        by_day[p["date"]].append(p)
    if not by_day:
        body = card("History", "Every day's picks", '<div class="empty-state">No picks yet.</div>')
        return page_shell("History", "history.html", body)
    days = {}
    for d, picks in by_day.items():
        g = graded(picks)
        w, l = wl(g)
        days[d] = {
            "label": day_label(d) + f", {d[:4]}",
            "summary": {"wins": w, "losses": l, "voided": sum(1 for p in picks if p.get("void")), "ml": ml_day(picks)},
            "games": [{
                "matchup": matchup(p), "meta": COMPS.get(p["comp"], p["comp"]), "pick": pick_text(p),
                "prob": p["prob"], "correct": p.get("correct"), "void": bool(p.get("void")),
                "ml": ml_text(p), "score": score_text(p),
            } for p in sorted(picks, key=lambda p: -p["prob"])],
        }
    data = {"order": sorted(days, reverse=True), "days": days}
    body = card("History", "Every day's picks and how they did, graded on the 90-minute result. Choose a day.",
                '<select id="day-select" class="week-picker" aria-label="Day"></select>'
                '<div id="day-content" style="margin-top:16px;"></div>'
                f'<script>const NBA_HISTORY = {script_json(data)};</script>')
    return page_shell("History", "history.html", body)


# ── Accuracy ─────────────────────────────────────────────────────────────────
LIVE_BANDS = ((0, 45), (45, 55), (55, 65), (65, 101))


def comp_table(model):
    rows = ""
    for code, s in (model.get("backtest_by_comp") or {}).items():
        book = s.get("book") or {}
        rows += f"""<tr><td class="row-label">{escape(s.get('name', code))}</td>
          <td data-label="Matches" class="num">{s['games']}</td>
          <td data-label="Pick right" class="num accent">{pct(s['accuracy'], 1)}</td>
          <td data-label="Odds favorite right" class="num">{pct(book['accuracy'], 1) if book else '&mdash;'}</td>
          <td data-label="Log loss (ours)" class="num">{s['log_loss']:.3f}</td>
          <td data-label="Log loss (closing odds)" class="num">{f"{book['log_loss']:.3f}" if book else '&mdash;'}</td></tr>"""
    if not rows:
        return ""
    return f"""<div class="section-label">By competition</div><table class="data record-table responsive-stack">
      <thead><tr><th>Competition</th><th class="num">Matches</th><th class="num">Pick right</th>
      <th class="num">Odds favorite right</th><th class="num">Log loss (ours)</th><th class="num">Log loss (closing odds)</th></tr></thead>
      <tbody>{rows}</tbody></table>
      <div class="table-footnote">Log loss scores all three chances at once (lower is better). Closing odds are the
      bookmakers' last prices with their margin removed, from football-data.co.uk; there are none for the Champions
      League. Beating them is hard: they're the market's best guess right before kickoff.</div>"""


def build_accuracy(history, model):
    """The Accuracy tab, laid out like every sport's (accuracy_page)."""
    picks = graded(history["picks"])
    by_comp = ""
    for c, name in COMPS.items():
        cp = [p for p in picks if p["comp"] == c and season_label(p["date"]) == season_label(max(q["date"] for q in picks))]
        if cp:
            w, l = wl(cp)
            by_comp += f"{name} {w}-{l} &middot; "
    bt = model.get("backtest")
    backtest = None
    if bt:
        book = bt.get("book") or {}
        stats = [(f"{bt['correct']}-{bt['games'] - bt['correct']}", f"{model['backtest_season']} backtest",
                  f"{pct(bt['accuracy'], 1)} of picks right"),
                 (f"{bt['log_loss']:.3f}", "Log loss, ours", "lower is better")]
        if book:
            stats.append((f"{book['log_loss']:.3f}", "Log loss, closing odds",
                          f"on the same {book['games']} league matches we score {book['model_log_loss']:.3f}"))
        note = (f"Walk-forward: before each match day the ratings were refitted on only the results before it, the "
                f"way the daily picks are made. The model expected {pct(bt['predicted_accuracy'], 1)} of its picks "
                f"to be right and got {pct(bt['accuracy'], 1)}. Draws were {pct(bt['draw_rate'], 0)} of results; "
                f"{bt['draw_picks']} of its picks were draws.")
        backtest = {"subtitle": f"Every Premier League, La Liga and Champions League match of {model['backtest_season']}, "
                                "each picked from only the results before it",
                    "tiles": stats, "groups": backtest_months(bt), "rows": accuracy_page.band_rows(bt["bands"]),
                    "note": note, "html": comp_table(model)}
    spec = team_accuracy_spec(
        history["picks"], season_label, 55, noun={"chance": "Chance"}, backtest=backtest,
        edges=[(lo / 100, hi / 100) for lo, hi in LIVE_BANDS],
        cal_note=f"{by_comp}Live picks only. If the model is honest, each row's two percentages should be close. "
                 "Small rows swing a lot.")
    body = accuracy_page.render(spec)
    return page_shell("Accuracy", "accuracy.html", body, charts=accuracy_page.has_charts(body))


# ── Schedule tab ─────────────────────────────────────────────────────────────
def attach_picks(slate, history):
    picks = {(p["date"], p["away"], p["home"]): p for p in history["picks"]}
    for g in slate["games"]:
        day = games_mod.start_et(g).date().isoformat()
        p = picks.get((day, g["away"]["abbr"], g["home"]["abbr"]))
        if p:
            g["pick"] = {"text": f"{pick_text(p)} {p['prob']:.0f}%",
                         "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"])}
    return slate


# ── Model tab ────────────────────────────────────────────────────────────────
def team_names():
    """Club key -> the name to show, from the stored results (ESPN's names first)."""
    try:
        import store
        out = {}
        for m in store.load_matches():
            for k, n in ((m["hk"], m["home"]), (m["ak"], m["away"])):
                if m["src"] == "espn" or k not in out:
                    out[k] = n
        return out
    except Exception as e:
        print(f"  club names unavailable: {e}")
        return {}


def recipe_setup(recipe):
    hl, reg, years = recipe.get("half_life", 240), recipe.get("reg", 4), recipe.get("years", 3)
    return [
        ("Learns from:", f"the last {years} seasons of ten European leagues and the Champions League"),
        ("Old results:", f"count half as much every {hl} days"),
        ("Pull to the league average:", f"as if every club had played {reg:g} extra average matches"),
        ("Refits:", "every club's ratings each morning, from the results so far"),
    ] + ([("Shots:", f"ratings learn {recipe['xg']:.0%} from shots on target, {1 - recipe['xg']:.0%} from goals")]
         if recipe.get("xg") else []) + ([("Home edge:", "measured for each league and the Champions League")]
                                         if recipe.get("home_reg") is not None else [])


def factors(model, before):
    now = model.get("coef") or {}
    out = [{"label": "Home advantage", "note": "extra goals a match for the home side", "now": now["home"],
            "before": before.get("home"), "fmt": lambda v: f"{v:+.2f} goals"},
           {"label": "Draw adjustment (rho)", "note": "below zero means more 0-0 and 1-1 draws than plain odds",
            "now": now["rho"], "before": before.get("rho"), "fmt": lambda v: f"{v:+.2f}"}] if now else []
    for code, name in (("E0", "Premier League"), ("SP1", "La Liga"), ("OTHER", "Champions League")):
        k = f"home_{code}"
        if k in now:
            out.append({"label": f"{name} home edge", "note": "extra goals a match for the home side",
                        "now": now[k], "before": before.get(k), "fmt": lambda v: f"{v:+.2f} goals"})
    for code, name in LEAGUE_NAMES.items():
        k = f"league_{code}"
        if k in now:
            out.append({"label": f"{name} level", "note": "goal difference a match vs. an average side",
                        "now": now[k], "before": before.get(k), "fmt": lambda v: f"{v:+.2f} goals"})
    return out


def top_clubs(ratings, n=20):
    if not ratings.get("teams"):
        return ""
    names = team_names()
    rows = "".join(f"""<tr><td class="row-label">{i}. {escape(names.get(t['team'], t['team'].title()))}</td>
      <td data-label="League">{escape(LEAGUE_NAMES.get(t['league'], t['league']))}</td>
      <td data-label="Rating" class="num accent">{t['strength']:+.2f}</td></tr>"""
                   for i, t in enumerate(ratings["teams"][:n], 1))
    return card("Strongest Clubs", f"Ratings as of {model_page.short_date(ratings.get('as_of'))}",
                f"""<table class="data record-table responsive-stack">
      <thead><tr><th>Club</th><th>League</th><th class="num">Rating</th></tr></thead><tbody>{rows}</tbody></table>
      <div class="table-footnote">Rating is goal difference a match against an average club on neutral ground,
      league level included, so clubs from different leagues compare directly. Champions League results are what
      link the leagues.</div>""")


def build_model(model, runs, ratings):
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
    trained = model.get("trained_at")
    spec = {
        "intro": "Every club gets an attack and a defence rating, its league's level plus its own, so a Premier "
                 "League side and a Portuguese side compare directly. Once a week it checks itself against the "
                 "newest matches and only changes when a new version clearly predicts better.",
        "tiles": [
            (model_page.short_date(trained)[:-6] if trained else "-", "Last retrained",
             f"matches through {model_page.short_date(model.get('trained_through'))}" if model.get("trained_through") else ""),
            (f"{model.get('training_matches', 0):,}", "Matches learned from",
             " to ".join(model_page.short_date(d) for d in model.get("training_dates", []))),
            ("Weekly", "Next check", "once 150+ new matches are in"),
            (rows[0]["decision"].split(" ")[0] if rows else "-", "Last decision",
             f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
        ],
        "setup": recipe_setup(model.get("recipe", {})),
        "runs": rows,
        "score_name": "Better than guessing",
        "score_fmt": lambda v: pct(v, 1),
        "higher_better": True,
        "factors": factors(model, (runs[0].get("weights_before") if runs else None) or {}),
        "factors_note": "League levels come from Champions League results between their clubs. Before is the model "
                        "that was live until the last retrain.",
        "empty": "No retrains logged yet. The research workflow trains the first model.",
    }
    return page_shell("Model", "model.html", model_page.render(spec) + top_clubs(ratings))


# ── Home page summary ────────────────────────────────────────────────────────
def recap(g):
    a, h = g["away"], g["home"]
    if g["pick"] == "Draw":
        return f"Draw {a['score']}-{h['score']}" if g.get("hit") else f"No draw, {a['abbr']} {a['score']}-{h['score']} {h['abbr']}"
    if a["score"] == h["score"]:
        return f"{g['pick']} drew {a['score']}-{h['score']}"
    return extras.recap_text(g)


def build_summary(history, model):
    picks = history["picks"]
    today = NOW.date().isoformat()
    summary = {"updated": NOW.isoformat(), "heading": None, "picks": [], "record": None,
               "empty": "No soccer picks yet. They start once the model is trained.", "result_labels": ["WIN", "LOSS"],
               "retrained": model.get("trained_at"), "model_url": "model.html"}
    if picks:
        upcoming = [p for p in picks if p["date"] >= today]
        day = min(p["date"] for p in upcoming) if upcoming else max(p["date"] for p in picks)
        prefix = "Today" if day == today else ("Next" if day > today else "Latest")
        summary["heading"] = f"{prefix}: {day_label(day)}"
        top = sorted((p for p in picks if p["date"] == day), key=lambda p: -p["prob"])[:TOP_N]
        summary["picks"] = [{
            "label": (f"Draw: {p['away']} vs {p['home']}" if is_draw(p)
                      else f"{p['pick']} over {p['away'] if p['pick'] == p['home'] else p['home']}"),
            "sub": f"{COMPS.get(p['comp'], p['comp'])} · {matchup(p)} · {kick_time(p)} ET",
            "value": f"{p['prob']:.0f}%",
            "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"]),
        } for p in top]
        g = graded(picks)
        if g:
            w, l = wl(g)
            d = date.fromisoformat(min(p["date"] for p in g))
            summary["record"] = {"value": f"{w}-{l}", "label": "our picks", "sub": pct(w / len(g), 1),
                                 "since": f"{d:%b} {d.day}, {d.year}"}
            summary["season_record"] = season_record(g, season_label, wl)
            summary["daily"] = daily_results(g, wl)
        ml = moneyline.record(picks)
        if ml:
            summary["ml_record"] = {"value": f"{ml['wins']}-{ml['losses']}", "label": "moneyline",
                                    "sub": f"{ml['picks']} picks graded"}
    # Only picks actually made count here, never the backtest.
    games = all_games(history)
    summary["slate"] = [extras.slate_entry(g) for g in games if g["date"] >= today and not g["final"] and not g["void"]]
    summary["units"] = game_units(picks)
    last = extras.last_day(games)
    if last:
        by_url = {g["url"]: g for g in games}
        for item in last["games"]:
            g = by_url.get(item["url"])
            if g:
                item["text"] = recap(g)
    summary["last"] = last
    return summary


def main():
    history = load_json(os.path.join(HERE, "picks_history.json"), {"picks": []})
    model = load_json(os.path.join(HERE, "model_weights.json"), {})
    ratings = load_json(os.path.join(HERE, "ratings.json"), {})
    slate = attach_picks(games_mod.load("soccer"), history)
    if os.path.exists(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)
    pages = {
        "index.html": build_index(history, slate["games"]),
        "history.html": build_history(history),
        "accuracy.html": build_accuracy(history, model),
        "schedule.html": games_mod.schedule_redirect("soccer"),
        "model.html": build_model(model, load_json(os.path.join(HERE, "model_history.json"), {"runs": []})["runs"], ratings),
        "terms.html": games_mod.legal_redirect("terms"),
        "privacy.html": games_mod.legal_redirect("privacy"),
    }
    pages.update(bb_game_pages(all_games(history), page_shell))
    for name, html in pages.items():
        with open(os.path.join(OUT_DIR, name), "w") as f:
            f.write(html)
    with open(os.path.join(OUT_DIR, "summary.json"), "w") as f:
        json.dump(build_summary(history, model), f, indent=1)
    games_mod.write_json(os.path.join(OUT_DIR, "games.json"), "soccer", slate, NOW.isoformat())
    write_assets(OUT_DIR)
    print(f"Built {len(pages)} Soccer pages in {OUT_DIR}")


if __name__ == "__main__":
    main()
