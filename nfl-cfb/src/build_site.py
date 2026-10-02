"""
build_site.py
Generates the static Edge website (dist/) from the processed data the
pipeline writes.

Two sports, same page structure, kept in separate subdirectories so each is
independently browsable and linkable:
  dist/nfl/...  - NFL Edge (unchanged behavior/content from before this
                  became multi-sport)
  dist/cfb/...  - College Football Edge, Power-conference + independent FBS
                  teams only, same modeling approach (see fit_cfb_model.py)
  dist/index.html - a plain redirect to nfl/index.html so old bookmarks/links
                  to the site root keep working with NFL as the default sport
  dist/<sport>/summary.json - this week's top picks and the season record,
                  read by the home page linking every site (ant56-arch.github.io)
Only dist/nfl/ and dist/cfb/ are published, as /nfl/ and /cfb/ of
ant56-arch.github.io (see publish_site.sh at the repo root); each carries its
own style.css and site.js.

Pages per sport (see SPORTS below for which apply to which sport):
  index.html    - Home: notable model-vs-market gaps, track record, and this
                  week's slate only (kept short - see teams.html for the rest
                  of the season)
  teams.html    - every game this season, week 1 through the postseason,
                  browsable via a dropdown - past weeks graded, future weeks
                  straight from the season's game_predictions.csv
  players.html  - player projections by category (Passing/Rushing/Receiving)
                  - NFL only, no college football player props in this pass
  history.html  - every graded week across all seasons (backfill included),
                  browsable via a dropdown (client-side, no per-week routing
                  needed for a site this size)
  accuracy.html - trend charts of our model's own accuracy vs Vegas's over time

Published to GitHub Pages by weekly-picks.yml. This script only builds the
dist/ directory - the workflow's own steps upload and deploy it.
"""

from html import escape
import math
import re
import sys
import pandas as pd
import numpy as np
import json
import os
import hashlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared"))
import assets  # noqa: E402
import extras  # noqa: E402
import games as games_mod  # noqa: E402
import model_page  # noqa: E402
import moneyline  # noqa: E402
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "processed")
TRACKING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tracking")
WEB_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "web")
DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "dist")

DASH = "-"

# Per-sport configuration - every page-building function below takes a
# `sport` dict as its first argument and reads file paths / display text
# from it, instead of the module-level constants this file used before it
# covered more than one sport.
SPORTS = {
    "nfl": {
        "slug": "nfl",
        "wordmark": "NFL",
        "tagline": "Model-driven NFL spreads, totals and player props, graded against the closing line every week.",
        "meta_description": "Model-driven NFL spreads, totals and player props, validated against the closing Vegas line every week.",
        "team_csv": "teams.csv",
        "team_abbr_col": "team_abbr", "team_name_col": "team_name", "team_color_col": "team_color", "team_color2_col": "team_color2", "team_logo_col": "team_logo_espn",
        "game_predictions_csv": "game_predictions.csv",
        "player_props_csv": "player_props.csv",
        "vegas_comparison_csv": "vegas_comparison.csv",
        "predictions_log_csv": "predictions_log.csv",
        "accuracy_summary_json": "accuracy_summary.json",
        "coefficients_json": "fitted_coefficients.json",
        "live_tracking_start_season": 2026,
        "ats_since_year": 2024,
        "data_source_text": "Play-by-play and schedules via nflverse. Vegas lines via DraftKings, through the-odds-api.com, where available.",
        "no_games_note": "",
    },
    "cfb": {
        "slug": "cfb",
        "wordmark": "CFB",
        "tagline": "Model-driven spreads and totals for Power-conference college football, graded against the closing line every week.",
        "meta_description": "Model-driven college football spreads and totals for the Power conferences, validated against the closing Vegas line every week.",
        "team_csv": "cfb_teams.csv",
        "team_abbr_col": "team", "team_short_col": "abbreviation", "team_color_col": "color", "team_color2_col": "alt_color", "team_logo_col": "logo",
        "game_predictions_csv": "cfb_game_predictions.csv",
        "player_props_csv": None,
        "vegas_comparison_csv": "cfb_vegas_comparison.csv",
        "predictions_log_csv": "cfb_predictions_log.csv",
        "accuracy_summary_json": "cfb_accuracy_summary.json",
        "coefficients_json": "fitted_cfb_coefficients.json",
        "live_tracking_start_season": 2026,
        "ats_since_year": 2026,
        "data_source_text": "Team efficiency (PPA, success rate, explosiveness) via CollegeFootballData.com. Vegas lines via the-odds-api.com, where available. Covers SEC, Big Ten, Big 12, ACC and FBS independent teams.",
        "no_games_note": "Covers Power-conference and independent FBS teams only.",
    },
}

# Fallback only, used if a sport's team CSV (fetched fresh each run) isn't
# there for some reason.
_FALLBACK_TEAM_COLOR = "#94a3b8"
_TEAM_INFO = {}

def team_info(sport):
    """Official team colors + logo URLs for this sport, from whatever CSV
    that sport's fetch step produced (data/raw/teams.csv for NFL via
    nflverse, data/raw/cfb_teams.csv for CFB via CollegeFootballData.com)."""
    slug = sport["slug"]
    if slug not in _TEAM_INFO:
        info = {}
        path = os.path.join(RAW_DIR, sport["team_csv"])
        if os.path.exists(path):
            df = pd.read_csv(path)
            short_col = sport.get("team_short_col")
            for _, r in df.iterrows():
                key = r[sport["team_abbr_col"]]
                info[key] = {
                    "color": r[sport["team_color_col"]], "color2": r[sport["team_color2_col"]],
                    "logo": espn_logo(r[sport["team_logo_col"]]),
                    "short": r[short_col] if short_col else key,
                    "name": r[sport["team_name_col"]] if sport.get("team_name_col") in df.columns else key,
                }
        _TEAM_INFO[slug] = info
    return _TEAM_INFO[slug]

def espn_logo(url):
    """CollegeFootballData.com's logo URLs name the ESPN team id, but some of
    its images (Miami, Washington, Indiana, Cincinnati, Texas Tech...) showed
    as blank squares on the site. ESPN serves the same logo by that id, the
    one the scoreboard strip already uses, so link that instead."""
    m = re.search(r"collegefootballdata\.com/logos/\d+/(\d+)\.png", str(url))
    return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{m.group(1)}.png" if m else url

def team_color(sport, abbr):
    return team_info(sport).get(abbr, {}).get("color", _FALLBACK_TEAM_COLOR)

def team_logo(sport, abbr):
    return team_info(sport).get(abbr, {}).get("logo", "")

def team_short(sport, name):
    """Short display name for a team - the identifier itself for NFL (its
    join key is already a 2-3 letter code), a real abbreviation for CFB
    (whose join key is the full school name, e.g. 'Mississippi State' -
    long full names in every stat table column made game tables overflow
    even on desktop, not just mobile)."""
    return team_info(sport).get(name, {}).get("short", name)

def matchup_bar(sport, away, home, right_html):
    """A single cell replacing separate Matchup/Kickoff columns: both teams'
    logos and short names, with `right_html` (kickoff time, or the final
    score once graded) anchored right."""
    away_logo, home_logo = team_logo(sport, away), team_logo(sport, home)
    away_label, home_label = team_short(sport, away), team_short(sport, home)
    away_img = f'<img class="team-logo" src="{away_logo}" alt="" loading="lazy" onerror="this.style.display=\'none\'">' if away_logo else ""
    home_img = f'<img class="team-logo" src="{home_logo}" alt="" loading="lazy" onerror="this.style.display=\'none\'">' if home_logo else ""
    return f"""<div class="matchup-content">
        <span class="matchup-team">{away_img}<span>{away_label}</span></span>
        <span class="matchup-at">@</span>
        <span class="matchup-team">{home_img}<span>{home_label}</span></span>
        <span class="matchup-right">{right_html}</span>
      </div>"""

def model_pick(row):
    """The pure, unblended model's own call for a game - favored team, margin,
    and win probability - as opposed to the market-blended 'sharp' numbers.
    Used everywhere the site claims something is genuinely OUR pick, since
    the blended line currently has a 0.0 weight on the model for spreads
    (see fitted_coefficients.json) and is therefore identical to Vegas."""
    home_favored = row["model_spread"] > 0
    favored_team = row["home_team"] if home_favored else row["away_team"]
    win_pct = row["model_home_win_prob"] if home_favored else 1 - row["model_home_win_prob"]
    return {
        "favored_team": favored_team,
        "favored_by": abs(row["model_spread"]),
        "win_pct": win_pct,
        "total": row["model_total"],
    }

def ml_view(sport, r):
    """A game's moneyline pick for display (see src/moneyline.py), from any
    row carrying the ml_* columns - a tracking-log row (locked at kickoff,
    graded once final) or a vegas_comparison row. None when the game has no
    book moneyline."""
    if r is None or pd.isna(r.get("ml_pick_side")) or pd.isna(r.get("ml_pick_price")):
        return None
    won, push = r.get("ml_won"), r.get("ml_push")
    result = None
    if pd.notna(won):
        result = "W" if won == 1 else "L"
    elif pd.notna(push) and push == 1:
        result = "P"
    other = r["away_team"] if r.get("ml_pick_side") == "home" else r["home_team"]
    return {
        "team": team_short(sport, r["ml_pick_team"]), "other": team_short(sport, other),
        "price": float(r["ml_pick_price"]),
        "text": f"{team_short(sport, r['ml_pick_team'])} {moneyline.format_price(r['ml_pick_price'])}",
        "our": round(float(r["ml_our_prob"]), 3), "book": round(float(r["ml_book_prob"]), 3),
        "edge": round(float(r["ml_edge"]), 3), "value": moneyline.is_value(r.get("ml_value")),
        "result": result, "units": round(float(r["ml_units"]), 2) if pd.notna(r.get("ml_units")) else None,
    }

def spread_pick(sport, r, sigma):
    """Our pick against the Vegas spread: the side our model's line says will
    cover Vegas's number, and the chance it does - how far our line is from
    Vegas's, over the model's usual miss (margin_std_dev), through the normal
    curve. None without a Vegas line."""
    vegas = r.get("vegas_home_favored_by")
    if pd.isna(vegas) or pd.isna(r.get("model_spread")) or not sigma:
        return None
    diff = float(r["model_spread"]) - float(vegas)
    home = diff >= 0
    line = -float(vegas) if home else float(vegas)
    line_text = "PK" if abs(line) < 0.05 else (f"+{line:.1f}" if line > 0 else f"{line:.1f}")
    return {"team": team_short(sport, r["home_team"] if home else r["away_team"]),
            "line": line_text,
            "prob": round(0.5 * (1 + math.erf(abs(diff) / sigma / math.sqrt(2))), 3)}

def spread_result(r):
    """How our spread pick did once final: True if our side covered the Vegas
    spread, False if not, None for a push, no pick or no final yet."""
    vegas, model, margin = r.get("vegas_home_favored_by"), r.get("model_spread"), r.get("actual_margin")
    if pd.isna(vegas) or pd.isna(model) or pd.isna(margin) or float(model) == float(vegas):
        return None
    cover = float(margin) - float(vegas)
    if cover == 0:
        return None
    return (cover > 0) == (float(model) > float(vegas))

def spread_sigma(sport):
    """The model's typical miss on the margin, in points (margin_std_dev)."""
    coefs = load_coefficients(sport)
    return coefs.get("coefficients", coefs).get("margin_std_dev")

def ml_payout(price):
    """What a price means in dollars: '$100 pays $1,600' / 'Bet $150 to win $100'."""
    price = float(price)
    if price >= 100:
        return f"$100 wins ${price:,.0f}"
    return f"Bet ${-price:,.0f} to win $100"

def ml_cell_html(ml):
    """The Moneyline cell, spelled out: which team to take and at what price,
    what the price pays, our win % vs the book's (vig removed), a VALUE tag at
    6+ points of edge, and W/L once graded. The bet is always the team our
    model picks to win."""
    if not ml:
        return f'<span class="faint">{DASH}</span>'
    tags = f' {pill("VALUE", "positive")}' if ml["value"] else ""
    if ml["result"] == "W":
        tags += f' {pill("W", "positive")}'
    elif ml["result"] == "L":
        tags += f' {pill("L", "danger")}'
    elif ml["result"] == "P":
        tags += f' {pill("NO DECISION", "market")}'
    lines = [ml_payout(ml["price"]),
             f'We give {ml["team"]} {ml["our"]:.0%}, the price implies {ml["book"]:.0%}']
    sub = "".join(f'<span class="ml-sub">{escape(line)}</span>' for line in lines)
    return (f'<span class="ml-pick"><span class="ml-line"><span class="accent">{ml["team"]} to win '
            f'{moneyline.format_price(ml["price"])}</span>{tags}</span>{sub}</span>')

_ASSET_VERSION = None

def asset_version():
    """A content hash of style.css/site.js, appended as a ?v= query string so
    a redeploy always busts stale browser/CDN caches of these files - without
    it, an HTML page can update (new markup, new classes) while a visitor's
    browser keeps serving its old cached stylesheet that doesn't know about
    them yet, making the site look broken until a hard refresh."""
    global _ASSET_VERSION
    if _ASSET_VERSION is None:
        h = hashlib.md5()
        for text in asset_files().values():
            h.update(text.encode("utf-8"))
        _ASSET_VERSION = h.hexdigest()[:10]
    return _ASSET_VERSION

def asset_files():
    """style.css and site.js, built from shared/ plus web/sport.css and
    web/sport.js (see shared/assets.py)."""
    return {"style.css": assets.style(os.path.join(WEB_SRC_DIR, "sport.css")),
            "site.js": assets.script(os.path.join(WEB_SRC_DIR, "sport.js"))}

def write_assets(out_dir):
    for name, text in asset_files().items():
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            f.write(text)

def load_data(sport):
    games_path = os.path.join(PROCESSED_DIR, sport["game_predictions_csv"])
    games = pd.read_csv(games_path) if os.path.exists(games_path) else pd.DataFrame()

    props = pd.DataFrame()
    if sport["player_props_csv"]:
        props_path = os.path.join(PROCESSED_DIR, sport["player_props_csv"])
        if os.path.exists(props_path):
            props = pd.read_csv(props_path)

    comparison = None
    comparison_path = os.path.join(PROCESSED_DIR, sport["vegas_comparison_csv"])
    if os.path.exists(comparison_path):
        comparison = pd.read_csv(comparison_path)

    accuracy_summary = None
    summary_path = os.path.join(TRACKING_DIR, sport["accuracy_summary_json"])
    if os.path.exists(summary_path):
        with open(summary_path) as f:
            accuracy_summary = json.load(f)
        if accuracy_summary.get("n_graded_games", 0) == 0:
            accuracy_summary = None

    log_path = os.path.join(TRACKING_DIR, sport["predictions_log_csv"])
    log = pd.read_csv(log_path) if os.path.exists(log_path) else pd.DataFrame()

    return games, props, comparison, accuracy_summary, log

def format_kickoff(weekday, gametime):
    if not weekday or pd.isna(weekday) or not gametime or pd.isna(gametime):
        return ""
    try:
        hour, minute = (int(x) for x in str(gametime).split(":"))
    except ValueError:
        return ""
    period = "AM" if hour < 12 else "PM"
    hour_12 = hour % 12 or 12
    return str(weekday)[:3] + " " + str(hour_12) + ":" + format(minute, "02d") + " " + period

def pill(text, style):
    return f'<span class="pill pill-{style}">{text}</span>'

FAVICON = ('data:image/svg+xml,'
    '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
    '%3Crect width=%2232%22 height=%2232%22 fill=%22%23121314%22/%3E'
    '%3Cpath d=%22M9 23V9h3.4l6.6 9.3V9H22v14h-3.4L12 13.6V23z%22 fill=%22%23e5793b%22/%3E'
    '%3C/svg%3E')

# MLB, NBA and CBB Edge are built from mlb-nba-cbb/ in the same repo and share
# this look; the sport switcher links out to them.
MLB_EDGE_URL = "https://ant56-arch.github.io/mlb/"
NBA_EDGE_URL = "https://ant56-arch.github.io/nba/index.html"
CBB_EDGE_URL = "https://ant56-arch.github.io/cbb/index.html"
# Every sport's games as a TV grid, on the home site (schedule.js there reads
# the games.json each sport publishes).
SCHEDULE_URL = "https://ant56-arch.github.io/schedule.html"
# The sport switcher's order on every Sports Edge site, after "All".
SPORT_TAB_ORDER = [("NFL", None), ("NBA", NBA_EDGE_URL), ("MLB", MLB_EDGE_URL),
                   ("NHL", "https://ant56-arch.github.io/nhl/index.html"), ("CFB", None),
                   ("CBB", CBB_EDGE_URL), ("Betting", "https://ant56-arch.github.io/bets.html"),
                   ("Schedule", SCHEDULE_URL)]
# The home page (index.html at the root of this repo) links every site
# and shows each one's summary.json; the switcher's first tab goes back to it.
HOME_URL = "https://ant56-arch.github.io/"
HOME_SPORT_TAB = f'<a class="sport-tab" href="{HOME_URL}">All</a>'


def sport_tabs(own_href, active=None):
    """The top bar's sport switcher in SPORT_TAB_ORDER. own_href(slug) is the
    link for NFL and CFB (built here); the other tabs link out."""
    tabs = HOME_SPORT_TAB
    for label, url in SPORT_TAB_ORDER:
        href = url or own_href(label.lower())
        if label == active:
            tabs += f'<a href="#" class="sport-tab active" aria-current="page">{label}</a>'
        else:
            tabs += f'<a href="{href}" class="sport-tab">{label}</a>'
    return tabs
# The Sports Edge brand mark in the top bar, same on every Edge site.
BRAND_MARK = ('<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 3h22l-8 26H1z" fill="#e5793b"/>'
              '<path transform="translate(4.3 0) skewX(-15)" d="M10 9h12v3.2h-8.4v2.3h7.4v3h-7.4v2.3H22V23H10z" '
              'fill="#121314"/></svg>')

def top_bar(sport_switcher):
    """The black network bar (brand + sport tabs). The scoreboard strip of
    every sport's games is on the home site only, to keep sport pages calm."""
    return f"""<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="{HOME_URL}">{BRAND_MARK}<span class="brand-name">Sports <span>Edge</span></span></a>
    <nav class="sport-switcher" aria-label="Sport">{sport_switcher}</nav>
  </div>
</header>"""

def page_shell(sport, title, active_tab, body_html):
    tabs = [
        ("index.html", "index", "Home"),
        ("teams.html", "teams", "Teams"),
    ]
    if sport["player_props_csv"]:
        tabs.append(("players.html", "players", "Players"))
    tabs += [
        ("history.html", "history", "History"),
        ("accuracy.html", "accuracy", "Accuracy"),
        ("model.html", "model", "Model"),
    ]
    nav = "".join(
        f'<a href="{href}" class="active" aria-current="page">{label}</a>' if tab == active_tab
        else f'<a href="{href}">{label}</a>'
        for href, tab, label in tabs
    )

    other_page = active_tab + ".html" if active_tab else "index.html"
    # The other football sport's tab keeps you on the same page when it has one.
    sport_switcher = sport_tabs(
        lambda slug: "../" + slug + "/" + (other_page if other_page != "players.html"
                                           or SPORTS[slug]["player_props_csv"] else "index.html"),
        active=sport["wordmark"])

    now = datetime.now(timezone.utc)
    generated = now.strftime("%b %d, %Y %H:%M UTC")
    ver = asset_version()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | {sport["wordmark"]} Edge</title>
<meta name="description" content="{sport["meta_description"]}">
<link rel="icon" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v={ver}">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
{top_bar(sport_switcher)}
<header class="masthead" data-sport="{sport["wordmark"]}">
  <div class="masthead-inner">
    <h1 class="wordmark">{sport["wordmark"]} <span>EDGE</span></h1>
    <div class="tagline">{sport["tagline"]}</div>
    <div class="updated-chip">Updated {generated}</div>
  </div>
</header>
<nav class="tabs" aria-label="Sections"><div class="tabs-inner">{nav}</div></nav>
<div class="wrap">
  <main id="main-content">
  {body_html}
  </main>
  <footer class="site-footer slim">
    <p class="footer-text">{sport["data_source_text"]} For entertainment only, not betting advice. Gambling problem?
      Call 1-800-GAMBLER.</p>
    <nav class="footer-links" aria-label="Site">
      <a href="model.html">How the model works</a>
      <a href="https://ant56-arch.github.io/terms.html">Terms</a>
      <a href="https://ant56-arch.github.io/privacy.html">Privacy</a>
      <a href="{HOME_URL}">All sites</a>
      <a href="https://github.com/ant56-arch/ant56-arch.github.io">Source code</a>
      <span>&copy; {now.year} {sport["wordmark"]} Edge</span>
    </nav>
  </footer>
</div>
<script src="site.js?v={ver}"></script>
</body>
</html>"""

def card(title, subtitle, body_html):
    sub = f'<div class="subtitle">{subtitle}</div>' if subtitle else ""
    return f"""<section class="card">
    <div class="card-header"><h2>{title}</h2>{sub}</div>
    <div class="card-body">{body_html}</div>
  </section>"""

def kick_sort_key(gameday, gametime, commence_time=None):
    """'YYYY-MM-DD HH:MM' in Eastern time, for ordering a week's games by
    kickoff: the schedule's own gametime when there is one, else the odds
    feed's commence_time (UTC), else just the date (sorted after that day's
    timed games)."""
    if gametime is not None and pd.notna(gametime) and pd.notna(gameday):
        hh, mm = (int(x) for x in str(gametime).split(":")[:2])
        return f"{str(gameday)[:10]} {hh:02d}:{mm:02d}"
    if commence_time is not None and pd.notna(commence_time):
        try:
            t = pd.Timestamp(commence_time)
            t = (t.tz_localize("UTC") if t.tzinfo is None else t).tz_convert("America/New_York")
            return t.strftime("%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            pass
    return f"{str(gameday)[:10]} 99:99" if gameday is not None and pd.notna(gameday) else "9999"

def et_time(ts):
    """'Sep 27, 12:05 PM ET' from a UTC timestamp, or None."""
    t = pd.to_datetime(ts, utc=True, errors="coerce")
    if pd.isna(t):
        return None
    t = t.tz_convert("America/New_York")
    return f"{t:%b} {t.day}, {t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'} ET"

def lock_note(set_at, locked, lock_at=None):
    """The line under a matchup saying when its lines and picks were taken:
    'Locked Sep 27, 12:05 PM ET' once they've locked (kickoff, or Friday 9 PM
    ET for a CFB weekend game), else 'Lines as of ... - lock at kickoff'."""
    when = et_time(set_at)
    if not when:
        return ""
    if locked:
        return f'<div class="lock-note locked">Locked {when}</div>'
    until = et_time(lock_at)
    return f'<div class="lock-note">Lines as of {when} &middot; lock {until or "at kickoff"}</div>'

def day_label(gameday):
    """'Saturday, Sep 26' from a YYYY-MM-DD date."""
    try:
        d = datetime.strptime(str(gameday)[:10], "%Y-%m-%d")
    except ValueError:
        return str(gameday)
    return f"{d:%A}, {d:%b} {d.day}"

def kick_time(g):
    """'8:15 PM ET' from a game's kickoff sort key, or '' without a time."""
    key = g.get("kick_sort") or ""
    if len(key) < 16 or key.endswith("99:99"):
        return ""
    hh, mm = int(key[11:13]), key[14:16]
    return f"{hh % 12 or 12}:{mm} {'AM' if hh < 12 else 'PM'} ET"

def game_pick(g):
    """The one pick a game row shows: our moneyline pick (team, price, our
    chance) when the book has a moneyline, else the team our model favors."""
    ml = g.get("ml")
    if ml:
        return {"team": ml["team"], "other": ml["other"], "prob": ml["our"], "value": ml["value"],
                "hit": {"W": True, "L": False}.get(ml["result"])}
    other = team_short_label(g, g["favored_team"])
    return {"team": g["favored_team"], "other": other, "prob": g["win_pct"], "value": False, "hit": g["correct"]}

def team_short_label(g, team):
    """The other team's short name in a game dict, given one team's."""
    return g["away_label"] if team == g["home_label"] else g["home_label"]

def pick_hit(r):
    """Whether our pick in a graded tracking-log game won: the moneyline pick
    when the book had one (None for a tie), else the team our model favored."""
    if pd.notna(r.get("ml_pick_side")) and pd.notna(r.get("ml_pick_price")):
        return None if pd.isna(r.get("ml_won")) else r["ml_won"] == 1
    return None if pd.isna(r.get("model_correct_pick")) else r["model_correct_pick"] == 1

def live_record(sport, log):
    """Our record since live tracking began, added up across seasons (never
    reset, never backfill): our pick to win in every graded game, the units
    from betting 1 unit on each moneyline pick, and our spread picks against
    Vegas. None before the first graded game."""
    if log is None or log.empty or "actual_margin" not in log.columns:
        return None
    done = log[(log["season"] >= sport["live_tracking_start_season"]) & log["actual_margin"].notna()]
    hits = [pick_hit(r) for _, r in done.iterrows()]
    wins, losses = hits.count(True), hits.count(False)
    if not wins + losses:
        return None
    ml = done[done["ml_pick_side"].notna() & done["ml_won"].notna()] if "ml_won" in done.columns else done.iloc[0:0]
    ats = [spread_result(r) for _, r in done.iterrows()
           if pd.notna(r.get("vegas_home_favored_by")) and r["model_spread"] != r["vegas_home_favored_by"]]
    first = pd.to_datetime(done["gameday"], errors="coerce").min()
    return {"wins": wins, "losses": losses, "pct": wins / (wins + losses),
            "since": f"{first:%b} {first.day}, {first.year}" if pd.notna(first) else None,
            "ml_n": len(ml), "units": float(ml["ml_units"].sum()) if len(ml) else None,
            "ats": (ats.count(True), ats.count(False))}

def record_band(sport, rec):
    """The Home tab's first panel: our all-time record, big."""
    eyebrow = f'<div class="rb-eyebrow">{sport["wordmark"]} Edge &middot; our picks to win</div>'
    if not rec:
        return f"""<section class="card record-card"><div class="record-band"><div>{eyebrow}
      <div class="rb-num rb-wait">Starts with the first final</div>
      <div class="rb-since">Every pick we post is graded once its game is final, and the record keeps adding up
        from there.</div></div></div></section>"""
    since = f"Since {rec['since']}. " if rec["since"] else ""
    side = []
    aw, al = rec["ats"]
    if aw + al:
        side.append((f"{aw}-{al}", "Against the spread", f"covered {aw / (aw + al):.0%}"))
    side_html = "".join(f'<div class="stat"><div class="stat-value">{v}</div><div class="stat-label">{l}</div>'
                        f'<div class="stat-sub">{s}</div></div>' for v, l, s in side)
    return f"""<section class="card record-card"><div class="record-band">
      <div>{eyebrow}
        <div class="rb-num">{rec["wins"]}-{rec["losses"]}<small>{rec["pct"]:.0%}</small></div>
        <div class="rb-since">{since}Every pick we've posted, graded once final. It keeps adding up and never resets.</div>
      </div>
      <div class="rb-side">{side_html}</div>
    </div></section>"""

def pct(x):
    return f"{x:.0%}" if x is not None else DASH

ML_EMPTY = "No moneyline picks graded yet this season."

def ml_record(sport, games, log):
    """(season, record) for the moneyline: this season's live picks only,
    graded from the tracking log - never backfill or past seasons."""
    season = display_season(sport, games, log)
    return season, moneyline.summarize(log, season)

def build_moneyline_block(season, ml, with_label=True):
    """Moneyline record tiles (W-L and Value picks), or the empty state until
    a pick this season has been graded. Units live on the home site's Betting tab."""
    label = f'<div class="section-label">Moneyline, {season}</div>' if with_label else ""
    if not ml:
        return label + f'<div class="empty-state">{ML_EMPTY}</div>'
    pushes = f", {ml['pushes']} no decision" if ml["pushes"] else ""
    v = ml["value"]
    stats = [
        (ml["record"], f"{season} moneyline", f"{ml['n_decided']} picks graded{pushes}"),
        (v["record"] if v["n_decided"] else DASH, "Value picks", "our chance 6+ points over the price's"),
    ]
    statline = '<div class="statline">' + "".join(
        f'<div class="stat"><div class="stat-value">{val}</div><div class="stat-label">{lab}</div>'
        f'<div class="stat-sub">{sub}</div></div>' for val, lab, sub in stats) + "</div>"
    note = ('<div class="table-footnote">Our moneyline pick in every game with a book moneyline, at the price '
            'locked at kickoff. Ties count as no decision. This season\'s live picks only. What betting them would '
            'have made is on the <a href="https://ant56-arch.github.io/bets.html">Betting tab</a>.</div>')
    return label + statline + note

TOP_PLAYERS = 10

def anytime_td_prob(rush_tds, rec_tds):
    """Chance a player scores at least one rushing or receiving TD, treating
    the projected TD count as a Poisson mean (passing TDs don't count)."""
    lam = (0 if pd.isna(rush_tds) else float(rush_tds)) + (0 if pd.isna(rec_tds) else float(rec_tds))
    return 1 - math.exp(-lam)

def build_players_page(sport, props):
    if not props.empty:
        props = props.copy()
        props["td_total"] = props.reindex(columns=["proj_rush_tds", "proj_rec_tds"]).fillna(0).sum(axis=1).round(2)
        props["td_prob"] = [f"{anytime_td_prob(r, c) * 100:.0f}%" for r, c in
                            zip(props.get("proj_rush_tds", np.nan), props.get("proj_rec_tds", np.nan))]
        for c in ("proj_rush_tds", "proj_rec_tds"):
            if c in props.columns:
                props[c] = props[c].fillna(0)
    def table(stat_cols, cat_id, active):
        if props.empty or stat_cols["sort"] not in props.columns:
            return ""
        top = props.dropna(subset=[stat_cols["sort"]]).sort_values(stat_cols["sort"], ascending=False).head(TOP_PLAYERS).reset_index(drop=True)
        if top.empty:
            return ""
        headers = "".join(f'<th data-sort-key="{c}" class="num">{h}</th>' for c, h in zip(stat_cols["display"], stat_cols["headers"]))
        rows = ""
        for _, p in top.iterrows():
            tag = ""
            if p.get("injury_status") and pd.notna(p.get("injury_status")) and p["injury_status"]:
                style = "primary" if p["injury_status"] == "Questionable" else "danger"
                tag = " " + pill(str(p["injury_status"]).upper(), style)
            mult = p.get(stat_cols.get("matchup_col", ""), np.nan)
            badge = ""
            if pd.notna(mult):
                if mult >= 1.08:
                    badge = " " + pill("SOFT MATCHUP", "positive")
                elif mult <= 0.92:
                    badge = " " + pill("TOUGH MATCHUP", "danger")
            cells = "".join(f'<td data-key="{c}" data-value="{p[c]}" data-label="{h}" class="num">{p[c]}</td>'
                            for c, h in zip(stat_cols["display"], stat_cols["headers"]))
            rows += f"""<tr>
              <td data-key="player" data-value="{p['player_name']}"><b>{p['player_name']}</b>{tag}<div class="muted" style="font-size:13px;">{p['team']} vs {p['opponent']}</div>{badge}</td>
              {cells}
            </tr>"""
        hidden = "" if active else " hidden"
        return f"""<div class="cat-panel" id="cat-{cat_id}"{hidden}>
        <table class="data responsive-stack" data-sortable>
          <thead><tr><th data-sort-key="player">Player</th>{headers}</tr></thead>
          <tbody>{rows}</tbody>
        </table></div>"""

    passing = table({"sort": "proj_pass_yards", "display": ["proj_pass_attempts", "proj_completions", "proj_pass_yards", "proj_pass_tds"],
                      "headers": ["Att", "Comp", "Yds", "TDs"], "matchup_col": "matchup_mult_pass"}, "passing", True)
    rushing = table({"sort": "proj_rush_yards", "display": ["proj_carries", "proj_rush_yards", "proj_rush_tds"],
                      "headers": ["Car", "Yds", "TDs"], "matchup_col": "matchup_mult_rush"}, "rushing", False)
    receiving = table({"sort": "proj_rec_yards", "display": ["proj_targets", "proj_receptions", "proj_rec_yards", "proj_rec_tds"],
                        "headers": ["Tgt", "Rec", "Yds", "TDs"], "matchup_col": "matchup_mult_rec"}, "receiving", False)
    scorers = table({"sort": "td_total", "display": ["proj_rush_tds", "proj_rec_tds", "td_prob"],
                     "headers": ["Rush TDs", "Rec TDs", "To score"]}, "td", False)

    if not (passing or rushing or receiving or scorers):
        body = '<div class="empty-state">No player projections available yet.</div>'
        return page_shell(sport, "Players", "players", card("Player Projections", "Top 10 per category", body))

    subtabs = f"""<div class="subtabs">
      <button type="button" class="subtab active" aria-pressed="true" data-target="cat-passing">Passing</button>
      <button type="button" class="subtab" aria-pressed="false" data-target="cat-rushing">Rushing</button>
      <button type="button" class="subtab" aria-pressed="false" data-target="cat-receiving">Receiving</button>
      <button type="button" class="subtab" aria-pressed="false" data-target="cat-td">TD Scorers</button>
    </div>"""
    body = subtabs + passing + rushing + receiving + scorers
    card_html = card("Player Projections", "Top 10 per category by projected yards. TD Scorers ranks the most likely rushing or receiving touchdowns (passing TDs don't count).", body)
    return page_shell(sport, "Players", "players", card_html)

def display_season(sport, games, log):
    """The season the Home and Teams pages show, so the site rolls over to a
    new season on its own: the season of the next game still to play (ignoring
    stale rows for old games that never got a result, like a cancelled game),
    else the latest season with a graded game."""
    if not games.empty and "season" in games.columns:
        upcoming = games
        if "gameday" in games.columns:
            cutoff = (datetime.now(timezone.utc) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
            upcoming = games[games["gameday"].astype(str).str[:10] >= cutoff]
        if not upcoming.empty:
            return int(upcoming["season"].min())
    if not log.empty and "actual_margin" in log.columns and log["actual_margin"].notna().any():
        return int(log.loc[log["actual_margin"].notna(), "season"].max())
    return sport["live_tracking_start_season"]

BOARD_NOTE = ("Scores are our projections, lines show the favored team, and the odds are our pick's moneyline. "
              "Value means our chance beats the odds by 6 points or more. Tap a game for more.")

def build_index_page(sport, games, log, comparison, espn=None):
    season = display_season(sport, games, log)
    weeks = assemble_season_weeks(sport, games, log, comparison, season)
    this_week_key = current_week_key(weeks)
    this_week = weeks.get(this_week_key) if this_week_key else None
    week_title = this_week["label"] if this_week else "Upcoming"
    week_games = this_week["games"] if this_week else []

    body = record_band(sport, live_record(sport, log))
    empty = f"No games available yet. {sport['no_games_note']}".strip() if not weeks else "No games this week."
    board = extras.game_board([nf_game(sport, g, espn) for g in week_games], empty=empty)
    body += extras.board_section(f"{week_title} games", BOARD_NOTE, board)
    return page_shell(sport, "Home", "index", body)

WEEK_TYPE_LABELS = {"WC": "Wild Card", "DIV": "Divisional", "CON": "Conf. Championship", "SB": "Super Bowl", "POST": "Postseason"}

def week_label(week, game_type=None):
    if game_type in WEEK_TYPE_LABELS:
        return WEEK_TYPE_LABELS[game_type]
    return f"Week {int(week)}"

def assemble_season_weeks(sport, games, log, comparison, season):
    """Every game for a season, grouped by week, already-played weeks merged
    with weeks still ahead. Already-played comes from the tracking log
    (graded); weeks still ahead come straight from that sport's
    game_predictions.csv, which already forecasts the rest of the season, not
    just the imminent week. Uses the pure model's own picks throughout (see
    model_pick()), not the market-mirroring blended line. Shared by both the
    Teams page (every week) and the Home page (just the current week)."""
    weeks = {}
    sigma = spread_sigma(sport)

    # A week's games can be split across "already played" and "still upcoming"
    # (e.g. Thursday night graded, Sunday/Monday not yet) - append into the
    # same week bucket rather than letting one loop overwrite the other's rows.
    def week_bucket(wk, game_type):
        key = f"w{int(wk)}"
        if key not in weeks:
            weeks[key] = {"label": week_label(wk, game_type), "week": int(wk), "games": []}
        return weeks[key]

    if not log.empty:
        graded = log[(log["actual_margin"].notna()) & (log["season"] == season)].copy()
    else:
        graded = pd.DataFrame(columns=["week", "home_team", "away_team"])
    already_graded = set(zip(graded["week"], graded["home_team"], graded["away_team"]))
    for wk, g in graded.groupby("week"):
        bucket = week_bucket(wk, g["game_type"].iloc[0] if "game_type" in g.columns else None)
        for _, r in g.sort_values("home_team").iterrows():
            pick = model_pick(r)
            has_vegas = pd.notna(r.get("vegas_home_favored_by"))
            vegas_favored = (r["home_team"] if r["vegas_home_favored_by"] > 0 else r["away_team"]) if has_vegas else None
            away_score = int(r["away_score"]) if pd.notna(r.get("away_score")) else None
            home_score = int(r["home_score"]) if pd.notna(r.get("home_score")) else None
            bucket["games"].append({
                "away_team": r["away_team"], "home_team": r["home_team"],
                "away_label": team_short(sport, r["away_team"]), "home_label": team_short(sport, r["home_team"]),
                "matchup_html": matchup_bar(sport, r["away_team"], r["home_team"], f"{away_score}-{home_score}"),
                "favored_team": team_short(sport, pick["favored_team"]), "favored_by": round(float(pick["favored_by"]), 1),
                "win_pct": round(float(pick["win_pct"]), 3), "total": round(float(pick["total"]), 1),
                "vegas_favored_team": team_short(sport, vegas_favored) if vegas_favored else None,
                "vegas_favored_by": round(float(abs(r["vegas_home_favored_by"])), 1) if has_vegas else None,
                "vegas_total": round(float(r["vegas_total"]), 1) if pd.notna(r.get("vegas_total")) else None,
                "graded": True, "home_score": home_score, "away_score": away_score,
                "correct": bool(r["model_correct_pick"]) if pd.notna(r.get("model_correct_pick")) else None,
                "ml": ml_view(sport, r), "spread": spread_pick(sport, r, sigma),
                "gameday": str(r.get("gameday"))[:10] if pd.notna(r.get("gameday")) else None,
                "kick_sort": kick_sort_key(r.get("gameday"), None, r.get("ml_commence_time")),
                "covered": spread_result(r),
                "lock_html": lock_note(r.get("lines_set_at"), True),
            })

    if not games.empty:
        upcoming = games[games["season"] == season].copy()
    else:
        upcoming = pd.DataFrame(columns=["week", "home_team", "away_team"])
    vegas_cols = None
    if comparison is not None and not comparison.empty:
        vegas_cols = comparison[["home_team", "away_team", "vegas_favored_team", "vegas_home_favored_by", "total_line"]]
    # Moneyline picks for games not yet graded: the tracking log's copy first
    # (frozen at kickoff, so a game in progress keeps its pre-game price),
    # else this run's comparison.
    ml_rows = {}
    if comparison is not None and not comparison.empty and "ml_pick_side" in comparison.columns:
        for _, c in comparison[comparison["ml_pick_side"].notna()].iterrows():
            ml_rows[(int(c["week"]), c["home_team"], c["away_team"])] = c
    if not log.empty and "ml_pick_side" in log.columns:
        for _, c in log[(log["season"] == season) & log["ml_pick_side"].notna()].iterrows():
            ml_rows[(int(c["week"]), c["home_team"], c["away_team"])] = c
    log_lines, log_rows = {}, {}
    if not log.empty and "vegas_home_favored_by" in log.columns:
        for _, c in log[(log["season"] == season) & log["vegas_home_favored_by"].notna()].iterrows():
            log_lines[(int(c["week"]), c["home_team"], c["away_team"])] = (c["vegas_home_favored_by"], c.get("vegas_total"))
            log_rows[(int(c["week"]), c["home_team"], c["away_team"])] = c
    # Games whose lines and picks have locked (CFB: Friday 9 PM ET for the
    # weekend; otherwise kickoff) show the numbers the tracking log locked in,
    # not whatever this run's model or odds say.
    log_locked = {}
    if not log.empty and "model_spread" in log.columns:
        cur = log[log["season"] == season]
        for _, c in cur[moneyline.kicked_off(cur, friday_lock=sport["slug"] == "cfb")].iterrows():
            log_locked[(int(c["week"]), c["home_team"], c["away_team"])] = c
    for wk, g in upcoming.groupby("week"):
        bucket = week_bucket(wk, g["game_type"].iloc[0] if "game_type" in g.columns else None)
        merged = g.merge(vegas_cols, on=["home_team", "away_team"], how="left") if vegas_cols is not None else g
        sort_cols = [c for c in ["gameday", "gametime"] if c in merged.columns]
        for _, r in merged.sort_values(sort_cols if sort_cols else "home_team").iterrows():
            if (r["week"], r["home_team"], r["away_team"]) in already_graded:
                continue  # stale/duplicate row - the tracking log already has the final result
            frozen = log_locked.get((int(r["week"]), r["home_team"], r["away_team"]))
            if frozen is not None:
                r = r.copy()
                for col in ("model_spread", "model_total", "model_home_win_prob"):
                    if pd.notna(frozen.get(col)):
                        r[col] = frozen[col]
                if pd.notna(frozen.get("vegas_home_favored_by")):
                    r["vegas_home_favored_by"], r["total_line"] = frozen["vegas_home_favored_by"], frozen.get("vegas_total")
                    r["vegas_favored_team"] = r["home_team"] if frozen["vegas_home_favored_by"] > 0 else r["away_team"]
            logged = log_rows.get((int(r["week"]), r["home_team"], r["away_team"]), {})
            pick = model_pick(r)
            locked = log_lines.get((int(r["week"]), r["home_team"], r["away_team"]))
            if pd.isna(r.get("vegas_home_favored_by")) and locked is not None:
                # Under way: the odds feed no longer lists it, so show the
                # line the tracking log locked in before kickoff.
                r = r.copy()
                r["vegas_home_favored_by"], r["total_line"] = locked
                r["vegas_favored_team"] = r["home_team"] if locked[0] > 0 else r["away_team"]
            has_vegas = pd.notna(r.get("vegas_home_favored_by"))
            kickoff = format_kickoff(r.get("weekday"), r.get("gametime"))
            bucket["games"].append({
                "away_team": r["away_team"], "home_team": r["home_team"],
                "away_label": team_short(sport, r["away_team"]), "home_label": team_short(sport, r["home_team"]),
                "matchup_html": matchup_bar(sport, r["away_team"], r["home_team"], kickoff or DASH),
                "favored_team": team_short(sport, pick["favored_team"]), "favored_by": round(float(pick["favored_by"]), 1),
                "win_pct": round(float(pick["win_pct"]), 3), "total": round(float(pick["total"]), 1),
                "vegas_favored_team": team_short(sport, r["vegas_favored_team"]) if has_vegas else None,
                "vegas_favored_by": round(float(abs(r["vegas_home_favored_by"])), 1) if has_vegas else None,
                "vegas_total": round(float(r["total_line"]), 1) if has_vegas and pd.notna(r.get("total_line")) else None,
                "graded": False, "home_score": None, "away_score": None, "correct": None,
                "ml": ml_view(sport, ml_rows.get((int(r["week"]), r["home_team"], r["away_team"]))),
                "spread": spread_pick(sport, r, sigma), "covered": None,
                "gameday": str(r.get("gameday"))[:10] if pd.notna(r.get("gameday")) else None,
                "kick_sort": kick_sort_key(r.get("gameday"), r.get("gametime"), r.get("ml_commence_time")),
                "lock_html": lock_note(logged.get("lines_set_at"), frozen is not None,
                                       moneyline.lock_times([logged.get("ml_commence_time")], [logged.get("gameday")],
                                                            sport["slug"] == "cfb").iloc[0]),
            })

    # Pre-rendered for the Teams page, whose table site.js draws client-side.
    for wk in weeks.values():
        for g in wk["games"]:
            g["ml_html"] = ml_cell_html(g["ml"])
            g["id"] = re.sub(r"[^a-z0-9]+", "-", f"{season}-{wk['week']}-{g['away_team']}-{g['home_team']}".lower()).strip("-")
            g["file"] = f"game-{g['id']}.html"
            g["week_label"], g["week"] = wk["label"], wk["week"]
    return weeks

def current_week_key(weeks):
    """The week to default to: the earliest one with a game not yet played.
    Falls back to the earliest week overall if the whole season is graded."""
    ordered = sorted(weeks.items(), key=lambda kv: kv[1]["week"])
    for key, wk in ordered:
        if any(not g["graded"] for g in wk["games"]):
            return key
    return ordered[0][0] if ordered else None

def build_teams_page(sport, games, log, comparison):
    season = display_season(sport, games, log)
    weeks = assemble_season_weeks(sport, games, log, comparison, season)

    if not weeks:
        empty_note = f' {sport["no_games_note"]}' if sport.get("no_games_note") else ""
        body = card("Teams", f"Every {season} matchup, picked and graded", f'<div class="empty-state">No games available yet.{empty_note}</div>')
        return page_shell(sport, "Teams", "teams", body)

    week_order = [k for k, _ in sorted(weeks.items(), key=lambda kv: kv[1]["week"])]
    teams_json = json.dumps({"week_order": week_order, "weeks": weeks, "default_week": current_week_key(weeks)})
    body = card("Teams", f"Every {season} matchup from week 1 through the postseason, picked by our model and graded once final",
                '<select id="teams-week-select" class="week-picker"></select><div id="teams-week-content" style="margin-top:16px;"></div>'
                f'<script>const TEAMS_DATA = {teams_json};</script>')
    return page_shell(sport, "Teams", "teams", body)

def build_history_page(sport, log):
    graded = log[log["actual_margin"].notna()].copy() if not log.empty else log
    if graded.empty:
        body = card("History", "Every graded week, once there's one to show", '<div class="empty-state">No games graded yet.</div>')
        return page_shell(sport, "History", "history", body)

    graded = graded.sort_values(["season", "week"])
    weeks = {}
    week_order = []
    for (season, week), g in graded.groupby(["season", "week"]):
        key = f"{int(season)}-{int(week)}"
        week_order.append(key)
        games_list = []
        for _, r in g.iterrows():
            def pick_str(spread_col):
                spread = r[spread_col]
                if pd.isna(spread):
                    return DASH
                team = r["home_team"] if spread > 0 else r["away_team"]
                return f"{team_short(sport, team)} -{abs(spread):.1f}"
            games_list.append({
                "away_team": team_short(sport, r["away_team"]), "home_team": team_short(sport, r["home_team"]),
                "away_score": int(r["away_score"]) if pd.notna(r.get("away_score")) else None,
                "home_score": int(r["home_score"]) if pd.notna(r.get("home_score")) else None,
                "model_pick": pick_str("model_spread"), "model_correct": bool(r["model_correct_pick"]) if pd.notna(r.get("model_correct_pick")) else None,
                "vegas_pick": pick_str("vegas_home_favored_by"), "vegas_correct": bool(r["vegas_correct_pick"]) if pd.notna(r.get("vegas_correct_pick")) else None,
            })
        weeks[key] = {"label": f"{int(season)}, Week {int(week)}", "games": games_list}

    history_json = json.dumps({"week_order": week_order, "weeks": weeks})
    body = card("History", "Every graded week. Choose a week to see how the picks did.",
                f'<select id="week-select" class="week-picker"></select><div id="week-content" style="margin-top:16px;"></div>'
                f'<script>const HISTORY_DATA = {history_json};</script>')
    return page_shell(sport, "History", "history", body)

def build_moneyline_card(sport, games, log):
    """Accuracy tab: this season's moneyline record and every graded pick."""
    season, ml = ml_record(sport, games, log)
    body = build_moneyline_block(season, ml, with_label=False)
    if ml:
        picks = log[(log["season"] == season) & log["ml_pick_side"].notna()
                    & (log["ml_won"].notna() | (log["ml_push"] == 1))].sort_values(["week", "gameday"], ascending=False)
        rows = ""
        for _, r in picks.iterrows():
            view = ml_view(sport, r)
            rows += f"""<tr>
          <td>{week_label(r["week"], r.get("game_type"))}<div class="faint" style="font-size:13px;">{team_short(sport, r["away_team"])} @ {team_short(sport, r["home_team"])}, final {int(r["away_score"])}-{int(r["home_score"])}</div></td>
          <td data-label="Pick" class="num ml-cell">{ml_cell_html(view)}</td>
        </tr>"""
        body += f"""<table class="data responsive-stack">
      <thead><tr><th>Game</th><th class="num">Pick</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>"""
    return card("Moneyline Record", f"{season} moneyline picks and the price each one locked at", body)

def build_accuracy_page(sport, log, games=None):
    games = games if games is not None else pd.DataFrame()
    ml_card = build_moneyline_card(sport, games, log)
    live_start = sport["live_tracking_start_season"]
    graded = log[log["actual_margin"].notna()].copy() if not log.empty else log
    if not graded.empty:
        graded = graded[graded["season"] >= live_start]
    if graded.empty:
        body = card("Accuracy Over Time", "Weekly trend, us vs. the market",
                     '<div class="empty-state">No live-tracked games graded yet. Check back once the '
                     f'{live_start} season starts.</div>')
        return page_shell(sport, "Accuracy", "accuracy", ml_card + body)

    graded = graded.sort_values(["season", "week"])
    # "model_*" here too, not "sharp_*" - sharp is the market-blended line,
    # which for spreads has a 0.0 model weight and is therefore identical to
    # Vegas every week. Charting it as "Us" would just plot Vegas twice.
    weekly = graded.groupby(["season", "week"]).agg(
        model_accuracy=("model_correct_pick", "mean"), vegas_accuracy=("vegas_correct_pick", "mean"),
        model_spread_mae=("model_spread_error", "mean"), vegas_spread_mae=("vegas_spread_error", "mean"),
        model_brier=("model_brier", "mean"), vegas_brier=("vegas_brier", "mean"),
        n=("model_correct_pick", "size"),
    ).reset_index()

    labels = [f"{int(s)} Wk{int(w)}" for s, w in zip(weekly["season"], weekly["week"])]
    data = {
        "labels": labels,
        "us_accuracy": weekly["model_accuracy"].round(3).tolist(), "vegas_accuracy": weekly["vegas_accuracy"].round(3).tolist(),
        "us_spread_mae": weekly["model_spread_mae"].round(2).tolist(), "vegas_spread_mae": weekly["vegas_spread_mae"].round(2).tolist(),
        "us_brier": weekly["model_brier"].round(4).tolist(), "vegas_brier": weekly["vegas_brier"].round(4).tolist(),
    }
    charts_html = "".join(
        f'<div class="chart-card" data-state="loading"><canvas id="{cid}" height="90"></canvas></div>'
        for cid in ["chart-accuracy", "chart-spread-mae", "chart-brier"]
    )
    body = card("Accuracy Over Time",
                f"Week-by-week results for {int(weekly['n'].sum())} live-picked games since the start of {live_start}: our model's picks against the market",
                charts_html + f'<script>const ACCURACY_DATA = {json.dumps(data)};</script>')
    return page_shell(sport, "Accuracy", "accuracy", ml_card + body)

def root_page_shell(title, body_html):
    """Shell for the pages that live at the site root rather than under a
    sport (404, Terms, Privacy) - same top bar and footer links, no sport
    hero or section tabs."""
    ver = asset_version()
    now = datetime.now(timezone.utc)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | NFL Edge</title>
<link rel="icon" href="{FAVICON}">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v={ver}">
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
{top_bar(sport_tabs(lambda slug: slug + "/index.html"))}
<div class="wrap">
  <main id="main-content">
  {body_html}
  </main>
  <footer class="site-footer">
    <nav class="footer-links" aria-label="Site" style="border-top:none;margin-top:0;padding-top:0;">
      <a href="https://ant56-arch.github.io/terms.html">Terms of Use</a>
      <a href="https://ant56-arch.github.io/privacy.html">Privacy Policy</a>
      <a href="{HOME_URL}">All sites</a>
      <a href="https://github.com/ant56-arch/ant56-arch.github.io">Source code</a>
      <span>&copy; {now.year} NFL Edge</span>
    </nav>
  </footer>
</div>
</body>
</html>"""

def build_404_page():
    body = """<div class="error-body">
        <div class="error-code">404</div>
        <h1 class="error-title">Page not found</h1>
        <p>This page doesn't exist. It may have been moved or renamed.</p>
        <a class="btn-primary" href="nfl/index.html">Go to NFL Edge</a>
      </div>"""
    return root_page_shell("Page Not Found", body)

def build_redirect_page():
    """dist/index.html - a plain redirect to the default sport (NFL) so old
    bookmarks/links to the site root keep working now that content lives
    under nfl/ and cfb/ subdirectories."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=nfl/index.html">
<link rel="canonical" href="nfl/index.html">
<title>NFL Edge</title>
</head>
<body>
<p>Redirecting to <a href="nfl/index.html">NFL Edge</a>&hellip;</p>
</body>
</html>"""

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Factor labels for the Model tab: (label, note, scale, format). Rate gaps are
# fractions in the fit, so they're shown per 0.1 (ten percentage points).
FACTOR_LABELS = {
    "epa_diff_coef": ("Play efficiency gap (EPA)", "points of margin per 0.1 EPA per play", 0.1, "pts"),
    "ppa_diff_coef": ("Play efficiency gap (PPA)", "points of margin per 0.1 PPA per play", 0.1, "pts"),
    "third_down_weight": ("Third-down conversion gap", "points per 10-point gap in third-down rate", 0.1, "pts"),
    "redzone_weight": ("Red-zone touchdown gap", "points per 10-point gap in red-zone TD rate", 0.1, "pts"),
    "explosive_weight": ("Explosive-play gap", "points per 10-point gap in explosive-play rate", 0.1, "pts"),
    "sack_weight": ("Sack rate gap", "points per 10-point gap in sack rate", 0.1, "pts"),
    "success_rate_weight": ("Success rate gap", "points per 10-point gap in success rate", 0.1, "pts"),
    "explosiveness_weight": ("Explosiveness gap", "points per 0.1 gap in explosiveness", 0.1, "pts"),
    "points_rating_weight": ("Power rating gap", "points of margin per point of schedule-adjusted power rating gap", 1, "pts"),
    "success_rating_weight": ("Success rate gap (schedule-adjusted)", "points per 10-point gap in success rate", 0.1, "pts"),
    "qb_weight": ("Starting QB gap", "points per 0.1 EPA per dropback between the two starters", 0.1, "pts"),
    "home_field_advantage": ("Home field", "points for the home team", 1, "pts"),
    "margin_std_dev": ("Game-to-game swing", "how many points results typically miss by", 1, "plain"),
    "blend_weight_on_model_winprob": ("Model's say in the win chance", "the rest comes from the Vegas line", 1, "share"),
    "blend_weight_on_model_spread": ("Model's say in the spread", "the rest comes from the Vegas line", 1, "share"),
    "blend_weight_on_model_total": ("Model's say in the total", "the rest comes from the Vegas line", 1, "share"),
}

def next_weekly(weekday, hour_utc):
    """The next time a weekly UTC cron (weekday: Monday=0) fires, as UTC."""
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    d = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d if d > now else d + timedelta(days=7)

def load_model_runs(sport):
    path = os.path.join(TRACKING_DIR, "model_history.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [r for r in json.load(f).get("runs", []) if r.get("sport") == sport["slug"]]

def load_coefficients(sport):
    path = os.path.join(MODELS_DIR, sport["coefficients_json"])
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)

def build_model_page(sport):
    model = load_coefficients(sport)
    runs = list(reversed(load_model_runs(sport)))
    rows = []
    for r in runs:
        label, tone = model_page.decision(r)
        chosen = r["best_candidate"] if r.get("switched_recipe") else (r.get("current_recipe_refit_on_holdout") or r["best_candidate"])
        rows.append({
            "date": model_page.short_date(r["run_at"]), "data_through": model_page.short_date(r.get("data_through")),
            "tested": len(r.get("candidates", [])), "decision": label, "tone": tone, "reason": r["reason"].capitalize() + ".",
            "before": (r.get("live_model_on_holdout") or {}).get("accuracy"),
            "after": chosen.get("accuracy") if r.get("deployed") else None,
        })
    last = runs[0] if runs else {}
    now_w = model_page_weights(model)
    before_w = last.get("weights_before") or {}
    factors = []
    for key, (label, note, scale, kind) in FACTOR_LABELS.items():
        if key not in now_w:
            continue
        fmt = ((lambda v: f"{v:.0%}") if kind == "share" else (lambda v: f"{v:+.1f} pts") if kind == "pts"
               else (lambda v: f"{v:.1f} pts"))
        factors.append({"label": label, "note": note, "now": now_w[key] * scale,
                        "before": before_w[key] * scale if key in before_w else None, "fmt": fmt})
    recipe = model.get("recipe", {})
    seasons = model.get("train_seasons", [])
    since = (f"every season since {seasons[0]}" if recipe.get("seasons") == "all" and seasons
             else f"the last {recipe.get('seasons')} seasons" if recipe.get("seasons") else "all past seasons")
    half = recipe.get("team_half_life")
    nxt = next_weekly(1, 10)
    trained = model.get("fitted_at")
    spec = {
        "intro": "Every Tuesday it checks itself against the newest games and only changes when a new version "
                 "clearly predicts better.",
        "tiles": [
            (model_page.short_date(trained)[:-6] if trained else DASH, "Last retrained",
             f"games through {model_page.short_date(model.get('trained_through'))}" if model.get("trained_through") else ""),
            (f"{model.get('n_games_used', 0):,}", "Games learned from", f"{seasons[0]} to {seasons[-1]}" if seasons else ""),
            (nxt.strftime("%b %-d"), "Next check", "Tuesday morning, every week"),
            (rows[0]["decision"].split(" ")[0] if rows else DASH, "Last decision",
             f"{rows[0]['tested']} versions tested" if rows else "no retrains yet"),
        ],
        "setup": [
            ("Learns from:", since),
            ("Team ratings:", f"adjusted for who each team played, plus the two starting QBs; a game's weight "
                              f"halves every {recipe['rating_half_life']} weeks")
            if recipe.get("rating_half_life") else
            ("Team form:", f"recent games count most - a game's weight halves every {half} games" if half
             else "every game this season counts the same"),
            ("Sharp line:", "blends the model with the Vegas line; the last rows below show how much say the model gets"),
            ("Retrains:", "Tuesdays, only when new games have been played; in the offseason it waits"),
        ],
        "runs": rows,
        "score_name": "Picked right",
        "score_fmt": lambda v: f"{v:.1%}",
        "higher_better": True,
        "factors": factors,
        "factors_note": "Points are how much each factor moves the predicted margin toward the team that has the "
                        "edge in it. Before is the model that was live until the last retrain.",
        "empty": "No retrains logged yet. The first one runs on the next Tuesday after new games.",
    }
    return page_shell(sport, "Model", "model", model_page.render(spec))

def model_page_weights(model):
    out = dict(model.get("coefficients", {}))
    out.update({k: v for k, v in model.items() if k.startswith("blend_weight_on_")})
    return out

# ── Game pages and the home site's Betting tab and Last night strip ─────────
ET = ZoneInfo("America/New_York")


def espn_match(sport, espn, away, home):
    """The game on ESPN's scoreboard (espn: its games) matching one of ours,
    the way attach_game_picks matches them, or None."""
    if not espn:
        return None
    a, h = espn_keys_for(sport, away), espn_keys_for(sport, home)
    return next((eg for eg in espn if a & espn_team_keys(eg["away"]) and h & espn_team_keys(eg["home"])), None)


def nf_game(sport, g, espn=None):
    """A game from assemble_season_weeks in the shared game shape (extras.py),
    with what its card on the Home tab shows: projected points from our spread
    and total, the lines strip, and TV, stadium and records from ESPN."""
    pick, ml, sp = game_pick(g), g.get("ml"), g.get("spread")
    key = g.get("kick_sort") or ""
    start = extras.iso_et(key[:10], key[11:16], ET) if len(key) >= 16 and not key.endswith("99:99") else None
    day = pd.to_datetime(g.get("gameday"), errors="coerce")
    label = " · ".join(x for x in (g.get("week_label"), f"{day:%a, %b} {day.day}" if pd.notna(day) else "",
                                   kick_time(g)) if x)
    info = team_info(sport)
    eg = games_mod.card_info(espn_match(sport, espn, g["away_team"], g["home_team"]))
    espn_rec = dict(zip(("away", "home"), eg.get("records", ("", ""))))
    home_margin = g["favored_by"] if g["favored_team"] == g["home_label"] else -g["favored_by"]
    proj = {"home": (g["total"] + home_margin) / 2, "away": (g["total"] - home_margin) / 2}
    team = lambda side: {"abbr": g[f"{side}_label"], "name": info.get(g[f"{side}_team"], {}).get("name", g[f"{side}_team"]),
                         "record": espn_rec[side],
                         "logo": team_logo(sport, g[f"{side}_team"]), "proj": proj[side],
                         "score": g[f"{side}_score"] if g["graded"] else None}
    facts = [("Our spread", f'{escape(g["favored_team"])} -{g["favored_by"]:.1f}', ""),
             ("Vegas spread", f'{escape(g["vegas_favored_team"])} -{g["vegas_favored_by"]:.1f}' if g["vegas_favored_team"]
              else '<span class="faint">No line posted</span>', "")]
    if sp:
        cover = ""
        if g["graded"] and g.get("covered") is not None:
            cover = " " + (pill("COVERED", "positive") if g["covered"] else pill("DIDN'T COVER", "danger"))
        facts.append(("Spread pick", f'{escape(sp["team"])} {sp["line"]}{cover}', f'{sp["prob"]:.0%} chance to cover'))
    facts.append(("Total points", f'{g["total"]:.1f}', f'Vegas {g["vegas_total"]:.1f}' if g.get("vegas_total") else ""))
    if g["vegas_favored_team"]:
        # How far our line is from Vegas's, toward our pick: the model's reason to like it more (or less) than the market.
        ours = g["favored_by"] if g["favored_team"] == pick["team"] else -g["favored_by"]
        vegas = g["vegas_favored_by"] if g["vegas_favored_team"] == pick["team"] else -g["vegas_favored_by"]
        facts.append(("Our line vs. Vegas", f"{abs(ours - vegas):.1f} points {'more' if ours >= vegas else 'less'}",
                      f"on {pick['team']} than the Vegas spread"))
    return {
        "sport": sport["wordmark"], "id": g["id"], "file": g["file"], "url": f'/{sport["slug"]}/{g["file"]}',
        "date": g.get("gameday") or "", "start": start, "label": label, "week": g["week"],
        "away": team("away"), "home": team("home"),
        "pick": pick["team"], "other": pick["other"], "prob": pick["prob"] * 100,
        "final": bool(g["graded"]), "hit": pick["hit"] if g["graded"] else None, "void": False,
        "ml": {"price": ml["price"], "book": ml["book"] * 100, "value": ml["value"], "units": ml["units"],
               "won": {"W": True, "L": False}.get(ml["result"])} if ml else None,
        "why": [], "facts": facts, "hitters": [], "note": g.get("lock_html", ""),
        "tv": eg.get("tv", ""), "venue": eg.get("venue", ""), "lines": card_lines(g),
    }


def card_lines(g):
    """The strip under the teams on a game card: Vegas's line, ours, and our
    pick against Vegas's with its chance to cover (and whether it did)."""
    m = extras.MINUS
    vegas = (f'{escape(g["vegas_favored_team"])} {m}{g["vegas_favored_by"]:.1f}' if g["vegas_favored_team"]
             else '<span class="faint">None yet</span>')
    lines = [("Vegas line", vegas, "vegas", ""), ("Our line", f'{escape(g["favored_team"])} {m}{g["favored_by"]:.1f}', "ours", "")]
    sp = g.get("spread")
    if sp:
        cover = ""
        if g["graded"] and g.get("covered") is not None:
            cover = " " + (pill("COVERED", "positive") if g["covered"] else pill("MISSED", "danger"))
        lines.append(("Spread pick", f'{escape(sp["team"])} {sp["line"].replace("-", m)}{cover}', "",
                      f'{sp["prob"]:.0%} to cover'))
    else:
        lines.append(("Spread pick", '<span class="faint">After the line</span>', "", ""))
    return lines


def season_games(sport, games, log, comparison):
    weeks = assemble_season_weeks(sport, games, log, comparison, display_season(sport, games, log))
    return [nf_game(sport, g) for wk in sorted(weeks.values(), key=lambda w: w["week"]) for g in wk["games"]]


def ml_units(sport, log):
    """Every graded live moneyline pick, for the Betting tab's units."""
    if log is None or log.empty or "ml_won" not in log.columns:
        return None
    done = log[(log["season"] >= sport["live_tracking_start_season"]) & log["ml_won"].notna() & log["ml_units"].notna()]
    return extras.units_summary((str(r["gameday"])[:10], float(r["ml_units"]), r["ml_won"] == 1,
                                 float(r["ml_pick_price"]) if pd.notna(r.get("ml_pick_price")) else None,
                                 moneyline.is_value(r.get("ml_value")))
                                for _, r in done.iterrows())


def build_game_pages(sport, ngames):
    return {g["file"]: page_shell(sport, f"{g['away']['abbr']} @ {g['home']['abbr']}", None,
                                  extras.game_page_body(g, "index.html", "All of this week's games"))
            for g in ngames}


def add_home_parts(sport, summary, ngames, log):
    """What the home site's Betting tab (best bets and units) and Last night
    strip read: this week's games still to play, the running moneyline total
    and the latest day's results."""
    week = min((g["week"] for g in ngames if not g["final"]), default=None)
    summary["slate"] = [extras.slate_entry(g) for g in ngames if not g["final"] and g["week"] == week]
    summary["units"] = ml_units(sport, log)
    summary["last"] = extras.last_day(ngames)


def build_summary(sport, games, log, comparison, accuracy_summary):
    """<sport>/summary.json - the current week's three most confident model
    picks (games not yet played first) and the same season record the Track
    Record card leads with, for this sport's card on the home page."""
    weeks = assemble_season_weeks(sport, games, log, comparison, display_season(sport, games, log))
    key = current_week_key(weeks)
    summary = {"updated": datetime.now(timezone.utc).isoformat(), "heading": None, "picks": [], "record": None,
               "empty": ("No games available yet. " + sport["no_games_note"]).strip(),
               "retrained": load_coefficients(sport).get("fitted_at"), "model_url": "model.html"}
    # Offseason (every game graded): no picks, rather than last season's.
    if key and any(not g["graded"] for g in weeks[key]["games"]):
        week = weeks[key]
        summary["heading"] = week["label"]
        top = sorted(week["games"], key=lambda g: (g["graded"], -g["win_pct"]))[:3]
        summary["picks"] = [{
            "label": f"{team_short(sport, g['away_team'])} @ {team_short(sport, g['home_team'])}",
            "sub": f"{g['win_pct']:.0%} to win",
            "value": f"{g['favored_team']} -{g['favored_by']:.1f}",
            "result": g["correct"] if g["graded"] else None,
        } for g in top]
    # Our all-time record since live tracking began (the Home tab's big
    # number), not a season's and never Vegas's.
    rec = live_record(sport, log)
    if rec:
        summary["record"] = {"value": f"{rec['wins']}-{rec['losses']}", "label": "our picks to win",
                             "sub": pct(rec["pct"]), "since": rec["since"]}
    # Optional: this season's moneyline record, same shape as "record".
    ml_season, ml = ml_record(sport, games, log)
    summary["moneyline_record"] = ({"value": ml["record"], "label": f"{ml_season} moneyline",
                                    "sub": f"{ml['n_decided']} picks graded"}
                                   if ml else None)
    add_home_parts(sport, summary, season_games(sport, games, log, comparison), log)
    return summary

# nflverse team codes that differ from ESPN's.
ESPN_NFL_CODES = {"LA": "LAR", "WAS": "WSH"}

def espn_keys_for(sport, code):
    """Ways ESPN might name one of our teams (abbreviation, or school name for CFB)."""
    short = team_short(sport, code)
    return {str(code).upper(), str(short).upper(), ESPN_NFL_CODES.get(code, code).upper()}

def espn_team_keys(t):
    return {t["abbr"].upper(), t["location"].upper(), t["short"].upper()}

def attach_game_picks(sport, slate, games, log, comparison):
    """Each ESPN game gets the model's pick from this season's weeks, matched
    on both teams (ESPN abbreviation, or school name for CFB)."""
    weeks = assemble_season_weeks(sport, games, log, comparison, display_season(sport, games, log))
    keys = lambda code: espn_keys_for(sport, code)

    picks = []
    for wk in weeks.values():
        if slate.get("week") and wk["week"] != slate["week"]:
            continue
        for g in wk["games"]:
            picks.append((keys(g["away_team"]), keys(g["home_team"]), g))

    for eg in slate["games"]:
        a, h = espn_team_keys(eg["away"]), espn_team_keys(eg["home"])
        match = next((g for ak, hk, g in picks if ak & a and hk & h), None)
        if match:
            eg["pick"] = {"text": f"{match['favored_team']} -{match['favored_by']:.1f}, {match['win_pct']:.0%}",
                          "result": match["correct"] if match["graded"] and eg["state"] == "post" else None}
    return slate

def build_sport_pages(sport):
    print(f"Loading {sport['wordmark']} data...")
    games, props, comparison, accuracy_summary, log = load_data(sport)
    slate = attach_game_picks(sport, games_mod.load(sport["slug"]), games, log, comparison)
    espn = slate["games"]

    pages = {
        "index.html": build_index_page(sport, games, log, comparison, espn),
        "teams.html": build_teams_page(sport, games, log, comparison),
        "history.html": build_history_page(sport, log),
        "accuracy.html": build_accuracy_page(sport, log, games),
        "model.html": build_model_page(sport),
        "schedule.html": games_mod.schedule_redirect(sport["slug"]),
    }
    if sport["player_props_csv"]:
        pages["players.html"] = build_players_page(sport, props)
    pages.update(build_game_pages(sport, season_games(sport, games, log, comparison)))

    out_dir = os.path.join(DIST_DIR, sport["slug"])
    os.makedirs(out_dir, exist_ok=True)
    for filename, html in pages.items():
        with open(os.path.join(out_dir, filename), "w") as f:
            f.write(html)
        print(f"  Wrote {sport['slug']}/{filename}")
    # Each sport folder carries its own copy of the assets, so it can be
    # published on its own (/nfl/ and /cfb/ on ant56-arch.github.io).
    write_assets(out_dir)
    with open(os.path.join(out_dir, "summary.json"), "w") as f:
        json.dump(build_summary(sport, games, log, comparison, accuracy_summary), f, indent=1)
    print(f"  Wrote {sport['slug']}/summary.json")
    games_mod.write_json(os.path.join(out_dir, "games.json"), sport["slug"], slate,
                         datetime.now(timezone.utc).isoformat())

def main():
    print("Building site...")
    os.makedirs(DIST_DIR, exist_ok=True)

    for sport in SPORTS.values():
        build_sport_pages(sport)

    with open(os.path.join(DIST_DIR, "index.html"), "w") as f:
        f.write(build_redirect_page())
    print("  Wrote index.html (redirect to nfl/)")

    for filename, html in [("404.html", build_404_page()), ("terms.html", games_mod.legal_redirect("terms")),
                           ("privacy.html", games_mod.legal_redirect("privacy"))]:
        with open(os.path.join(DIST_DIR, filename), "w") as f:
            f.write(html)
        print(f"  Wrote {filename}")

    write_assets(DIST_DIR)
    print("  Copied static assets")

    print(f"\nSite built in {DIST_DIR}")

if __name__ == "__main__":
    main()
