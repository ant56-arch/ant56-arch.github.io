"""Builds a self-contained copy of the lab home page (for a private preview page).

python3 build_preview.py SITE_DIR LAB_DIR OUT_DIR
"""
import re, shutil, sys
from pathlib import Path

SPORTS = ["nfl", "cfb", "mlb", "nhl", "nba", "cbb", "soccer"]
LIVE = "https://ant56-arch.github.io/"
DATA = re.compile(r'(["\'`])/((?:%s)/(?:games|summary)\.json|teams\.json|seasons\.json|edge\.js)' % "|".join(SPORTS))


def relink(text):
    text = DATA.sub(r"\1\2", text)
    text = re.sub(r'(["\'`])/lab/\?l=', r"\1?l=", text)
    text = text.replace('href="/lab/"', 'href="?"')
    text = re.sub(r'(href=["\'])/(?!/)', r"\1" + LIVE, text)
    text = re.sub(r'(["\'`])/lab/((?:%s)/index\.html)' % "|".join(SPORTS), r"\1" + LIVE + r"\2", text)
    text = re.sub(r'(["\'`])/(?!/)([a-z][\w./-]*\.html)', r"\1" + LIVE + r"\2", text)
    return text


site, lab, out = map(Path, sys.argv[1:4])
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
home = (lab / "index.html").read_text()
home = re.sub(r'/lab/lab\.(css|js)\?v=\w+', r"lab.\1", home)
home = home.replace('<script src="lab.js" defer>', '<script>window.LAB_ROOT = "";</script>\n<script src="lab.js" defer>')
(out / "index.html").write_text(relink(home))
(out / "edge.js").write_text(relink((site / "edge.js").read_text()))
for f in ("lab.js", "lab.css"):
    shutil.copy(lab / f, out / f)
for f in ("teams.json", "seasons.json"):
    shutil.copy(site / f, out / f)
for sp in SPORTS:
    (out / sp).mkdir()
    for f in ("games.json", "summary.json"):
        if (site / sp / f).exists():
            shutil.copy(site / sp / f, out / sp / f)
print(sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()))
