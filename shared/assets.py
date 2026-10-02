"""
assets.py - code every Sports Edge site shares, and how each site's
stylesheet and script are put together from it.

shared/ holds one copy of what used to be kept in sync by hand across the
home page, nfl-cfb/ and mlb-nba-cbb/:

  base.css         the look every page shares (top bar, ticker, cards, tables)
  edge.js          the score ticker, site settings and phone sport menu
  sport-pages.js   section tabs and day buttons on the sport sites
  games.py, extras.py, model_page.py
                   Python the site builders import

Each site publishes one style.css and one script built from these plus its
own part:

  home page        style.css = base.css + home-page.css
                   home.js   = edge.js + home-page.js
  sport sites      style.css = base.css + web/sport.css
                   site.js   = web/sport.js + edge.js + sport-pages.js

The builders call style() and script(); publish_site.sh runs this file to
write the home page's two:  python shared/assets.py home OUT_DIR
"""

import os
import sys

SHARED = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SHARED)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _join(paths):
    return "\n".join(read(p) for p in paths)


def style(own_css):
    """A site's style.css: the shared base, then the site's own rules."""
    return _join([os.path.join(SHARED, "base.css"), own_css])


def script(own_js):
    """A sport site's site.js: its own code, then the shared ticker, settings
    and menu, then the sport-page helpers."""
    return _join([own_js, os.path.join(SHARED, "edge.js"), os.path.join(SHARED, "sport-pages.js")])


def home_script():
    return _join([os.path.join(SHARED, "edge.js"), os.path.join(ROOT, "home-page.js")])


def write_home(out_dir):
    """The home page's style.css and home.js, into out_dir."""
    for name, text in (("style.css", style(os.path.join(ROOT, "home-page.css"))), ("home.js", home_script())):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "home":
        sys.exit("usage: python shared/assets.py home OUT_DIR")
    write_home(sys.argv[2])
