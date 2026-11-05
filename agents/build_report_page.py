#!/usr/bin/env python3
"""build_report_page.py - turns the agents' Markdown reports into one tabbed page.

  python3 agents/build_report_page.py <reports_dir> <out.html>

reports_dir holds one <slug>.md per agent. The page is encrypted before it is
published (model_room/lock_page.mjs), so the reports never sit in the public
repo, its issues or its logs. Standard library only.

Layout: an Overview tab (every agent's status and how many changes it
recommends), then one tab per agent with its status, recommendation cards and
analysis. A report that doesn't follow the expected shape still shows up,
just as plain text.
"""

import datetime as dt
import html
import os
import re
import sys

ORDER = ["modelroom", "nfl", "cfb", "mlb", "nba", "nhl", "cbb", "soccer"]
LABELS = {"modelroom": "Model Room", "nfl": "NFL", "cfb": "CFB", "mlb": "MLB",
          "nba": "NBA", "nhl": "NHL", "cbb": "CBB", "soccer": "Soccer"}

UL = re.compile(r"^(\s*)[-*]\s+(.*)")
OL = re.compile(r"^(\s*)\d+[.)]\s+(.*)")
ITEM = re.compile(r"^\s*\d+[.)]\s+\*\*")
FIELD = re.compile(r"^\s*[-*]?\s*\*{0,2}(What|Why|Effect|Expected effect|Risk|Confidence|Where|Evidence|Change)\*{0,2}\s*[:.]\s*\*{0,2}\s*(.*)$", re.I)

HOME_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" '
             'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

GOOD = ("healthy", "working", "fine", "good", "on track", "steady", "off-season", "off season")
BAD = ("falling", "failed", "broken", "not set up", "no report", "alarm", "problem", "cold")


def esc(s):
    return html.escape(s, quote=True)


def inline(s):
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
    return s


def render(lines):
    """Markdown lines -> HTML: paragraphs, bullets, numbers, tables, headings."""
    out = []
    para = []
    stack = []  # open list tags
    i = 0

    def flush():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    def close_lists(to=0):
        while len(stack) > to:
            out.append("</li></%s>" % stack.pop()[0])

    while i < len(lines):
        raw = lines[i].rstrip()
        t = raw.strip()
        if t.startswith("```"):
            i += 1
            continue
        if t.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]):
            flush()
            close_lists()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            head, body = rows[0], rows[2:]
            out.append('<div class="tbl"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head)
                       + "</tr></thead><tbody>" + "".join(
                           "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
                       + "</tbody></table></div>")
            continue
        m = re.match(r"^(#{1,6})\s+(.*)", t)
        if m:
            flush()
            close_lists()
            n = min(len(m.group(1)) + 2, 6)
            out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
            i += 1
            continue
        m = UL.match(raw) or OL.match(raw)
        if m:
            flush()
            depth = len(m.group(1).expandtabs(4)) // 2
            tag = "ul" if UL.match(raw) else "ol"
            if stack and depth == len(stack) - 1 and stack[-1][0] == tag:
                out.append("</li>")
            elif depth >= len(stack):
                out.append("<%s>" % tag)
                stack.append((tag, depth))
            else:
                close_lists(depth + 1)
                out.append("</li>")
            out.append("<li>" + inline(m.group(2)))
            i += 1
            continue
        if not t:
            flush()
            close_lists()
            i += 1
            continue
        if stack:
            out.append(" " + inline(t))  # continuation of a list item
        else:
            para.append(t)
        i += 1
    flush()
    close_lists()
    return "\n".join(out)


def split_report(md):
    """-> (title, status, {section: [lines]}) from '## NBA: Healthy' and '### ...'."""
    title, status, cur = "", "", "intro"
    sections = {"intro": []}
    for line in md.splitlines():
        m = re.match(r"^##\s+(.*)", line)
        if m and not title:
            head = m.group(1).strip()
            title, _, status = head.partition(":")
            title, status = title.strip(), status.strip()
            continue
        m = re.match(r"^###\s+(.*)", line)
        if m:
            cur = m.group(1).strip().lower()
            sections.setdefault(cur, [])
            continue
        sections.setdefault(cur, []).append(line)
    return title, status, sections


def tone(status):
    s = status.lower()
    if any(w in s for w in BAD):
        return "bad"
    if any(w in s for w in GOOD):
        return "good"
    return "warn"


def split_recs(lines):
    """Numbered '1. **ID: title.** ...' items -> [(id, title, body_lines)]."""
    items, cur = [], None
    for line in lines:
        if ITEM.match(line):
            if cur:
                items.append(cur)
            m = re.match(r"^\s*\d+[.)]\s+\*\*(.+?)\*\*\s*(.*)$", line)
            head, rest = m.group(1).strip(), m.group(2).strip()
            rid, _, title = head.partition(":")
            if not title:
                rid, title = "", head
            cur = [rid.strip(), title.strip().rstrip("."), [rest] if rest else []]
        elif cur is not None:
            cur[2].append(line)
    if cur:
        items.append(cur)
    return [tuple(i) for i in items]


def rec_card(rid, title, body):
    fields, loose = [], []
    for line in body:
        m = FIELD.match(line)
        if m:
            fields.append([m.group(1).capitalize(), m.group(2).strip()])
        elif fields and line.strip():
            fields[-1][1] += " " + line.strip()  # wrapped line
        elif line.strip():
            loose.append(line.strip())
    conf = ""
    rows = []
    for k, v in fields:
        if k.lower() == "confidence":
            conf = v
            continue  # shown as the chip instead
        rows.append(f"<div class='row'><dt>{esc(k)}</dt><dd>{inline(v)}</dd></div>")
    text = " ".join(loose)
    # one-paragraph recommendations (no labelled fields): show the text as is
    if not fields and text:
        rows.append(f"<div class='row full'><dd>{inline(text)}</dd></div>")
    elif text:
        rows.insert(0, f"<div class='row full'><dd>{inline(text)}</dd></div>")
    cl = conf.lower()
    ctone = "good" if cl.startswith("high") else ("bad" if cl.startswith("low") else "warn")
    badge = f"<span class='chip {ctone}'>{esc(conf.split('.')[0].split(',')[0][:24])} confidence</span>" if conf else ""
    return (f"<article class='rec'><header>{('<span class=id>' + esc(rid) + '</span>') if rid else ''}"
            f"<h4>{inline(title)}</h4>{badge}</header><dl>{''.join(rows)}</dl>"
            f"<p class='ask'>Needs your approval. Reply &ldquo;do {esc(rid) or 'this'}&rdquo; to Claude to make it happen.</p></article>")


def panel(slug, md):
    title, status, sec = split_report(md)
    title = title or LABELS.get(slug, slug)
    recs_lines = next((v for k, v in sec.items() if k.startswith("recommend")), [])
    recs = split_recs(recs_lines)
    none_rec = not recs and any("none" in l.lower() for l in recs_lines)
    parts = [f"<div class='eyebrow'>{esc(LABELS.get(slug, title))} agent</div>",
             f"<h2>{esc(title)}</h2>"]
    if status:
        parts.append(f"<p class='status {tone(status)}'><span class='dot'></span>{inline(status)}</p>")
    intro = "\n".join(sec.get("intro", [])).strip()
    if intro:
        parts.append(f"<div class='prose'>{render(sec['intro'])}</div>")

    parts.append("<h3 class='sec'>Recommended adjustments</h3>")
    if recs:
        parts.append("<div class='recs'>" + "".join(rec_card(*r) for r in recs) + "</div>")
    elif none_rec or recs_lines:
        parts.append("<p class='none'>Nothing to change this run.</p>" if none_rec
                     else f"<div class='prose'>{render(recs_lines)}</div>")
    else:
        parts.append("<p class='none'>Nothing to change this run.</p>")

    for key, lines in sec.items():
        if key in ("intro",) or key.startswith("recommend"):
            continue
        body = render(lines)
        if not body.strip():
            continue
        name = key[:1].upper() + key[1:]
        parts.append(f"<h3 class='sec'>{esc(name)}</h3><div class='prose'>{body}</div>")
    return title, status, len(recs), "\n".join(parts)


CSS = r"""
:root{color-scheme:light dark;
  --bg:#f2eee6;--surface:#f8f5ef;--surface-2:#e7e1d5;--rule:#d3ccbe;--text:#1b1b19;--muted:#5e5a51;--faint:#6b665c;
  --ours:#a4532b;--hit:#2f6b45;--miss:#9a3b2c;--warn:#8a6a1c;--forest:#1e3a2c;--forest-ink:#f2eee6;
  --font:'Archivo','Helvetica Neue',Arial,sans-serif;--serif:'Instrument Serif','Iowan Old Style',Georgia,serif;--mono:'DM Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#141815;--surface:#1a1f1b;--surface-2:#212722;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--faint:#8d887c;
  --ours:#d98b5f;--hit:#8cc59c;--miss:#e58c78;--warn:#d9b85f;--forest:#22402f;--forest-ink:#ece7dc}}
:root[data-theme="dark"]{--bg:#141815;--surface:#1a1f1b;--surface-2:#212722;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--faint:#8d887c;
  --ours:#d98b5f;--hit:#8cc59c;--miss:#e58c78;--warn:#d9b85f;--forest:#22402f;--forest-ink:#ece7dc}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.6;margin:0}
.top{background:var(--forest);color:var(--forest-ink);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.top .brand{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;white-space:nowrap}
.top .brand b{font-family:var(--font);font-weight:800;letter-spacing:.06em}
.top a.home{display:inline-flex;align-items:center;gap:6px;color:var(--forest);background:var(--forest-ink);text-decoration:none;font-weight:700;font-size:14px;border-radius:999px;padding:7px 14px 7px 10px;min-height:36px}
.top a.home svg{width:16px;height:16px}
.wrap{max-width:900px;margin:0 auto;padding:24px 16px 72px}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.1rem,6vw,3.1rem);line-height:1.02;margin:0}
h1 i{color:var(--ours)}
.lede{color:var(--muted);margin:8px 0 0;max-width:62ch}
.updated,.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.updated{margin:10px 0 18px}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:0 0 10px;border-bottom:2px solid var(--text);scrollbar-width:thin}
.tabs button{flex:none;font:inherit;font-weight:700;font-size:.9rem;background:transparent;color:var(--text);border:1px solid var(--rule);border-radius:999px;padding:6px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
.tabs button[aria-selected="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.tabs button:focus-visible{outline:2px solid var(--ours);outline-offset:2px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warn);flex:none}
.good .dot,.dot.good{background:var(--hit)} .bad .dot,.dot.bad{background:var(--miss)} .warn .dot,.dot.warn{background:var(--warn)}
.n{font-family:var(--mono);font-size:.75rem;background:var(--ours);color:#fff;border-radius:999px;padding:0 7px;line-height:1.5}
.panel{padding-top:22px}
.panel[hidden]{display:none}
h2{font-family:var(--serif);font-weight:400;font-size:2rem;line-height:1.1;margin:2px 0 10px}
.status{display:inline-flex;align-items:center;gap:8px;font-weight:700;margin:0 0 6px;padding:5px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--rule)}
h3.sec{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:500;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
.prose p{margin:0 0 .8em;max-width:68ch}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.3em;max-width:68ch}
.prose li{margin:.3em 0}
.prose h5,.prose h6,.prose h4{margin:1.2em 0 .3em;font-size:1rem}
code{font-family:var(--mono);font-size:.88em;background:var(--surface-2);padding:1px 5px;border-radius:4px}
.none{color:var(--muted);background:var(--surface);border:1px dashed var(--rule);border-radius:10px;padding:14px 16px;margin:0}
.recs{display:grid;gap:14px}
.rec{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--ours);border-radius:10px;padding:14px 16px}
.rec header{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px 10px}
.rec h4{margin:0;font-size:1.05rem;flex:1 1 220px}
.id{font-family:var(--mono);font-size:12px;font-weight:500;background:var(--ours);color:#fff;border-radius:6px;padding:2px 8px}
.chip{font-family:var(--mono);font-size:11px;letter-spacing:.04em;border:1px solid var(--rule);border-radius:999px;padding:1px 9px;color:var(--muted)}
.chip.good{color:var(--hit);border-color:var(--hit)} .chip.bad{color:var(--miss);border-color:var(--miss)} .chip.warn{color:var(--warn);border-color:var(--warn)}
.rec dl{margin:10px 0 0;display:grid;gap:8px}
.row{display:grid;grid-template-columns:7.5rem 1fr;gap:10px}
.row.full{grid-template-columns:1fr}
.rec dt{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding-top:3px}
.rec dd{margin:0}
.ask{margin:12px 0 0;font-size:.85rem;color:var(--muted);border-top:1px solid var(--rule);padding-top:8px}
.tbl{overflow-x:auto;margin:0 0 1em}
table{border-collapse:collapse;font-size:.92rem;min-width:100%}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--rule)}
th{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.card{display:block;text-align:left;font:inherit;color:inherit;background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:12px 14px;cursor:pointer}
.card:hover{border-color:var(--ours)}
.card b{display:block;margin-bottom:2px}
.card span.s{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:.9rem}
.card .r{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:6px;display:block}
@media (max-width:560px){.row{grid-template-columns:1fr;gap:2px}}
"""

JS = r"""
(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tabs button'));
  function show(id,push){
    var ok=tabs.some(function(b){return b.dataset.p===id});
    if(!ok)id=tabs[0].dataset.p;
    tabs.forEach(function(b){b.setAttribute('aria-selected',b.dataset.p===id?'true':'false')});
    [].forEach.call(document.querySelectorAll('.panel'),function(p){p.hidden=p.id!=='p-'+id});
    if(push&&history.replaceState)history.replaceState(null,'','#'+id);
    window.scrollTo(0,0);
  }
  tabs.forEach(function(b,i){
    b.addEventListener('click',function(){show(b.dataset.p,true)});
    b.addEventListener('keydown',function(e){var j=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:null;if(j===null)return;j=(j+tabs.length)%tabs.length;tabs[j].focus();show(tabs[j].dataset.p,true)});
  });
  [].forEach.call(document.querySelectorAll('[data-go]'),function(c){c.addEventListener('click',function(){show(c.dataset.go,true)})});
  window.addEventListener('hashchange',function(){show((location.hash||'').replace('#','').toLowerCase(),false)});
  show((location.hash||'').replace('#','').toLowerCase()||'overview',false);
})();
"""


def build(reports):
    slugs = [s for s in ORDER if s in reports] + sorted(s for s in reports if s not in ORDER)
    built = {s: panel(s, reports[s]) for s in slugs}
    now = dt.datetime.now(dt.timezone.utc).strftime("%b %d, %Y %H:%M UTC")
    total = sum(b[2] for b in built.values())

    cards = []
    for s in slugs:
        title, status, n, _ = built[s]
        t = tone(status) if status else "warn"
        r = f"{n} recommendation{'s' if n != 1 else ''}" if n else "No changes recommended"
        cards.append(f"<button class='card' data-go='{esc(s)}'><b>{esc(LABELS.get(s, title))}</b>"
                     f"<span class='s'><span class='dot {t}'></span>{inline(status or 'See report')}</span>"
                     f"<span class='r'>{r}</span></button>")
    overview = ("<div class='eyebrow'>All agents</div><h2>Overview</h2>"
                f"<p class='prose'>{total} recommendation{'s' if total != 1 else ''} waiting for your approval across "
                f"{len(slugs)} agent{'s' if len(slugs) != 1 else ''}. Nothing has been changed. Tap an agent to read its analysis.</p>"
                f"<div class='cards'>{''.join(cards)}</div>") if slugs else "<h2>Overview</h2><p class='none'>No agent reports yet.</p>"

    nav = ["<nav class='tabs' role='tablist' aria-label='Agents'>",
           "<button role='tab' id='tab-overview' aria-controls='p-overview' aria-selected='true' data-p='overview'>Overview</button>"]
    for s in slugs:
        title, status, n, _ = built[s]
        t = tone(status) if status else "warn"
        badge = f"<span class='n'>{n}</span>" if n else ""
        nav.append(f"<button role='tab' id='tab-{esc(s)}' aria-controls='p-{esc(s)}' aria-selected='false' data-p='{esc(s)}'>"
                   f"<span class='dot {t}'></span>{esc(LABELS.get(s, title))}{badge}</button>")
    nav.append("</nav>")

    panels = [f"<div class='panel' id='p-overview' role='tabpanel' aria-labelledby='tab-overview'>{overview}</div>"]
    for s in slugs:
        panels.append(f"<div class='panel' id='p-{esc(s)}' role='tabpanel' aria-labelledby='tab-{esc(s)}' hidden>{built[s][3]}</div>")

    return f"""<title>League agents</title>
<style>{CSS}</style>
<div class="top"><a class="home" href="/">{HOME_ICON}Home</a><span class="brand"><b>EDGE</b> &nbsp;·&nbsp; League agents</span></div>
<main class="wrap">
<header><h1>League <i>agents</i></h1>
<p class="lede">Each agent watches one tab of the site and its model, and recommends changes. They only report. Nothing changes until you approve it.</p>
<p class="updated">Updated {esc(now)}</p></header>
{''.join(nav)}
{''.join(panels)}
</main>
<script>{JS}</script>
"""


def main():
    src, dest = sys.argv[1], sys.argv[2]
    reports = {}
    for name in os.listdir(src):
        if name.endswith(".md"):
            with open(os.path.join(src, name), encoding="utf-8") as f:
                reports[name[:-3]] = f.read()
    page = build(reports)
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"wrote {dest} ({len(reports)} reports)")


if __name__ == "__main__":
    main()
