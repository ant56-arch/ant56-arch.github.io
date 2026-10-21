"""The top of every sport page, in the home page's own layout.

The score bars, then the home nav (EDGE, the league tabs, Today's picks and
the gear), a stadium hero with the sport and page name in big type, then a
paper sheet that opens with the page's links as pills. Every sport's
page_shell calls page_top() and closes with page_bottom(), so every page of
every sport matches the home page's league tabs. Betting, Schedule, Terms
and Privacy carry the same nav, hero and pills, written in once with nav(),
hero() and pills(). Styled in morrow.css (.edge-*), wired up in edge.js
(initEdgeNav).
"""
from html import escape

LEAGUES = [("All", "/"), ("NFL", "/?l=nfl"), ("CFB", "/?l=cfb"), ("MLB", "/?l=mlb"), ("NHL", "/?l=nhl"),
           ("NBA", "/?l=nba"), ("CBB", "/?l=cbb"), ("Soccer", "/?l=soccer")]

BRAND_MARK = ('<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" '
              'stroke="currentColor" stroke-opacity=".4"/><path d="M6 21.5 13 14l5 4.5 8-9" fill="none" '
              'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
              '<circle cx="26" cy="9.5" r="1.8" fill="currentColor"/></svg>')


# The home page's own pages (the All tab's links), for Betting and Schedule.
SITE_PILLS = [("/#slate", "Today's games"), ("/#value", "Value picks"), ("/#record", "Record"),
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
  {pills(links, active, escape(sport) + " pages")}"""
