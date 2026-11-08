"""Builds /lab2/: a copy of the live site's pages for testing UI tweaks.

python3 build_lab2.py SITE_DIR OUT_DIR

Copies the home page, bets and schedule, and every tab page of each sport
(everything but the game pages), puts their CSS onto the design system in
ds.py, then adds lab2.css and lab2.js for the rest of the tweaks. Links
between those pages stay inside /lab2/; scripts, data and game pages still
come from the live site, so it shows today's picks.
"""
import re
import shutil
import sys
from pathlib import Path

import ds

SPORTS = ["nfl", "cfb", "mlb", "nhl", "nba", "cbb", "soccer"]
TOP = ["index.html", "bets.html", "schedule.html"]
HERE = Path(__file__).parent
P = "/lab2"


def tabs(site, sp):
    d = site / sp
    return sorted(p.name for p in d.glob("*.html") if not p.name.startswith("game-") and p.name != "404.html") if d.is_dir() else []


def rewrite(html, site, here=None):
    # relative links point at the live folder, except the pages copied here
    mine, base = (set(tabs(site, here)) | {"style.css"}, f"/{here}/") if here else (set(TOP) | {"style.css"}, "/")
    def rel(m):
        attr, url = m.group(1), m.group(2)
        page = url.split("?")[0].split("#")[0]
        return f'{attr}="{P}{base}{url}"' if page in mine else f'{attr}="{base}{url}"'
    html = re.sub(r'(href|src)="(?!https?:|/|#|data:|mailto:|\$\{)([^"]+)"', rel, html)
    html = html.replace('href="/"', f'href="{P}/"').replace('href="/#', f'href="{P}/#')
    html = re.sub(r'(["\'`])/\?l=', rf'\1{P}/?l=', html)
    for f in TOP[1:]:
        html = html.replace(f'"/{f}"', f'"{P}/{f}"')
    for sp in SPORTS:
        for t in tabs(site, sp):
            html = html.replace(f'"/{sp}/{t}"', f'"{P}/{sp}/{t}"')
        html = html.replace(f'"/{sp}/"', f'"{P}/{sp}/index.html"')
    # inline styles go onto the design system too
    html = re.sub(r"(<style[^>]*>)(.*?)(</style>)", lambda m: m.group(1) + ds.snap(m.group(2)) + m.group(3), html, flags=re.S)
    tags = (f'<meta name="robots" content="noindex">\n<link rel="stylesheet" href="{P}/lab2.css?v=VER">\n')
    html = html.replace("</head>", tags + "</head>", 1)
    return html.replace("</body>", f'<script src="{P}/lab2.js?v=VER"></script>\n</body>', 1)


def main(site, out):
    site, out = Path(site), Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    ver = str(int(max((HERE / f).stat().st_mtime for f in ("lab2.css", "lab2.js"))))
    for f in ("lab2.css", "lab2.js"):
        shutil.copy(HERE / f, out / f)
    # each stylesheet, rewritten onto the design system (ds.py)
    for d in [""] + SPORTS:
        css = site / d / "style.css"
        if css.exists():
            (out / d).mkdir(exist_ok=True)
            (out / d / "style.css").write_text(ds.snap(css.read_text()))
    for f in TOP:
        if (site / f).exists():
            (out / f).write_text(rewrite((site / f).read_text(), site).replace("VER", ver))
    for sp in SPORTS:
        for t in tabs(site, sp):
            (out / sp).mkdir(exist_ok=True)
            (out / sp / t).write_text(rewrite((site / sp / t).read_text(), site, sp).replace("VER", ver))
    print("Built", len(list(out.rglob("*.html"))), "pages")


if __name__ == "__main__":
    main(*sys.argv[1:3])
