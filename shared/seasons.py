"""seasons.py - when each league's season is over, and what the site shows then.

One place decides it for every sport (docs/season-end.md has the whole
process). shared/seasons.json lists each league: where its picks are, the
months its season can end in, how long a quiet spell means the season is over,
and when the next one usually starts. From the picks alone:

  over   the last pick was in one of the league's end months, at least
         gap_days ago, nothing is scheduled, and the next season's usual start
         hasn't come yet. "override" in seasons.json forces it either way.
  idle   over, and the next season is more than LEAD_DAYS away: the daily and
         weekly workflows skip that league's pipeline, retrain and Vegas-odds
         steps, and keep rebuilding its pages.

A finished season is frozen in archive/<slug>-<season>.json (the final
records, which never change after that) the first time a workflow sees it
over. The live all-time records are never touched.

What reads it:
  chrome.page_top     a season-over banner on every page of a finished league
  publish_site.sh     /seasons.json (the home page's notes and Final tags)
                      and /archive.html (every finished season's records)
  the workflows       python ../shared/seasons.py idle MLB  -> "yes" / "no"

Every season and year comes from the picks' dates; none are written in.

  python shared/seasons.py                 each league's state
  python shared/seasons.py idle LEAGUE     yes/no, for a workflow step
  python shared/seasons.py archive         freeze finished seasons
  python shared/seasons.py site OUT_DIR    write seasons.json and archive.html
"""
import csv
import functools
import json
import os
import sys
from datetime import date, datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

SHARED = os.path.dirname(os.path.abspath(__file__))
if SHARED not in sys.path:  # pick_moves.py sits next to this file
    sys.path.append(SHARED)
from pick_moves import football_hit  # noqa: E402 - the football pick rule, defined once
ROOT = os.path.dirname(SHARED)
ARCHIVE_DIR = os.path.join(ROOT, "archive")
ET = ZoneInfo("America/New_York")
LEAD_DAYS = 10  # the pipelines start running again this many days before the usual start


def config():
    with open(os.path.join(SHARED, "seasons.json")) as f:
        return json.load(f)["leagues"]


def today():
    return datetime.now(ET).date()


# ── Reading the picks ────────────────────────────────────────────────────────
def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


@functools.lru_cache(maxsize=None)
def _picks(kind, path):
    """[(date, season key or None, won: True/False/None)] for one pick file,
    plus the all-hitter baseline for the hitter file."""
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return [], {}
    if kind == "football":
        with open(full, newline="") as f:
            rows = list(csv.DictReader(f))
        out = []
        for r in rows:
            try:
                d = date.fromisoformat(str(r.get("gameday", ""))[:10])
            except ValueError:
                continue
            won = football_hit(r) if _f(r.get("actual_margin")) is not None else None
            out.append((d, int(float(r["season"])) if _f(r.get("season")) is not None else None, won))
        return out, {}
    with open(full) as f:
        data = json.load(f)
    out = []
    for p in data.get("picks", []):
        res = p.get("got_hit") if kind == "hitters" else p.get("correct")
        out.append((date.fromisoformat(p["date"]), None, None if res is None or p.get("void") else bool(res)))
    return out, data.get("baselines", {}) if kind == "hitters" else {}


def season_of(lg, d):
    """The year a league's season started in, for a pick on day d."""
    return d.year if d.month >= lg["start_month"] else d.year - 1


def season_label(lg, y):
    return str(y) if lg["label"] == "year" else f"{y}-{(y + 1) % 100:02d}"


def _next_start(lg, after):
    m, d = (int(x) for x in lg["next_start"].split("-"))
    start = date(after.year, m, d)
    return start if start > after else date(after.year + 1, m, d)


def _pct(w, n, digits=1):
    return f"{w / n * 100:.{digits}f}%" if n else ""


def final_records(lg, season):
    """The season's records, one per pick file: label, W-L, percent (and, for
    hitters, the share of all hitters who got a hit on those days)."""
    recs = []
    for src in lg["records"]:
        picks, base = _picks(src["kind"], src["path"])
        mine = [(d, won) for d, s, won in picks if won is not None and (s if s is not None else season_of(lg, d)) == season]
        if not mine:
            continue
        w = sum(1 for _, won in mine if won)
        rec = {"label": src["label"], "value": f"{w}-{len(mine) - w}", "pct": _pct(w, len(mine))}
        days = [v for k, v in base.items() if season_of(lg, date.fromisoformat(k)) == season and v.get("hitters")]
        if days:
            rec["vs"] = f"{_pct(sum(v['with_hit'] for v in days), sum(v['hitters'] for v in days))} for all hitters"
        recs.append(rec)
    return recs


# ── State ────────────────────────────────────────────────────────────────────
def archive_path(lg, season):
    return os.path.join(ARCHIVE_DIR, f"{lg['slug']}-{season}.json")


def archived():
    """Every frozen season, newest first."""
    out = []
    if os.path.isdir(ARCHIVE_DIR):
        for name in sorted(os.listdir(ARCHIVE_DIR)):
            if name.endswith(".json"):
                with open(os.path.join(ARCHIVE_DIR, name)) as f:
                    out.append(json.load(f))
    return sorted(out, key=lambda a: a["final_day"], reverse=True)


@functools.lru_cache(maxsize=None)
def state(league, on=None):
    """Where a league's season stands on day `on` (today in ET by default)."""
    cfg = config()
    lg = cfg[league]
    on = on or today()
    picks = _picks(lg["records"][0]["kind"], lg["records"][0]["path"])[0]
    out = {"league": league, "slug": lg["slug"], "over": False, "idle": False, "override": lg.get("override", "auto")}
    if not picks:
        return out
    last = max(d for d, _, _ in picks)
    season = next((s for d, s, _ in picks if d == last and s is not None), None) or season_of(lg, last)
    nxt = _next_start(lg, last)
    auto = last.month in lg["end_months"] and (on - last).days >= lg["gap_days"] and on < nxt
    over = {"over": True, "in_season": False}.get(out["override"], auto)
    out.update(season=season, label=season_label(lg, season), last_day=last.isoformat(), next_start=nxt.isoformat(),
               next_label=lg["next_label"], final=lg["final"], over=over)
    if over:
        out["idle"] = out["override"] == "over" or on < nxt - timedelta(days=LEAD_DAYS)
        out["archive"] = f"/archive.html#{lg['slug']}-{season}"
        path = archive_path(lg, season)
        if os.path.exists(path):
            with open(path) as f:
                out["records"] = json.load(f)["records"]
            out["archived"] = True
        else:
            out["records"] = final_records(lg, season)
            out["archived"] = False
    return out


def freeze(league, on=None):
    """Write a finished season's archive file once; returns its path or None."""
    st = state(league, on)
    if not st["over"] or st.get("archived") or not st.get("records"):
        return None
    lg = config()[league]
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    path = archive_path(lg, st["season"])
    with open(path, "w") as f:
        json.dump({"league": league, "slug": lg["slug"], "season": st["season"], "label": st["label"],
                   "final_day": st["last_day"], "final": lg["final"], "records": st["records"],
                   "archived_on": (on or today()).isoformat()}, f, indent=1)
        f.write("\n")
    return path


# ── What the pages show ──────────────────────────────────────────────────────
def _day(iso):
    d = date.fromisoformat(iso)
    return f"{d:%b} {d.day}"


def _rec_line(r):
    vs = f" ({r['vs']})" if r.get("vs") else ""
    return f"{r['label']} {r['value']}, {r['pct']}{vs}"


def note_text(st):
    """One plain sentence pair for a finished league."""
    recs = "; ".join(_rec_line(r) for r in st.get("records", []))
    return (f"The {st['label']} {st['league']} season is over and archived. It ended {_day(st['last_day'])} with "
            f"{st['final']}." + (f" Final: {recs}." if recs else "") + f" Picks return on {st['next_label']}.")


def find(sport):
    """The league key for a page_top sport name ("MLB", "Soccer", "nfl")."""
    return next((k for k in config() if k.lower() == str(sport).lower()), None)


def banner_html(sport, on=None):
    """The season-over banner at the top of every page of a finished league,
    or "" while it's in season."""
    league = find(sport)
    if not league:
        return ""
    try:
        st = state(league, on)
    except Exception as e:  # a bad file must never take a page down
        print(f"seasons: no banner for {league} ({e})")
        return ""
    if not st["over"]:
        return ""
    recs = "".join(
        f'<div class="so-rec"><b>{escape(r["value"])}</b><span>{escape(r["label"])} &middot; {escape(r["pct"])}'
        f'{" &middot; " + escape(r["vs"]) if r.get("vs") else ""}</span></div>' for r in st.get("records", []))
    return f"""<section class="season-over" aria-label="Season over">
    <div class="so-tag">Season over &middot; {escape(st['label'])} &middot; Archived</div>
    <h2>The {escape(st['label'])} season is <em>over.</em></h2>
    <p>It ended {_day(st['last_day'])} with {escape(st['final'])}. These are the final records, saved in the
      <a href="{st['archive']}">archive</a>. Picks return on {escape(st['next_label'])}.</p>
    {f'<div class="so-recs">{recs}</div>' if recs else ''}
  </section>"""


def site_json(on=None):
    """/seasons.json: every league's state, for the home page."""
    return {"updated": datetime.now(ET).isoformat(timespec="seconds"),
            "leagues": {k: state(k, on) for k in config()}}


def archive_page():
    """/archive.html: every finished season's final records, newest first."""
    sys.path.insert(0, SHARED)
    import chrome  # noqa: E402
    rows = archived()
    if rows:
        items = "".join(f"""
    <section class="card archive-season" id="{escape(a['slug'])}-{escape(str(a['season']))}">
      <div class="so-tag">{escape(a['league'])} &middot; {escape(a['label'])} season</div>
      <h2>{escape(a['league'])} {escape(a['label'])}</h2>
      <p>Ended {_day(a['final_day'])}, {a['final_day'][:4]}, with {escape(a['final'])}. Live picks only, each graded
        against the final score. <a href="/{escape(a['slug'])}/accuracy.html">Accuracy page</a></p>
      <div class="so-recs">{''.join(f'<div class="so-rec"><b>{escape(r["value"])}</b><span>{escape(r["label"])} &middot; {escape(r["pct"])}{" &middot; " + escape(r["vs"]) if r.get("vs") else ""}</span></div>' for r in a['records'])}</div>
    </section>""" for a in rows)
    else:
        items = '<section class="card"><div class="empty-state">No finished seasons yet.</div></section>'
    head = "".join(f'<a href="#{a["slug"]}-{a["season"]}">{escape(a["league"])} {escape(a["label"])}</a>' for a in rows)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Past seasons | Sports Edge</title>
<meta name="description" content="Final records of every finished season on Sports Edge, frozen when the season ended.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v={datetime.now(ET):%Y%m%d}">
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
{chrome.nav("all")}
{chrome.hero("ARCHIVE", "Past seasons", "Season", "archive.", "Final records, frozen when each season ended")}
<div class="wrap edge-sheet">
  {chrome.pills(chrome.SITE_PILLS, None, "Pages")}
  {f'<nav class="edge-jump" aria-label="Seasons">{head}</nav>' if head else ''}
  <main id="main-content">{items}
  </main>
  <footer class="site-footer slim"><p class="footer-text">Each season's records are saved the day its season is
    over and never change after that. The all-time records on each league's page keep counting.
    For entertainment only, not betting advice. Gambling problem? Call 1-800-GAMBLER.</p>
    <nav class="footer-links" aria-label="Site"><a href="/">All sites</a><a href="/about.html">About</a><a href="/terms.html">Terms</a>
      <a href="/privacy.html">Privacy</a></nav></footer>
</div>
<script src="home.js"></script>
</body>
</html>
"""


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "show"
    if cmd == "idle" and len(argv) == 3:
        league = find(argv[2])
        try:
            print("yes" if league and state(league)["idle"] else "no")
        except Exception as e:  # never skip work because this broke
            print(f"seasons: {e}", file=sys.stderr)
            print("no")
        return 0
    if cmd == "archive":
        for k in config():
            try:
                p = freeze(k)
            except Exception as e:
                print(f"{k}: couldn't archive ({e})")
                continue
            if p:
                print(f"{k}: archived {os.path.relpath(p, ROOT)}")
        return 0
    if cmd == "site" and len(argv) == 3:
        with open(os.path.join(argv[2], "seasons.json"), "w") as f:
            json.dump(site_json(), f, indent=1)
        with open(os.path.join(argv[2], "archive.html"), "w") as f:
            f.write(archive_page())
        return 0
    if cmd == "show":
        for k in config():
            st = state(k)
            print(f"{k:7} {'OVER' if st['over'] else 'in season':9} idle={st['idle']!s:5} last={st.get('last_day')} "
                  f"next={st.get('next_start')} {'; '.join(_rec_line(r) for r in st.get('records', []))}")
        return 0
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
