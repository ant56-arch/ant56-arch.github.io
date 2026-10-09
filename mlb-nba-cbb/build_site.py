"""
build_site.py - generates the static MLB Edge website into dist/.

Reads picks_history.json (every pick and its result), data/slate.json (today's
full slate, written by predict.py) and model_weights.json (backtest numbers),
and writes:
Three tabs:
  index.html    - Home: both all-time records, today's three surest hitters
                  and games, and the latest results
  players.html  - Player Hits: today's 10 hitter picks, every hitter in
                  today's games (sortable) and any past day's picks
  games.html    - Games: a card for every game today (the team model's pick,
                  win chance and moneyline price) and every past day's results
                  (teams/picks_history.json, written by teams/predict.py)
  accuracy.html - Accuracy: each model's record, accuracy over time,
                  calibration and backtest (accuracy_page, same as every sport)
  model.html    - Model: how each model retrains itself (model_page)
  history.html  - stub forwarding to where that tab went
  terms.html, privacy.html, 404.html
  summary.json  - today's top picks and the record, read by the home page
  games.json    - today's slate for the scoreboard strip, each game carrying
                  the team model's pick (or the top hitter when there's none)

Same look and page structure as NFL Edge (nfl-cfb/ in this repo), with a
sport switcher linking the sites together. Published as /mlb/ of
ant56-arch.github.io by .github/workflows/daily.yml (see publish_site.sh).
"""

import hashlib
import json
import os
import shutil
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "shared"))
import assets  # noqa: E402
import extras  # noqa: E402
import games as games_mod  # noqa: E402
import accuracy_page  # noqa: E402
import model_page  # noqa: E402
import moneyline  # noqa: E402

WEB_DIR = os.path.join(ROOT, "web")
DIST_DIR = os.path.join(ROOT, "dist")
ET = ZoneInfo("America/New_York")
NOW = datetime.now(ET)

HOME_URL = "https://ant56-arch.github.io/"
SPORT_LINKS = [("All", HOME_URL), ("NFL", f"{HOME_URL}nfl/index.html"), ("NBA", f"{HOME_URL}nba/index.html"), ("MLB", None),
               ("NHL", f"{HOME_URL}nhl/index.html"), ("CFB", f"{HOME_URL}cfb/index.html"), ("CBB", f"{HOME_URL}cbb/index.html"),
               ("Soccer", f"{HOME_URL}soccer/index.html"),
               ("Betting", f"{HOME_URL}bets.html"), ("Schedule", f"{HOME_URL}schedule.html")]
TAGLINE = ("Who wins every MLB game and which hitters get a hit today, from models graded against every "
           "box score.")
TEAMS_DIR = os.path.join(ROOT, "teams")
TOP_GAMES = 3  # the team model's most confident picks each day
STRONG_GAME = 60  # win chance, in percent, that counts as a strong game pick
DASH = "-"

FAVICON = ('data:image/svg+xml,'
           '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
           '%3Crect width=%2232%22 height=%2232%22 fill=%22%23121314%22/%3E'
           '%3Cpath d=%22M7 23V9h3.4l5.6 7.4L21.6 9H25v14h-3.3v-8.8L16 21.4l-5.7-7.2V23z%22 fill=%22%23e5793b%22/%3E'
           '%3C/svg%3E')


def load_json(name, default):
    path = os.path.join(ROOT, name)
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def asset_files():
    """What every MLB, NBA, NHL and CBB page loads: style.css and site.js built
    from shared/ (see shared/assets.py), and nba.js, which also renders the
    Games tab's day picker."""
    return {"style.css": assets.style(os.path.join(WEB_DIR, "sport.css")),
            "site.js": assets.script(os.path.join(WEB_DIR, "sport.js")),
            "nba.js": assets.read(os.path.join(WEB_DIR, "nba.js"))}


def asset_version():
    h = hashlib.md5()
    for text in asset_files().values():
        h.update(text.encode("utf-8"))
    return h.hexdigest()[:10]


def write_assets(out_dir):
    for name, text in asset_files().items():
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            f.write(text)


def script_json(data):
    return json.dumps(data).replace("</", "<\\/")


def pill(text, style):
    return f'<span class="pill pill-{style}">{text}</span>'


def pct(x, digits=0):
    return f"{x:.{digits}%}" if x is not None else DASH


def avg(x):
    return f"{x:.3f}".lstrip("0") if x is not None else DASH


def day_label(iso):
    return date.fromisoformat(iso).strftime("%a, %b %-d")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def logo(team_id):
    if not team_id:
        return ""
    return (f'<img class="team-logo" src="https://www.mlbstatic.com/team-logos/{team_id}.svg" alt="" '
            f'loading="lazy" onerror="this.style.display=\'none\'">')


def matchup(p):
    if p.get("team_abbr"):
        return f"{p['team_abbr']} {'vs' if p.get('is_home') else '@'} {p.get('opponent_abbr', '')}"
    return p.get("team", "")


def is_model_pick(p):
    """Picks from before the probability model have a relative score, not a hit chance."""
    return "raw_features" in p


def graded(picks):
    return [p for p in picks if p.get("got_hit") is not None and not p.get("void")]

# The Sports Edge brand mark in the top bar, same on every Edge site.
BRAND_MARK = ('<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 3h22l-8 26H1z" fill="#e5793b"/>'
              '<path transform="translate(4.3 0) skewX(-15)" d="M10 9h12v3.2h-8.4v2.3h7.4v3h-7.4v2.3H22V23H10z" '
              'fill="#121314"/></svg>')


# ── Page chrome ──────────────────────────────────────────────────────────────
def page_shell(title, active, body_html, charts=False):
    tabs = [("index.html", "Home"), ("players.html", "Player Hits"), ("games.html", "Games"),
            ("accuracy.html", "Accuracy"), ("model.html", "Model")]
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
<title>{title} | MLB Edge</title>
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
<header class="masthead" data-sport="MLB">
  <div class="masthead-inner">
    <h1 class="wordmark">MLB <span>EDGE</span></h1>
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
{'<script src="nba.js?v=' + ver + '"></script>' if active == "games.html" else ""}
</body>
</html>"""


def slim_footer(name, sources):
    """Every MLB, NBA, NHL and CBB page's footer: data credits and the
    gambling note on one line, links on the next."""
    return f"""<footer class="site-footer slim">
    <p class="footer-text">{sources} For entertainment only, not betting advice. Gambling problem? Call
      1-800-GAMBLER.</p>
    <nav class="footer-links" aria-label="Site">
      <a href="model.html">How the model works</a>
      <a href="{HOME_URL}terms.html">Terms</a>
      <a href="{HOME_URL}privacy.html">Privacy</a>
      <a href="{HOME_URL}">All sites</a>
      <a href="https://github.com/ant56-arch/ant56-arch.github.io">Source code</a>
      <span>&copy; {NOW.year} {name}</span>
    </nav>
  </footer>"""


def footer():
    return slim_footer("MLB Edge", "Stats, lineups and box scores via the MLB Stats API; moneyline prices via "
                                   "ESPN's scoreboard.")


def card(title, subtitle, body_html):
    sub = f'<div class="subtitle">{subtitle}</div>' if subtitle else ""
    return f"""<section class="card">
    <div class="card-header"><h2>{title}</h2>{sub}</div>
    <div class="card-body">{body_html}</div>
  </section>"""


def statline(stats):
    return '<div class="statline">' + "".join(
        f'<div class="stat"><div class="stat-value">{v}</div><div class="stat-label">{label}</div>'
        f'<div class="stat-sub">{sub}</div></div>' for v, label, sub in stats) + "</div>"


def team_accuracy_spec(picks, season_of, strong, prefix="acc", noun=None, edges=None, cal_note="", backtest=None,
                       extras=(), empty=None):
    """The Accuracy tab spec (accuracy_page.render) for a sport that picks a
    winner in every game: NBA, NHL, CBB, Soccer and MLB's team model. picks
    are that sport's live picks ({date, prob in percent, correct, void, ml})."""
    live = sorted((p for p in picks if p.get("correct") is not None and not p.get("void")), key=lambda p: p["date"])
    season, items = accuracy_page.season_items([(p["date"], p["prob"] / 100, bool(p["correct"])) for p in live],
                                               season_of)
    noun = noun or {}
    record = {}
    if items:
        tiles = accuracy_page.record_tiles(items, dict(accuracy_page.NOUN, **noun), strong / 100)
        ml = accuracy_page.ml_tile(moneyline.record([p for p in picks if season_of(p["date"]) == season]))
        record = {"tiles": tiles + ([ml] if ml else []),
                  "subtitle": f"{season} live picks, graded against the final score"}
    return {
        "prefix": prefix, "noun": noun, "record": record,
        "groups": accuracy_page.weekly_groups(items),
        "calibration": {"rows": accuracy_page.bands([(p, c) for _, p, c in items],
                                                    edges or [(.5, .6), (.6, .7), (.7, .8), (.8, 1.01)]),
                        "note": cal_note},
        "backtest": backtest, "extras": list(extras),
        "empty": empty or {"record": "No graded picks yet this season. The record starts after the first night of "
                                     "results.",
                           "trend": "The charts start after the first night of graded picks.",
                           "calibration": "Fills in once picks are graded."},
    }


def backtest_months(bt):
    """A model file's backtest months [{month, n, correct, predicted}] as chart groups."""
    return [(date.fromisoformat(m["month"] + "-01").strftime("%b %Y"),
             [(m["predicted"], True)] * m["correct"] + [(m["predicted"], False)] * (m["n"] - m["correct"]), None)
            for m in bt.get("months", [])]

# ── Home ─────────────────────────────────────────────────────────────────────
# The Home tab leads with the all-time record (every live pick since the
# first, never reset, never a backtest), then today's hitters and games as
# short rows whose details open on tap. The full tables stay on the other tabs.
def conf_html(prob):
    """How sure the model is: a bar and the percentage (prob in percent)."""
    return (f'<span class="pl-conf"><span class="pl-bar" aria-hidden="true"><span style="width:{prob:.0f}%"></span>'
            f'</span><span class="pl-pct">{prob:.0f}%</span></span>')


def record_band_html(eyebrow, value=None, pct_text="", since="", side="", wait=""):
    """The Home tab's first panel on every sport: the all-time record, big,
    or what starts it (wait) before the first graded pick."""
    eyebrow = f'<div class="rb-eyebrow">{eyebrow}</div>'
    if value is None:
        return f"""<section class="card record-card"><div class="record-band"><div>{eyebrow}
      <div class="rb-num rb-wait">{wait}</div>
      <div class="rb-since">Every pick is graded once its game is final, and the record keeps adding up from
        there. It never resets.</div></div></div></section>"""
    return f"""<section class="card record-card"><div class="record-band">
      <div>{eyebrow}
        <div class="rb-num">{value}<small>{pct_text}</small></div>
        <div class="rb-since">{since}</div>
      </div>
      <div class="rb-side">{side}</div>
    </div></section>"""


def result_html(p):
    if p.get("void"):
        return pill("NO DECISION", "void")
    if p.get("got_hit") is None:
        return ""
    return (f'<span class="faint">{p["hits"]}-for-{p["at_bats"]}</span> '
            + (pill("HIT", "positive") if p["got_hit"] else pill("MISS", "danger")))


def pick_meta(p):
    parts = [matchup(p)]
    if p.get("game_time"):
        parts.append(f"{p['game_time']} ET")
    return " · ".join(escape(x) for x in parts)


def pick_details(p):
    """What opens under a hitter: the why, then lineup spot and streak."""
    extra = []
    if p.get("batting_order"):
        extra.append(f"Batting {ordinal(p['batting_order'])}")
    elif "lineup_confirmed" in p:
        extra.append("Lineup not posted yet")
    if p.get("hit_streak"):
        extra.append(f"{p['hit_streak']}-game hit streak")
    why = escape(p.get("reason", "")) or "No notes for this pick."
    return f'<div class="pl-note"><b>Why:</b> {why}.' + (f' {escape(". ".join(extra))}.' if extra else "") + "</div>"


def picks_list(picks):
    rows = ""
    for i, p in enumerate(sorted(picks, key=lambda p: -p["confidence"]), 1):
        conf = conf_html(p["confidence"]) if is_model_pick(p) else f'<span class="pl-conf faint">{DASH}</span>'
        rows += f"""<li><details class="pl-row"><summary class="pl-line">
      <span class="pl-rank">{i}</span>
      <span class="pl-match"><span class="pl-teams">{logo(p.get('team_id'))}{escape(p['player_name'])}</span>
        <span class="pl-sub">{pick_meta(p)}</span></span>
      {conf}
      <span class="pl-res">{result_html(p)}</span>
    </summary>{pick_details(p)}</details></li>"""
    return f'<ul class="pick-list ranked">{rows}</ul>'


def hit_spark(g):
    """The cumulative share of picks that got a hit, day by day since the
    first, as a small line chart: it shows the record is steady, not a hot
    streak."""
    by_day = defaultdict(lambda: [0, 0])
    for p in g:
        by_day[p["date"]][0] += p["got_hit"]
        by_day[p["date"]][1] += 1
    pts, hits, n = [], 0, 0
    for day in sorted(by_day):
        hits, n = hits + by_day[day][0], n + by_day[day][1]
        pts.append((day, 100 * hits / n))
    if len(pts) < 3:
        return ""
    w, h, pl, pr, pt, pb = 320, 100, 34, 10, 10, 22
    lo = max(0, min(50, 10 * int(min(v for _, v in pts[len(pts) // 10:]) // 10)))
    hi = min(100, max(lo + 20, 10 * (int(max(v for _, v in pts[len(pts) // 10:]) // 10) + 1)))
    x = lambda i: pl + (w - pl - pr) * i / (len(pts) - 1)
    y = lambda v: pt + (h - pt - pb) * (hi - min(max(v, lo), hi)) / (hi - lo)
    line = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, (_, v) in enumerate(pts))
    area = f"{x(0):.1f},{y(lo):.1f} {line} {x(len(pts) - 1):.1f},{y(lo):.1f}"
    grid = "".join(f'<line x1="{pl}" x2="{w - pr}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="g"/>'
                   f'<text x="{pl - 6}" y="{y(v) + 3.5:.1f}" class="t" text-anchor="end">{v}%</text>'
                   for v in range(lo, hi + 1, 10))
    first = date.fromisoformat(pts[0][0])
    return f"""<svg class="rb-spark" viewBox="0 0 {w} {h}" role="img" aria-label="Share of all picks so far that got a hit, day by day: {pts[-1][1]:.1f}% now">
      {grid}<polygon points="{area}" class="a"/><polyline points="{line}" class="l"/>
      <circle cx="{x(len(pts) - 1):.1f}" cy="{y(pts[-1][1]):.1f}" r="3.5" class="d"/>
      <text x="{pl}" y="{h - 6}" class="t">{first:%b} {first.day}</text>
      <text x="{w - pr}" y="{h - 6}" class="t" text-anchor="end">Now</text></svg>"""


def alltime(history):
    """Every graded live pick since the first, never reset: (graded, hits, first date)."""
    g = graded(history["picks"])
    return g, sum(p["got_hit"] for p in g), min((p["date"] for p in g), default=None)


def hit_wl(picks):
    hits = sum(p["got_hit"] for p in picks)
    return hits, len(picks) - hits


def season_record(g, season_of, wl):
    """This season's record for the home page: the latest season with a graded
    pick, so a finished season's record stays up until the next one's first
    graded pick. None before any graded pick."""
    if not g:
        return None
    season = max(season_of(p["date"]) for p in g)
    cur = [p for p in g if season_of(p["date"]) == season]
    w, l = wl(cur)
    return {"value": f"{w}-{l}", "sub": pct(w / len(cur), 1), "season": str(season)}


def daily_results(g, wl):
    """[[date, wins, losses], ...] oldest first: every day with a graded pick,
    for the home page's trend lines, streaks and record chart and each Model
    tab's results calendar."""
    by_day = {}
    for p in g:
        by_day.setdefault(p["date"], []).append(p)
    return [[day, *wl(ps)] for day, ps in sorted(by_day.items())]


def ml_streak(picks):
    """The current run of moneyline picks won ("W") or lost ("L") in a row,
    one game at a time in start order: {"kind", "n"}, or None before the
    first graded pick. Of games that start together, losses count as the
    later ones, so a tie never stretches a winning run. What the home page's
    streak badge shows."""
    def when(p):
        try:
            return datetime.fromisoformat(p["start"].replace("Z", "+00:00")).timestamp()
        except (KeyError, AttributeError, TypeError, ValueError):
            return datetime.fromisoformat(p["date"]).timestamp()
    kind, n = None, 0
    for p in sorted(moneyline.graded(picks), key=lambda p: (when(p), not p["ml"]["won"]), reverse=True):
        k = "W" if p["ml"]["won"] else "L"
        if kind and k != kind:
            break
        kind, n = k, n + 1
    return {"kind": kind, "n": n} if kind else None


def record_band(history, team_history):
    g, hits, first = alltime(history)
    eyebrow = "MLB Edge &middot; top hitters who got a hit"
    if not g:
        return record_band_html(eyebrow, wait="Starts with the first box score")
    d = date.fromisoformat(first)
    tg = game_graded((team_history or {}).get("picks", []))
    games = ""
    if tg:
        w, l = game_wl(tg)
        games = f' Picking which team wins is {w}-{l}, on the <a href="games.html">Games tab</a>.'
    return record_band_html(eyebrow, f"{hits}-{len(g) - hits}", pct(hits / len(g), 1),
                            f"Since {d:%b} {d.day}, {d.year}. Every pick graded against the box score, and it "
                            f"never resets.{games}", hit_spark(g))


HOW_TO_READ = """<details class="how-to"><summary>How to read this</summary><div>
  <p>The percentage is the model's chance he gets at least one hit. Once a lineup is posted, only confirmed
    starters can be picked, and a pick locks when its game starts. A hitter who doesn't bat is no decision, not a
    miss. Tap a hitter for why he was picked.</p>
</div></details>"""


def latest_hitters(history):
    """(date, picks) for the newest day with hitter picks, or (None, [])."""
    picks = history["picks"]
    if not picks:
        return None, []
    latest = max(p["date"] for p in picks)
    return latest, [p for p in picks if p["date"] == latest]


def no_games_today(slate):
    return bool(slate) and not slate.get("games") and slate.get("date") == NOW.date().isoformat()


# ── Home ─────────────────────────────────────────────────────────────────────
# A quick look: both all-time records side by side, today's three surest
# hitters and games, and how the latest picks did. Everything else is one tap
# away on Player Hits, Games or the model page.
def duo_half(href, eyebrow, wl, n, since, wait):
    if not n:
        num = f'<div class="rb-num rb-wait">{wait}</div>'
        since = ""
    else:
        num = f'<div class="rb-num">{wl[0]}-{wl[1]}<small>{pct(wl[0] / n, 1)}</small></div>'
        d = date.fromisoformat(since)
        since = f'<div class="rb-since">Since {d:%b} {d.day}, {d.year}</div>'
    return f'<a class="duo" href="{href}"><div class="rb-eyebrow">{eyebrow}</div>{num}{since}</a>'


def duo_band(history, team_history):
    g, hits, first = alltime(history)
    tg = game_graded(team_history.get("picks", []))
    gw, gl = game_wl(tg)
    return f"""<section class="card record-card"><div class="duo-band">
      {duo_half("players.html", "Player hits &middot; top hitters who got a hit", (hits, len(g) - hits), len(g),
                first, "Starts with the first box score")}
      {duo_half("games.html", "Games &middot; picking which team wins", (gw, gl), len(tg),
                min((p["date"] for p in tg), default=None), "Starts after the first night of results")}
    </div>
    <p class="duo-note">Live picks only, each graded against the final score, and neither record ever resets.
      <a href="accuracy.html">How they've done</a> &middot; <a href="model.html">How the models work</a></p></section>"""


def last_results(history, team_history):
    """How the newest finished day's hitter and game picks did, as two stats."""
    today = NOW.date().isoformat()
    stats = []
    g = [p for p in graded(history["picks"]) if p["date"] < today]
    if g:
        day = max(p["date"] for p in g)
        d = [p for p in g if p["date"] == day]
        stats.append((f"{sum(p['got_hit'] for p in d)} of {len(d)}", "Top hitters got a hit", day_label(day)))
    tg = [p for p in game_graded(team_history.get("picks", [])) if p["date"] < today]
    if tg:
        day = max(p["date"] for p in tg)
        w, l = game_wl([p for p in tg if p["date"] == day])
        stats.append((f"{w}-{l}", "Game picks", day_label(day)))
    return extras.board_section("Latest results", "How the last finished day's picks did.", statline(stats)) \
        if stats else ""


def build_index(history, slate, team_history, espn_games=()):
    body = duo_band(history, team_history)
    latest, day_picks = latest_hitters(history)
    more = '<a class="more-link" href="{}">{}</a>'.format
    if no_games_today(slate):
        body += extras.board_section("Today", "", '<div class="empty-state">No MLB games today. Picks resume on '
                                     'the next game day.</div>')
    elif day_picks:
        when = "Today's" if latest == NOW.date().isoformat() else "Latest"
        body += extras.board_section(
            f"{when} surest hitters: {day_label(latest)}",
            "The three hitters most likely to get a hit. Tap one for why.",
            picks_list(sorted(day_picks, key=lambda p: -p["confidence"])[:3])
            + more("players.html", f"All {len(day_picks)} picks and every hitter in today's games"
                   if len(day_picks) > 3 else "Every hitter in today's games and past days"))
    today = NOW.date().isoformat()
    todays = sorted((p for p in team_history.get("picks", []) if p["date"] == today), key=lambda p: -p["prob"])
    if todays:
        board = extras.game_board([card_game(mlb_game(p), p, espn_games, mlb_lines(p)) for p in todays[:3]],
                                  top_n=0)
        n = len(todays)
        body += extras.board_section(
            f"Today's surest games: {day_label(today)}", BOARD_NOTE,
            board + more("games.html", f"All {n} of today's games" if n > 3 else "Every game and past results"))
    return page_shell("Home", "index.html", body + last_results(history, team_history))


# ── Player Hits ──────────────────────────────────────────────────────────────
# The hitter record, today's 10 picks, every hitter in today's games, then
# any past day's picks.
def todays_picks(history, slate):
    latest, day_picks = latest_hitters(history)
    if not day_picks:
        return card("Today's Hitters", "", '<div class="empty-state">No picks yet.</div>')
    heading = "Today's hitters" if latest == NOW.date().isoformat() else "Latest hitters"
    html = extras.board_section(f"{heading}: {day_label(latest)}",
                                f"The {len(day_picks)} hitters most likely to get a hit, at most two per game. "
                                "Tap one for why.",
                                picks_list(day_picks) + HOW_TO_READ)
    if no_games_today(slate):
        html = card("Today's Hitters", "", '<div class="empty-state">No MLB games today. Picks resume on the '
                    'next game day.</div>') + html
    return html


def every_hitter(slate):
    if not slate or not slate.get("players"):
        return card("Every Hitter Today", "",
                    '<div class="empty-state">No slate yet today. It fills in once the day\'s games are scored.</div>')

    pick_ids = set(slate.get("pick_ids", []))
    rows = ""
    for p in slate["players"]:
        order = p.get("batting_order")
        order_html = ordinal(order) if order else '<span class="faint">TBD</span>'
        pick_tag = " " + pill("PICK", "primary") if p["player_id"] in pick_ids else ""
        era = f"{p['opp_era']:.2f}" if p.get("opp_era") is not None else DASH
        rows += f"""<tr>
          <td data-key="player" data-value="{escape(p['player_name'])}"><div class="player-cell">{logo(p['team_id'])}<div>
            <div class="player-name">{escape(p['player_name'])}{pick_tag}</div>
            <div class="player-meta">{escape(matchup(p))} · {escape(p['game_time'])} ET</div></div></div></td>
          <td data-key="prob" data-value="{p['confidence']}" data-label="Hit chance" class="num prob">{p['confidence']:.0f}%</td>
          <td data-key="avg" data-value="{p['season_avg'] if p['season_avg'] is not None else ''}" data-label="Season AVG" class="num">{avg(p['season_avg'])}</td>
          <td data-key="recent" data-value="{p['recent_avg'] if p['recent_avg'] is not None else ''}" data-label="Last 2 wks" class="num">{avg(p['recent_avg'])}</td>
          <td data-key="abpg" data-value="{p['ab_per_game']:.2f}" data-label="AB/game" class="num">{p['ab_per_game']:.1f}</td>
          <td data-key="pitcher" data-value="{escape(p['opp_pitcher'])}" data-label="Opp. starter"><span>{escape(p['opp_pitcher'])} <span class="faint">({escape(p['opp_hand'])}, {era})</span></span></td>
          <td data-key="order" data-value="{order or ''}" data-label="Batting" class="num">{order_html}</td>
        </tr>"""
    table = f"""<table class="data responsive-stack" data-sortable>
      <thead><tr>
        <th data-sort-key="player">Player</th><th data-sort-key="prob" class="num">Hit chance</th>
        <th data-sort-key="avg" class="num">AVG</th><th data-sort-key="recent" class="num">Last 2 wks</th>
        <th data-sort-key="abpg" class="num">AB/G</th><th data-sort-key="pitcher">Opp. starter (ERA)</th>
        <th data-sort-key="order" class="num">Batting</th>
      </tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <div class="table-footnote">Until a team posts its lineup, only its regulars are listed. After that, only the
      nine starters are. Select a column header to sort.</div>"""
    subtitle = (f"All {len(slate['players'])} hitters in {len(slate['games'])} games on {day_label(slate['date'])}, "
                f"most likely to get a hit first.")
    return card("Every Hitter Today", subtitle, table)


def past_days(history):
    by_day = defaultdict(list)
    for p in history["picks"]:
        if p["date"] < NOW.date().isoformat():  # today's picks are in the list above
            by_day[p["date"]].append(p)
    if not by_day:
        return ""
    days = {}
    for d, picks in by_day.items():
        g = graded(picks)
        days[d] = {
            "label": day_label(d) + f", {d[:4]}",
            "legacy": not any(is_model_pick(p) for p in picks),
            "summary": {"hits": sum(p["got_hit"] for p in g), "graded": len(g),
                        "voided": sum(1 for p in picks if p.get("void"))},
            "picks": [{
                "player_name": p["player_name"], "matchup": matchup(p),
                "confidence": p["confidence"] if is_model_pick(p) else None,
                "got_hit": p.get("got_hit"), "hits": p.get("hits"), "at_bats": p.get("at_bats"),
                "void": bool(p.get("void")),
            } for p in sorted(picks, key=lambda p: -p["confidence"])],
        }
    data = {"order": sorted(days, reverse=True), "days": days}
    return ('<div id="past"></div>'
            + card("Past Days", "Every day's hitter picks and how they did. Choose a day.",
                   '<select id="day-select" class="week-picker" aria-label="Day"></select>'
                   '<div id="day-content" style="margin-top:16px;"></div>'
                   f'<script>const HISTORY_DATA = {script_json(data)};</script>'))


def build_players(history, slate, team_history):
    body = record_band(history, team_history) + todays_picks(history, slate) + every_hitter(slate) + past_days(history)
    return page_shell("Player Hits", "players.html", body)


def moved(url, title):
    """A stub at an old tab's address that forwards to where it went."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url={url}">
<link rel="canonical" href="{url}">
<title>{title} | MLB Edge</title>
</head>
<body><p>This page moved to <a href="{url}">{title}</a>.</p></body>
</html>"""


# ── Accuracy ─────────────────────────────────────────────────────────────────
def hit_accuracy_spec(history, model):
    """The hit model's Accuracy tab spec (accuracy_page.render)."""
    picks = sorted(graded([p for p in history["picks"] if is_model_pick(p)]), key=lambda p: p["date"])
    season, items = accuracy_page.season_items(
        [(p["date"], p["confidence"] / 100, bool(p["got_hit"])) for p in picks], lambda d: d[:4])
    noun = {"chance": "Hit chance", "actual": "Actually hit", "rate": "Hit rate", "count": "Picks", "won": "got a hit"}
    record = {}
    if items:
        record = {"tiles": accuracy_page.record_tiles(items, dict(accuracy_page.NOUN, **noun), .7, as_rate=True),
                  "subtitle": f"{season} live hitter picks, graded against the box score"}
    backtest = None
    m = model.get("metrics", {})
    if m.get("calibration"):
        bt = m.get("backtest", {})
        note = (f"Fit on games from {model.get('training_dates', ['', ''])[0]} up to {m.get('test_from')}, then "
                f"tested on the {m.get('test_rows')} hitter-games from {m.get('test_from')} on, which it never saw.")
        tiles = []
        if bt.get("top_n_hit_rate") is not None:
            note += (f" Its top {bt['top_n']} per day got a hit {pct(bt['top_n_hit_rate'], 1)} of the time, "
                     f"vs. {pct(bt['all_hitters_hit_rate'], 1)} for all hitters.")
            tiles = [(pct(bt["top_n_hit_rate"], 1), f"Top {bt['top_n']} per day", "got a hit"),
                     (pct(bt["all_hitters_hit_rate"], 1), "All hitters", "got a hit")]
        backtest = {"subtitle": "How the current model did on games held out of training", "tiles": tiles,
                    "rows": accuracy_page.band_rows(m["calibration"]), "note": note}
    return {
        "prefix": "acc-hits", "noun": noun, "record": record,
        "groups": accuracy_page.weekly_groups(items),
        "calibration": {"rows": accuracy_page.bands([(p, c) for _, p, c in items],
                                                    [(0, .65), (.65, .7), (.7, .75), (.75, 1.01)])},
        "backtest": backtest,
        "empty": {"record": "No live picks graded yet. The record starts after the first night of results.",
                  "trend": "The charts start after the first night of graded picks.",
                  "calibration": "Fills in once picks are graded."},
    }


# ── Games (the team model) ───────────────────────────────────────────────────
def game_graded(picks):
    return [p for p in picks if p.get("correct") is not None and not p.get("void")]


def game_wl(picks):
    w = sum(p["correct"] for p in picks)
    return w, len(picks) - w


def first_pitch(p):
    return datetime.fromisoformat(p["start"]).astimezone(ET).strftime("%-I:%M %p")


def starter_text(sp):
    if not sp or not sp.get("id"):
        return "TBD"
    parts = sp["name"].split(" ", 1)
    name = f"{parts[0][0]}. {parts[1]}" if len(parts) == 2 else sp["name"]
    return f"{name} ({sp['era']:.2f})" if sp.get("era") is not None else f"{name} (1st start)"


# ── Moneyline picks (moneyline.py), shared with NBA Edge ─────────────────────
def locked_text(p):
    """'Sep 27, 12:05 PM ET' - when the pick was last refreshed - or None."""
    try:
        t = datetime.fromisoformat(p["set_at"].replace("Z", "+00:00")).astimezone(ET)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    return f"{t:%b} {t.day}, {t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'} ET"


def ml_history(p):
    """moneyline.result for the History day picker, plus when it was locked."""
    r = moneyline.result(p.get("ml"), p.get("void"))
    if r is not None:
        r["locked"] = locked_text(p)
    return r


def lock_note(p):
    """When a pick and its price were taken: 'Locked Sep 27, 12:05 PM ET'
    once the game has started (the last refresh before first pitch or tip),
    else 'Set ... - locks at first pitch'."""
    when = locked_text(p)
    try:
        start = datetime.fromisoformat(p["start"])
    except (KeyError, TypeError, ValueError):
        return ""
    if not when:
        return ""
    if start <= NOW or p.get("correct") is not None or p.get("void"):
        return f'<div class="lock-note locked">Locked {when}</div>'
    return f'<div class="lock-note">Set {when} &middot; locks at the start</div>'


def ml_day(picks):
    """A History day's moneyline summary and per-game fields for nba.js."""
    rec = moneyline.record(picks)
    return {"wins": rec["wins"], "losses": rec["losses"]} if rec else None


def game_history(picks):
    by_day = defaultdict(list)
    for p in picks:
        if p["date"] < NOW.date().isoformat() or p.get("correct") is not None or p.get("void"):
            by_day[p["date"]].append(p)
    if not by_day:
        return ""
    days = {}
    for d, ps in by_day.items():
        w, l = game_wl(game_graded(ps))
        days[d] = {
            "label": day_label(d) + f", {d[:4]}",
            "summary": {"wins": w, "losses": l, "voided": sum(1 for p in ps if p.get("void")), "ml": ml_day(ps)},
            "games": [{
                "matchup": f"{p['away']} @ {p['home']}",
                "meta": f"{starter_text(p.get('away_sp'))} vs. {starter_text(p.get('home_sp'))}",
                "pick": p["pick"], "prob": p["prob"], "correct": p.get("correct"), "void": bool(p.get("void")),
                "ml": ml_history(p),
                "score": (f"{p['away']} {p['away_runs']}, {p['home']} {p['home_runs']}"
                          if p.get("home_runs") is not None else ""),
            } for p in sorted(ps, key=lambda p: -p["prob"])],
        }
    data = {"order": sorted(days, reverse=True), "days": days}
    return card("Results", "Every past day's game picks and how they did. Choose a day.",
                '<select id="day-select" class="week-picker" aria-label="Day"></select>'
                '<div id="day-content" style="margin-top:16px;"></div>'
                f'<script>const GAME_HISTORY = {script_json(data)};</script>')


def games_band(picks):
    """The Games tab's record band: every live game pick since the first,
    never reset."""
    g = game_graded(picks)
    eyebrow = "MLB Edge &middot; picking which team wins"
    if not g:
        return record_band_html(eyebrow, wait="Starts after the first night of results")
    w, l = game_wl(g)
    d = date.fromisoformat(min(p["date"] for p in g))
    return record_band_html(eyebrow, f"{w}-{l}", pct(w / len(g), 1),
                            f"Since {d:%b} {d.day}, {d.year}. Every game pick graded against the final score, and "
                            "it never resets.")


BOARD_NOTE = ("The percentage by each team is its chance to win, and the odds are our pick's moneyline. "
              "Value means our chance beats the odds by 6 points or more. Tap a game for more.")


def build_games(team_history, espn_games=()):
    picks = team_history["picks"]
    today = NOW.date().isoformat()
    todays = [p for p in picks if p["date"] == today]
    body = games_band(picks)
    if todays:
        board = extras.game_board([card_game(mlb_game(p), p, espn_games, mlb_lines(p)) for p in todays])
        body += extras.board_section(f"Today's games: {day_label(today)}", BOARD_NOTE, board)
    elif picks:
        body += card("Today's Games", "", '<div class="empty-state">No MLB games today, or the slate isn\'t up '
                     'yet. Picks go up on the next game day; past days are under Results below.</div>')
    else:
        body += card("Today's Games", "", '<div class="empty-state">Game picks go up with the next daily '
                     'update: a winner and a win chance for every game.</div>')
    return page_shell("Games", "games.html", body + game_history(picks))


# ── Game cards (extras.game_board) for MLB, NBA, NHL and CBB ────────────────
def espn_for(p, espn_games):
    """The game on ESPN's scoreboard matching a pick, by team abbreviation or
    name, the closest start for a doubleheader; None without one."""
    def names(t):
        return {t.get("abbr", ""), ABBR_ALIASES.get(t.get("abbr", ""), t.get("abbr", "")), t.get("name", "")} - {""}
    ours = lambda side: {p.get(side, ""), p.get(f"{side}_name") or ""} - {""}
    cands = [g for g in espn_games if names(g["away"]) & ours("away") and names(g["home"]) & ours("home")]
    if not cands:
        return None
    start = datetime.fromisoformat(p["start"])
    return min(cands, key=lambda g: abs((games_mod.start_et(g) - start).total_seconds()))


def card_game(g, p, espn_games, lines):
    """A game in the shared shape, with what its card adds: TV, stadium and
    records from ESPN's scoreboard (where it has the game) and the lines strip."""
    info = games_mod.card_info(espn_for(p, espn_games or ()))
    g["tv"], g["venue"], g["lines"] = info.get("tv", ""), info.get("venue", ""), lines
    for side, rec in zip(("away", "home"), info.get("records", ("", ""))):
        if rec and not g[side].get("record"):
            g[side]["record"] = rec
    return g


def price_line(p):
    """The lines-strip cell with the book's chance for our pick, next to ours in the card's footer."""
    ml = p.get("ml")
    if not ml:
        return ("Odds say", '<span class="faint">No odds yet</span>', "", "")
    return ("Odds say", f"{ml['book_prob']:.0f}%", "vegas", f"for {escape(p['pick'])}, we say {p['prob']:.0f}%")


def mlb_lines(p):
    """Each starting pitcher and the book's chance for our pick."""
    def sp(side):
        s = p.get(f"{side}_sp") or {}
        if not s.get("id"):
            return (f"{p[side]} starter", '<span class="faint">TBD</span>', "", "")
        era = f"{s['era']:.2f} ERA" if s.get("era") is not None else "1st start"
        return (f"{p[side]} starter", escape(starter_text(s).rsplit(" (", 1)[0]), "", era)
    return [sp("away"), sp("home"), price_line(p)]


def bb_lines(p, sport):
    """Our projected margin and the book's chance for our pick."""
    if sport == "NHL":
        ours = ("Projected", f"{escape(p['pick'])} by {p['margin']:.1f}", "ours", "goals")
    else:
        ours = ("Our line", f"{escape(p['pick'])} {extras.MINUS}{p['margin']:.1f}", "ours", "")
    return [ours, price_line(p)]


def bb_board(picks, games_by_id, espn_games, sport):
    """A day's NBA, NHL or CBB picks as game cards."""
    return extras.game_board([card_game(games_by_id[str(p["game_id"])], p, espn_games, bb_lines(p, sport))
                              for p in picks])


# ── Game pages and the home site's Betting tab and Last night strip ─────────
GAME_PAGE_DAYS = 21  # game pages are built for this many days back, plus today
WHY_LABELS = {"home_field": "Home field", "elo": "Team strength", "starters": "Starting pitchers",
              "bullpen": "Bullpen"}


def game_units(picks):
    """Every graded moneyline game pick, for the Betting tab's units."""
    return extras.units_summary((p["date"], p["ml"]["units"], p["ml"]["won"], p["ml"].get("price"), p["ml"].get("value"))
                                for p in moneyline.graded(picks))


def sp_fact(team, sp):
    if not sp or not sp.get("id"):
        return (f"{team} starter", "To be announced", "")
    if sp.get("era") is None:
        return (f"{team} starter", escape(sp["name"]), "First start of the season")
    ip = sp.get("ip") or 0
    whole, frac = int(ip), round((ip - int(ip)) * 3)
    innings = f"{whole}{['', '⅓', '⅔'][frac] if frac < 3 else ''}" if frac < 3 else str(whole + 1)
    return (f"{team} starter", escape(sp["name"]), f"{sp['era']:.2f} ERA, {innings} innings")


def mlb_game(p, hitters=()):
    """A team-model pick in the shared game shape (extras.py)."""
    gid = str(p["game_id"])
    final = p.get("correct") is not None and not p.get("void")
    start = datetime.fromisoformat(p["start"]).astimezone(ET)
    label = " · ".join(x for x in (p.get("round"), f"Game {p['doubleheader']}" if p.get("doubleheader") else "",
                                   f"{start:%a, %b} {start.day}", f"{first_pitch(p)} ET") if x)
    team = lambda side: {"abbr": p[side], "name": p.get(f"{side}_name") or p[side],
                         "record": p.get(f"{side}_record") or "",
                         "logo": f"https://www.mlbstatic.com/team-logos/{p[f'{side}_id']}.svg" if p.get(f"{side}_id") else "",
                         "score": p.get(f"{side}_runs") if final else None}
    home_pick = p["pick"] == p["home"]
    ml = p.get("ml")
    why = [(WHY_LABELS.get(k, k.replace("_", " ").capitalize()), v if home_pick else -v)
           for k, v in (p.get("factors") or {}).items()]
    hw = []
    for h in sorted(hitters, key=lambda h: -h["confidence"]):
        res = result_html(h) if h.get("got_hit") is not None or h.get("void") else ""
        hw.append((h["player_name"], f"{h.get('team_abbr', '')} vs. {h.get('opp_pitcher') or 'TBD'}",
                   h["confidence"], res))
    return {
        "sport": "MLB", "id": gid, "file": f"game-{gid}.html", "url": f"/mlb/game-{gid}.html",
        "date": p["date"], "start": p["start"], "label": label,
        "away": team("away"), "home": team("home"),
        "pick": p["pick"], "other": p["away"] if home_pick else p["home"], "prob": p["prob"],
        "final": final, "hit": p.get("correct") if final else None, "void": bool(p.get("void")),
        "ml": {"price": ml["price"], "book": ml["book_prob"], "value": ml.get("value"),
               "units": ml.get("units"), "won": ml.get("won")} if ml else None,
        "why": why,
        "facts": [sp_fact(p["away"], p.get("away_sp")), sp_fact(p["home"], p.get("home_sp"))],
        "hitters": hw, "note": lock_note(p),
    }


def mlb_games(team_history, history):
    """Every team pick in the shared game shape, newest last, with our hitter
    picks in each game."""
    by_game = defaultdict(list)
    for h in history.get("picks", []):
        if is_model_pick(h):
            by_game[(h["date"], str(h.get("game_id")))].append(h)
    return [mlb_game(p, by_game.get((p["date"], str(p["game_id"])), ())) for p in team_history.get("picks", [])]


def build_game_pages(games):
    cutoff = (NOW.date() - timedelta(days=GAME_PAGE_DAYS)).isoformat()
    return {g["file"]: page_shell(f"{g['away']['abbr']} @ {g['home']['abbr']}", None,
                                  extras.game_page_body(g, "games.html", "All of today's games"))
            for g in games if g["date"] >= cutoff}


def bb_game(p, sport, slug, logo_url, facts, name=None):
    """An NBA or CBB pick in the shared game shape (extras.py). logo_url(p,
    side) and name(p, side) give each team's logo and display name; facts are
    the sport's own matchup lines."""
    gid = str(p["game_id"])
    final = p.get("correct") is not None and not p.get("void")
    start = datetime.fromisoformat(p["start"]).astimezone(ET)
    label = " · ".join(x for x in (p.get("note") if sport == "CBB" else "", f"{start:%a, %b} {start.day}",
                                   f"{start:%-I:%M %p} ET") if x)
    proj = p.get("proj") or {}
    team = lambda side: {"abbr": p[side], "name": (name(p, side) if name else p.get(f"{side}_name")) or p[side],
                         "record": p.get(f"{side}_record") or "", "logo": logo_url(p, side),
                         "proj": proj.get(side), "score": p.get(f"{side}_pts") if final else None}
    ml = p.get("ml")
    return {
        "sport": sport, "id": gid, "file": f"game-{gid}.html", "url": f"/{slug}/game-{gid}.html",
        "date": p["date"], "start": p["start"], "label": label, "neutral": bool(p.get("neutral")),
        "away": team("away"), "home": team("home"),
        "pick": p["pick"], "other": p["away"] if p["pick"] == p["home"] else p["home"], "prob": p["prob"],
        "final": final, "hit": p.get("correct") if final else None, "void": bool(p.get("void")),
        "ml": {"price": ml["price"], "book": ml["book_prob"], "value": ml.get("value"),
               "units": ml.get("units"), "won": ml.get("won")} if ml else None,
        "why": [], "facts": facts(p), "hitters": [], "note": lock_note(p),
    }


def bb_game_pages(games, shell):
    cutoff = (NOW.date() - timedelta(days=GAME_PAGE_DAYS)).isoformat()
    return {g["file"]: shell(f"{g['away']['abbr']} {'vs' if g.get('neutral') else '@'} {g['home']['abbr']}", None,
                             extras.game_page_body(g, "index.html", "All of today's games"))
            for g in games if g["date"] >= cutoff}


def bb_home_parts(summary, picks, games):
    """Betting tab and Last night data for an NBA, NHL or CBB summary."""
    today = NOW.date().isoformat()
    summary["slate"] = [extras.slate_entry(g) for g in games
                        if g["date"] >= today and not g["final"] and not g["void"]]
    summary["units"] = game_units(picks)
    summary["last"] = extras.last_day(games)


def hitter_results(history):
    """{date: [{"name", "hit", "line"}]} for graded hitter picks, for Last night."""
    out = defaultdict(list)
    for h in sorted(graded(history.get("picks", [])), key=lambda h: -h.get("confidence", 0)):
        out[h["date"]].append({"name": h["player_name"], "hit": bool(h["got_hit"]),
                               "line": f"{h['hits']}-for-{h['at_bats']}"})
    return dict(out)


# ── Schedule tab and scoreboard strip ────────────────────────────────────────
# ESPN and the MLB Stats API abbreviate a few teams differently.
ABBR_ALIASES = moneyline.MLB_ALIASES


def _team_key(team):
    """(name, abbreviation) forms of an ESPN scoreboard team for matching a pick."""
    abbr = team.get("abbr", "")
    return team.get("name", ""), ABBR_ALIASES.get(abbr, abbr)


def team_pick_for(g, day_picks):
    """The team model's pick for an ESPN scoreboard game, matched by team names
    (or abbreviations), taking the closest first pitch for a doubleheader."""
    (an, aa), (hn, ha) = _team_key(g["away"]), _team_key(g["home"])
    cands = [p for p in day_picks
             if (p["away_name"], p["home_name"]) == (an, hn) or (p["away"], p["home"]) == (aa, ha)]
    if not cands:
        return None
    start = games_mod.start_et(g)
    return min(cands, key=lambda p: abs((datetime.fromisoformat(p["start"]) - start).total_seconds()))


def attach_picks(slate, history, team_history):
    """Each game gets the team model's pick and win chance ("NYY 58%"). A game
    without one falls back to the model's most likely hitter in it."""
    by_day, team_by_day = defaultdict(list), defaultdict(list)
    for p in history["picks"]:
        by_day[p["date"]].append(p)
    for p in team_history["picks"]:
        team_by_day[p["date"]].append(p)
    for g in slate["games"]:
        day = games_mod.start_et(g).date().isoformat()
        tp = team_pick_for(g, team_by_day.get(day, []))
        if tp:
            side = "home" if tp["pick"] == tp["home"] else "away"
            g["pick"] = {"text": f"{g[side]['abbr'] or tp['pick']} {tp['prob']:.0f}%",
                         "result": None if tp.get("void") or tp.get("correct") is None else bool(tp["correct"])}
            continue
        teams = {g["away"]["name"], g["home"]["name"]}
        cands = [p for p in by_day.get(day, []) if p.get("team") in teams and is_model_pick(p)]
        if not cands:
            continue
        p = max(cands, key=lambda p: p["confidence"])
        name = p["player_name"].split(" ", 1)
        short = f"{name[0][0]}. {name[1]}" if len(name) == 2 else p["player_name"]
        g["pick"] = {"text": f"{short} {p['confidence']:.0f}%",
                     "result": None if p.get("void") or p.get("got_hit") is None else bool(p["got_hit"])}
    return slate


# ── Model page ───────────────────────────────────────────────────────────────
FACTOR_LABELS = {
    "season_avg": ("Season batting average", ""),
    "recent_form_avg": ("Recent form", "batting average over his last games"),
    "ab_per_game": ("At-bats per game", "more trips to the plate, more chances"),
    "is_home": ("Home vs. away", ""),
    "platoon": ("Platoon edge", "batting against the opposite hand"),
    "park_factor": ("Ballpark", "how hitter-friendly the park is"),
    "opp_pitcher_era": ("Opposing starter's ERA", ""),
    "opp_pitcher_whip": ("Opposing starter's WHIP", "walks + hits per inning"),
    "opp_pitcher_k9": ("Opposing starter's strikeouts", "per nine innings"),
}


def next_weekday(weekday, hour_utc):
    """The next time a weekly UTC cron (weekday: Monday=0) fires, in ET."""
    now = datetime.now(ZoneInfo("UTC"))
    d = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    if d <= now:
        d += timedelta(days=7)
    return d.astimezone(ET)


def recipe_setup(recipe):
    seasons = recipe.get("seasons", 1)
    l2 = recipe.get("l2", 0.001)
    return [
        ("Learns from:", "the last season of games" if seasons == 1 else f"the last {seasons} seasons of games"),
        ("Ballparks:", "learns each park's effect from the games" if recipe.get("park") == "learned"
         else "uses a fixed park-factor table"),
        ("Smoothing:", "light, so strong patterns can show" if l2 <= 0.001 else "medium, to avoid chasing noise"),
    ]


def shares(weights):
    total = sum(abs(w) for w in weights.values()) or 1
    return {k: abs(w) / total for k, w in weights.items()}


def hit_model_html(model, runs):
    runs = list(reversed(runs))
    nxt = next_weekday(0, 8)
    rows = []
    for r in runs:
        label, tone = model_page.decision(r)
        chosen = r["best_recipe"] if r.get("switched_recipe") else (r.get("current_recipe") or r["best_recipe"])
        rows.append({
            "date": model_page.short_date(r["run_at"]), "data_through": model_page.short_date(r.get("data_through")),
            "tested": len(r.get("candidates", [])), "decision": label, "tone": tone, "reason": r["reason"].capitalize() + ".",
            "before": (r.get("live_model", {}).get("holdout") or {}).get("top10_hit_rate"),
            "after": chosen.get("top10_hit_rate") if r.get("deployed") else None,
        })
    last = runs[0] if runs else {}
    now_w = dict(zip(model.get("features", []), model.get("weights", [])))
    before_w = last.get("weights_before")
    now_s, before_s = shares(now_w), (shares(before_w) if before_w else {})
    factors = [{"label": FACTOR_LABELS.get(f, (f, ""))[0], "note": FACTOR_LABELS.get(f, (f, ""))[1],
                "now": now_s[f], "before": before_s.get(f), "fmt": lambda v: pct(v, 1)}
               for f in sorted(now_s, key=lambda f: -now_s[f])]
    trained = model.get("trained_at")
    spec = {
        "intro": "Every Monday it checks itself against the newest games and only changes when a new version "
                 "clearly predicts better.",
        "tiles": [
            (model_page.short_date(trained)[:-6] if trained else "-", "Last retrained",
             f"games through {model_page.short_date(model.get('trained_through'))}" if model.get("trained_through") else ""),
            (f"{model.get('training_rows', 0):,}", "Hitter-games learned from",
             " to ".join(model_page.short_date(d) for d in model.get("training_dates", []))),
            (nxt.strftime("%b %-d"), "Next check", nxt.strftime("Monday, %-I %p ET")),
            (rows[0]["decision"].split(" ")[0] if rows else "-", "Last decision",
             f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
        ],
        "setup": recipe_setup(model.get("recipe", {})) + [
            ("Looks at:", f"{len(now_w)} factors for every hitter, listed below"),
            ("Retrains:", "Mondays, only when new games have been played; in the offseason it waits"),
        ],
        "runs": rows,
        "score_name": "Top 10 hit rate",
        "score_fmt": lambda v: pct(v, 1),
        "higher_better": True,
        "factors": factors,
        "factors_note": "Share of influence: how much each factor moves a hit chance, relative to the others, "
                        "for a typical swing in that factor. Before is the model that was live until the last retrain.",
        "empty": "No retrains logged yet. The first one runs on the next Monday after new games.",
    }
    return model_page.render(spec)


TEAM_FACTOR_LABELS = {
    "home_field": ("Home field", "for the home team, before anything else"),
    "elo": ("Team rating (Elo) gap", "per 100 rating points"),
    "starters": ("Starting pitcher gap", "per run per 9 innings better than the other starter"),
    "bullpen": ("Bullpen ERA gap", "per run of bullpen ERA"),
}


def team_recipe_setup(recipe):
    k, carry = recipe.get("elo_k", 4), recipe.get("elo_carry", 0.67)
    years, shrink = recipe.get("years", 2), recipe.get("sp_shrink", 40)
    speed = "steady" if k <= 3 else "medium" if k <= 4 else "fast"
    return [
        ("Learns from:", f"the last {years} seasons of games"),
        ("Team ratings:", f"{speed} - one game moves a team's Elo rating only a few points, a bit more for "
                          f"a blowout"),
        ("Over the winter:", f"keeps {carry:.0%} of each team's rating; the rest resets toward average"),
        ("Starters:", f"ERA and FIP this season and past seasons, blended with {shrink} innings of a "
                      f"league-average starter so a few starts don't swing it"),
    ]


def team_model_html(model, runs):
    """The team model's section of the model page, from teams/model_weights.json
    and teams/model_history.json."""
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
    factors = [{"label": TEAM_FACTOR_LABELS.get(f, (f, ""))[0], "note": TEAM_FACTOR_LABELS.get(f, (f, ""))[1],
                "now": now_w[f], "before": before_w.get(f), "fmt": lambda v: f"{v:+.3f}"}
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
            ("Weekly", "Next check", "once 60+ new games are in; waits in the offseason"),
            (rows[0]["decision"].split(" ")[0] if rows else "-", "Last decision",
             f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
        ],
        "setup": team_recipe_setup(model.get("recipe", {})) + [
            ("Looks at:", f"{len(now_w)} factors for every game, listed below, with the day's probable starters"),
        ],
        "runs": rows,
        "score_name": "Better than guessing",
        "score_fmt": lambda v: pct(v, 1),
        "higher_better": True,
        "factors": factors,
        "factors_note": "Each number is how much that factor moves the home team's log-odds of winning (negative "
                        "helps the away team); 0.1 is about 2.5 points of win chance near a coin flip. Better than "
                        "guessing is how much less wrong (log loss) the model is than always giving the home team "
                        "its usual win rate. Before is the model that was live until the last retrain.",
        "empty": "No retrains logged yet. The first one runs about a week into the season.",
    }
    return model_page.render(spec, calendar=False)


def team_backtest(model):
    """The team model's backtest for its Accuracy tab, or None."""
    bt = model.get("backtest")
    if not bt:
        return None
    b = model.get("baselines", {})
    post = model.get("backtest_postseason")
    tw = bt["top3"]
    tiles = [
        (f"{bt['correct']}-{bt['games'] - bt['correct']}", f"{model['backtest_season']} backtest",
         f"{pct(bt['accuracy'], 1)} of games; model said {pct(bt['predicted_accuracy'], 1)}"),
        (pct(tw["accuracy"], 1), f"Top {TOP_GAMES} picks each day", f"{tw['correct']}-{tw['picks'] - tw['correct']}"),
        (f"{bt['log_loss']:.3f}", "Log loss", f"{b.get('home_rate_log_loss', 0):.3f} for home-team rate"),
    ]
    note = (f"Fit only on {model['trained_on'].replace(' to ', '-')} and never shown {model['backtest_season']}, "
            f"then used to pick all {bt['games']} regular-season games of {model['backtest_season']} with only "
            f"what was known that morning. The home team won {pct(b.get('home_team_accuracy'), 1)} of those "
            f"games, and team ratings alone picked {pct(b.get('elo_only_accuracy'), 1)}. Lower log loss is "
            f"better.")
    if post:
        note += f" In the postseason it went {post['correct']}-{post['games'] - post['correct']}."
    return {"subtitle": "How the team model did on a season it was never trained on", "tiles": tiles,
            "groups": backtest_months(bt), "rows": accuracy_page.band_rows(bt["bands"]), "note": note}


def build_accuracy(model, team_model, history, team_history):
    """The Accuracy tab, laid out like every sport's, once per model."""
    games = team_accuracy_spec(
        team_history["picks"], lambda d: d[:4], STRONG_GAME, prefix="acc-games",
        edges=[(.5, .55), (.55, .6), (.6, .65), (.65, 1.01)], backtest=team_backtest(team_model),
        cal_note="If the model is honest, each row's two percentages should be close. In baseball even strong "
                 "favorites lose often, and small rows swing a lot.")
    body = accuracy_page.switcher([("acc-hits", "Hit picks", accuracy_page.render(hit_accuracy_spec(history, model))),
                                   ("acc-games", "Game picks", accuracy_page.render(games))], "Models")
    return page_shell("Accuracy", "accuracy.html", body, charts=accuracy_page.has_charts(body))


def build_model(model, runs, team_model, team_runs):
    """How both models learn, one at a time."""
    team = (team_model_html(team_model, team_runs) if team_model.get("coef") else
            card("Team Model", "", '<div class="empty-state">The team model hasn\'t been trained yet.</div>'))
    body = accuracy_page.switcher([("model-hits", "Hit model", hit_model_html(model, runs)),
                                   ("model-games", "Team model", team)], "Models")
    return page_shell("Model", "model.html", body)


# ── Home page summary ────────────────────────────────────────────────────────
def games_summary(picks):
    """The team-winner half of MLB Edge for the home page's second MLB row:
    the latest day's surest game picks and the all-time game record."""
    out = {"heading": None, "picks": [], "record": None, "empty": "No game picks yet.",
           "result_labels": ["WIN", "LOSS"]}
    if not picks:
        return out
    latest = max(p["date"] for p in picks)
    out["heading"] = f"{'Today' if latest == NOW.date().isoformat() else 'Latest'}: {day_label(latest)}"
    top = sorted((p for p in picks if p["date"] == latest), key=lambda p: -p["prob"])[:TOP_GAMES]
    out["picks"] = [{"label": f"{p['pick']} over {p['away'] if p['pick'] == p['home'] else p['home']}",
                     "sub": f"{p['away']} @ {p['home']} · {first_pitch(p)} ET", "value": f"{p['prob']:.0f}%",
                     "result": None if p.get("void") or p.get("correct") is None else bool(p["correct"])}
                    for p in top]
    g = game_graded(picks)
    if g:
        w, l = game_wl(g)
        d = date.fromisoformat(min(p["date"] for p in g))
        out["record"] = {"value": f"{w}-{l}", "label": "picking which team wins", "sub": pct(w / len(g), 1),
                         "since": f"{d:%b} {d.day}, {d.year}"}
        out["season_record"] = season_record(g, lambda day: day[:4], game_wl)
        out["daily"] = daily_results(g, game_wl)
    out["ml_streak"] = ml_streak(picks)
    return out


def build_summary(history, model, team_history=None):
    """summary.json - the latest day's top three picks and the season record, for
    the card on the home page (ant56-arch.github.io, github.com/ant56-arch/ant56-arch.github.io)."""
    picks = history["picks"]
    summary = {"updated": NOW.isoformat(), "heading": None, "picks": [], "record": None,
               "empty": "No picks yet.", "retrained": model.get("trained_at"), "model_url": "model.html"}
    if not picks:
        summary["games"] = games_summary((team_history or {}).get("picks", []))
        add_home_parts(summary, history, team_history)
        return summary
    latest = max(p["date"] for p in picks)
    prefix = "Today" if latest == NOW.date().isoformat() else "Latest"
    summary["heading"] = f"{prefix}: {day_label(latest)}"
    top = sorted((p for p in picks if p["date"] == latest), key=lambda p: -p["confidence"])[:3]
    summary["picks"] = [{
        "label": p["player_name"], "sub": matchup(p),
        "value": f"{p['confidence']:.0f}%" if is_model_pick(p) else DASH,
        "result": None if p.get("void") or p.get("got_hit") is None else bool(p["got_hit"]),
    } for p in top]
    # The all-time record the Home tab leads with, never reset by season.
    g, hits, first = alltime(history)
    if g:
        d = date.fromisoformat(first)
        summary["record"] = {"value": f"{hits}-{len(g) - hits}", "label": "top hitters who got a hit",
                             "sub": pct(hits / len(g), 1), "since": f"{d:%b} {d.day}, {d.year}"}
        summary["season_record"] = season_record(g, lambda day: day[:4], hit_wl)
        summary["daily"] = daily_results(g, hit_wl)
    summary["games"] = games_summary((team_history or {}).get("picks", []))
    add_home_parts(summary, history, team_history)
    return summary


def add_home_parts(summary, history, team_history):
    """What the home site's Betting tab (best bets and units) and Last night
    strip read: games still to play, the running moneyline total and the
    latest day's results."""
    team_history = team_history or {"picks": []}
    games = mlb_games(team_history, history)
    today = NOW.date().isoformat()
    summary["slate"] = [extras.slate_entry(g) for g in games
                        if g["date"] >= today and not g["final"] and not g["void"]]
    summary["units"] = game_units(team_history["picks"])
    last = extras.last_day(games, hitter_results(history))
    summary["last"] = last


# ── Root pages ───────────────────────────────────────────────────────────────
def build_404():
    body = """<div class="error-body">
        <div class="error-code">404</div>
        <h1 class="error-title">Page not found</h1>
        <p>This page doesn't exist. It may have been moved or renamed.</p>
        <a class="btn-primary" href="index.html">Go to today's picks</a>
      </div>"""
    return page_shell("Page Not Found", None, body)


def main():
    history = load_json("picks_history.json", {"picks": []})
    slate = load_json(os.path.join("data", "slate.json"), None)
    model = load_json("model_weights.json", {})
    team_history = load_json(os.path.join("teams", "picks_history.json"), {"picks": []})
    team_model = load_json(os.path.join("teams", "model_weights.json"), {})
    games_slate = attach_picks(games_mod.load("mlb"), history, team_history)

    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR)
    pages = {
        "index.html": build_index(history, slate, team_history, games_slate["games"]),
        "players.html": build_players(history, slate, team_history),
        "games.html": build_games(team_history, games_slate["games"]),
        "history.html": moved("players.html#past", "Player Hits"),
        "accuracy.html": build_accuracy(model, team_model, history, team_history),
        "schedule.html": games_mod.schedule_redirect("mlb"),
        "model.html": build_model(model, load_json("model_history.json", {"runs": []})["runs"], team_model,
                                  load_json(os.path.join("teams", "model_history.json"), {"runs": []})["runs"]),
        "terms.html": games_mod.legal_redirect("terms"),
        "privacy.html": games_mod.legal_redirect("privacy"),
        "404.html": build_404(),
    }
    pages.update(build_game_pages(mlb_games(team_history, history)))
    for name, html in pages.items():
        with open(os.path.join(DIST_DIR, name), "w") as f:
            f.write(html)
    with open(os.path.join(DIST_DIR, "summary.json"), "w") as f:
        json.dump(build_summary(history, model, team_history), f, indent=1)
    games_mod.write_json(os.path.join(DIST_DIR, "games.json"), "mlb", games_slate, NOW.isoformat())
    write_assets(DIST_DIR)
    print(f"Built {len(pages)} pages in {DIST_DIR}")


if __name__ == "__main__":
    main()
