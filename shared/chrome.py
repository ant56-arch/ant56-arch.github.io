"""The top of every sport page, in the home page's own layout.

The score bars, then the home nav (EDGE, the league tabs, Today's picks and
the gear), a stadium hero with the sport and page name in big type, then a
paper sheet that opens with the page's links as pills. Every sport's
page_shell calls page_top() and closes with page_bottom(), so every page of
every sport matches the home page's league tabs. Betting, Schedule, Terms
and Privacy carry the same nav, hero and pills, written in once with nav(),
hero() and pills(). A league whose season is over gets the season-over
banner under the pills (seasons.banner_html). Styled in morrow.css (.edge-*), wired up in edge.js
(initEdgeNav).
"""
import re
from html import escape

import seasons

LEAGUES = [("All", "/"), ("NFL", "/?l=nfl"), ("CFB", "/?l=cfb"), ("MLB", "/?l=mlb"), ("NHL", "/?l=nhl"),
           ("NBA", "/?l=nba"), ("CBB", "/?l=cbb"), ("Soccer", "/?l=soccer")]

BRAND_MARK = ('<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" '
              'stroke="currentColor" stroke-opacity=".4"/><path d="M6 21.5 13 14l5 4.5 8-9" fill="none" '
              'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
              '<circle cx="26" cy="9.5" r="1.8" fill="currentColor"/></svg>')


# The home page's own pages (the All tab's links), for Betting and Schedule.
SITE_PILLS = [("/#slate", "Today's games"), ("/#record", "Record"),
              ("/#calendar", "Past days"), ("/bets.html", "Betting"), ("/schedule.html", "Schedule")]


def nav(slug):
    """The home nav with the league tab for slug ("nhl"; "all" on site pages) marked."""
    leagues = "".join(
        f'<li><a href="{href}"{" aria-current=page" if name.lower() == slug else ""}>{name}</a></li>'
        for name, href in LEAGUES)
    cta = "/#slate" if slug == "all" else f"/?l={slug}#slate"
    return f"""<div id="tick" class="edge-tick"><span class="topbar" hidden></span></div>
<nav class="nav edge-nav" aria-label="Leagues">
  <a class="edge-brand" href="/" aria-label="Sports Edge home">{BRAND_MARK}EDGE</a>
  <ul class="edge-tabs">{leagues}</ul>
  <a class="edge-cta" href="{cta}">Today's picks</a>
</nav>"""


def hero(kind, eyebrow, line1, line2, tagline=""):
    return f"""<header class="masthead edge-hero" data-sport="{escape(kind)}">
  <div class="edge-hero-row">
    <div class="edge-eyebrow">{eyebrow}</div>
    <h1><span class="ln"><span>{line1}</span></span><span class="ln"><span>{line2}</span></span></h1>
  </div>
  <div class="edge-hero-bar">
    <a class="edge-scroll" href="#main-content"><i aria-hidden="true">&darr;</i>Scroll to explore</a>
    <span>{tagline}</span>
    <span>Est. 2026</span>
  </div>
</header>"""


def pills(links, active, label):
    return f'<nav class="edge-jump" aria-label="{label}">' + "".join(
        f'<a href="{href}" class="go" aria-current="page">{text}</a>' if href == active
        else f'<a href="{href}">{text}</a>' for href, text in links) + "</nav>"


def page_top(sport, title, tabs, active, updated, tagline=""):
    """sport: the league tab's name ("NHL", "Soccer"); title: this page's name;
    tabs: [(href, label)] of the sport's pages; active: the current href
    (None for a game page); updated: e.g. "Oct 21, 9:40 AM ET". Opens the
    sheet; the page_shell closes it after the footer."""
    slug = sport.lower()
    # A sport's first page is its Game board, as on the home page's league tab.
    label = lambda href, text: "Game board" if text == "Home" and href == "index.html" and sport != "MLB" else text
    links = [(f"/?l={slug}#slate", "Today's games")] + [(href, label(href, text)) for href, text in tabs]
    return f"""{nav(slug)}
{hero(sport.upper(), f"Updated {escape(updated)}", escape(sport), escape(label(active or "", title)) + ".", tagline)}
<div class="wrap edge-sheet">
  {pills(links, active, escape(sport) + " pages")}
  {seasons.banner_html(sport)}"""


# Section headings in the home page's style: a numbered mono label
# ("01 — Record") over a big sentence-case headline with a serif italic
# ending ("Accuracy over <em>time.</em>"). Known titles get a written
# headline; anything else is the title in sentence case with its last word
# in italics.
HEADLINES = {
    "Record": "How we've <em>done.</em>",
    "Accuracy Over Time": "Accuracy over <em>time.</em>",
    "Calibration": "Does 70% mean <em>70%?</em>",
    "Backtest": "Tested on past <em>seasons.</em>",
    "How It Learns": "How it <em>learns.</em>",
    "Results By Day": "Results by <em>day.</em>",
    "Is It Getting Better?": "Is it getting <em>better?</em>",
    "Retrain Log": "Every <em>retrain.</em>",
    "What It's Weighing": "What it's <em>weighing.</em>",
    "History": "Every pick, <em>day by day.</em>",
    "Today's Games": "Today's <em>games.</em>",
    "Today's Matches": "Today's <em>matches.</em>",
    "Latest Games": "Latest <em>games.</em>",
    "Moneyline Picks": "Moneyline <em>picks.</em>",
    "Against Vegas": "Against <em>Vegas.</em>",
    "Teams": "Every <em>team.</em>",
    "Player Projections": "Player <em>projections.</em>",
    "TD Props": "Touchdown <em>scorers.</em>",
    "TD Props Record": "Touchdown scorer <em>record.</em>",
    "Power Ratings": "Power <em>ratings.</em>",
    "Past Days": "Past <em>days.</em>",
}
_KEEP = {"Vegas", "West", "East", "South", "Midwest", "Final", "Four", "First", "Elo"}
_H2 = re.compile(r'<h2>([^<]+)</h2>')


def headline(title):
    """The big headline for a section titled title (plain text, may be escaped)."""
    from html import unescape
    base = unescape(title).split(":")[0].strip()
    if base in HEADLINES:
        return HEADLINES[base]
    words = base.split()
    words = [w if i == 0 or w in _KEEP or (w.isupper() and len(w) > 1) or any(c.isdigit() for c in w) else w.lower()
             for i, w in enumerate(words)]
    end = "" if words and words[-1][-1:] in "?.!" else "."
    if len(words) > 1:
        return " ".join(words[:-1]) + f" <em>{words[-1]}{end}</em>"
    return " ".join(words) + end


def sections(body_html):
    """Number a page's section headings and give each the home page's
    label-over-headline look. Headings that already carry markup are left as is."""
    n = 0

    def one(m):
        nonlocal n
        n += 1
        title = m.group(1).strip()
        label = title.replace(": ", " &middot; ")
        return (f'<div class="sec-label"><span>{n:02d}</span><b>{label}</b></div>'
                f'<h2 class="sec-h2">{headline(title)}</h2>')
    return _H2.sub(one, body_html)
