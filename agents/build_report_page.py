#!/usr/bin/env python3
"""build_report_page.py - turns the agents' Markdown reports into one page.

  python3 agents/build_report_page.py <reports_dir> <out.html>

reports_dir holds one <slug>.md per agent. The page is encrypted before it is
published (model_room/lock_page.mjs), so the reports never sit in the public
repo, its issues or its logs. Standard library only.
"""

import datetime as dt
import html
import os
import re
import sys

UL = re.compile(r"^[-*]\s+")
OL = re.compile(r"^\d+\.\s+")
ORDER = ["modelroom", "nfl", "cfb", "mlb", "nba", "nhl", "cbb", "soccer"]


def inline(s):
    s = html.escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
    return s


def render(md):
    out, in_ul, in_ol = [], False, False

    def close():
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
        if in_ol:
            out.append("</ol>")
        in_ul = in_ol = False

    for line in md.splitlines():
        t = line.strip()
        if t.startswith("```"):
            continue
        m = re.match(r"(#{1,4})\s+(.*)", t)
        if m:
            close()
            n = min(len(m.group(1)) + 1, 5)
            out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
        elif re.match(r"[-*]\s+", t):
            if not in_ul:
                close()
                out.append("<ul>")
                in_ul = True
            out.append("<li>" + inline(UL.sub("", t)) + "</li>")
        elif re.match(r"\d+\.\s+", t):
            if not in_ol:
                close()
                out.append("<ol>")
                in_ol = True
            out.append("<li>" + inline(OL.sub("", t)) + "</li>")
        elif not t:
            close()
        else:
            close()
            out.append(f"<p>{inline(t)}</p>")
    close()
    return "\n".join(out)


def main():
    src, dest = sys.argv[1], sys.argv[2]
    reports = {}
    for name in os.listdir(src):
        if name.endswith(".md"):
            with open(os.path.join(src, name), encoding="utf-8") as f:
                reports[name[:-3]] = f.read()
    slugs = [s for s in ORDER if s in reports] + sorted(s for s in reports if s not in ORDER)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = []
    for s in slugs:
        parts.append(f'<section id="{html.escape(s)}">{render(reports[s])}</section>')
    body = "\n".join(parts) or "<p>No agent reports yet.</p>"
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>League agents</title>
<style>
body{{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem;color:#1b1b19;background:#f2eee6}}
@media (prefers-color-scheme:dark){{body{{color:#ece7dc;background:#141815}}section{{border-color:#2e342f}}}}
h1{{font-size:1.6rem;margin:.5rem 0}} h2{{font-size:1.25rem;margin:0 0 .4rem}} h3{{font-size:1rem;margin:1rem 0 .3rem}}
section{{border-top:2px solid #d3ccbe;padding:1rem 0}} code{{font-size:.9em}} .meta{{opacity:.7;font-size:.85rem}}
</style></head><body>
<h1>League agents</h1>
<p class="meta">Read-only reports from the league and Model Room agents. Updated {now}.
Nothing here has been changed: tell Claude "do NBA-2" to act on a recommendation.</p>
{body}
</body></html>
"""
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"wrote {dest} ({len(slugs)} reports)")


if __name__ == "__main__":
    main()
