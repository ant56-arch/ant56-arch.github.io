"""Builds the test copies under /lab/ from a copy of the published site.

python3 build_lab.py SITE_DIR OUT_DIR

The copies are the home page and each sport's game board, with lab.css and
lab.js added. Everything else (scripts, styles, data, game pages) still comes
from the live site, so the copies show today's real picks.
"""
import re
import shutil
import sys
from pathlib import Path

SPORTS = ["nfl", "cfb", "mlb", "nhl", "nba", "cbb", "soccer"]
HERE = Path(__file__).parent


def head_bits(html):
    tags = ('<meta name="robots" content="noindex">\n'
            '<link rel="stylesheet" href="/lab/lab.css?v=VER">\n')
    return html.replace("</head>", tags + "</head>", 1)


def lab_links(html):
    # the home page and the game boards stay inside the test build
    html = html.replace('href="/"', 'href="/lab/"')
    html = re.sub(r'(["\'`])/\?l=', r'\1/lab/?l=', html)
    for sp in SPORTS:
        html = html.replace(f'"/{sp}/index.html"', f'"/lab/{sp}/index.html"')
    html = html.replace('"/mlb/"', '"/lab/mlb/index.html"')
    return html


def main(site, out):
    site, out = Path(site), Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    ver = str(int((HERE / "lab.js").stat().st_mtime))
    shutil.copy(HERE / "lab.js", out / "lab.js")
    shutil.copy(HERE / "lab.css", out / "lab.css")
    shutil.copy(HERE / "lab3d.js", out / "lab3d.js")              # 3D players (a test, off by default)
    shutil.copytree(HERE / "vendor", out / "vendor")
    shutil.copytree(HERE / "models", out / "models")

    home = (site / "index.html").read_text()
    home = lab_links(head_bits(home))
    home = home.replace('<script src="/edge.js" defer></script>',
                        '<script src="/edge.js" defer></script>\n<script src="/lab/lab.js?v=VER" defer></script>')
    (out / "index.html").write_text(home.replace("VER", ver))

    for sp in SPORTS:
        src = site / sp / "index.html"
        if not src.exists():
            continue
        html = src.read_text()
        # relative links and files point back at the live sport folder
        html = re.sub(r'(href|src)="(?!https?:|/|#|data:|mailto:)([^"]+)"', rf'\1="/{sp}/\2"', html)
        html = html.replace(f'href="/{sp}/index.html"', f'href="/lab/{sp}/index.html"')
        html = lab_links(head_bits(html))
        html = html.replace("</body>", '<script src="/lab/lab.js?v=VER"></script>\n</body>', 1)
        (out / sp).mkdir()
        (out / sp / "index.html").write_text(html.replace("VER", ver))
    print("Built", sorted(p.relative_to(out).as_posix() for p in out.rglob("*.html")))


if __name__ == "__main__":
    main(*sys.argv[1:3])
