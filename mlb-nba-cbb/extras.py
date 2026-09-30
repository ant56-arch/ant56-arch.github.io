"""Game pages, the "$10 a pick" record and chart, and the data the home site's
Best Bets page and "Last night" strip read, shared by every Sports Edge
builder. Keep nfl-cfb/src/extras.py and mlb-nba-cbb/extras.py identical.

Each builder turns its own picks into one game shape (a dict):

  sport     "MLB", "NFL" ...        id, file, url   ("849848", "game-849848.html", "/mlb/game-849848.html")
  date      "YYYY-MM-DD" (ET)       start           ISO time or None
  label     "Wild Card · Wed, Sep 30 · 8:00 PM ET"
  away/home {"abbr", "name", "record", "logo", "score"}
  pick, other, prob (percent)       final, hit (True/False/None), void
  ml        {"price", "book" (percent), "value", "units", "won"} or None
  why       [(factor, pull toward our pick)]; facts [(label, value html, sub)]
  hitters   [(name, team, chance, result html)]; note (html, the lock note)

and this module renders the page and the JSON from it. Money here is the
record of betting $10 on every moneyline pick at the price it locked at:
a moneyline unit is 1 bet, so dollars are units times 10. Live picks only.
"""
from datetime import date, datetime, timedelta
from html import escape

STAKE = 10  # dollars a pick
MINUS = "−"


def money(units, stake=STAKE):
    """'+$136.40' / '−$81.80' for a number of units at stake dollars a unit."""
    d = round(units * stake, 2)
    return f"{'+' if d >= 0 else MINUS}${abs(d):,.2f}"


def price_text(price):
    price = int(round(price))
    return f"+{price}" if price > 0 else f"{MINUS}{abs(price)}"


def short_day(iso):
    d = date.fromisoformat(iso[:10])
    return f"{d:%b} {d.day}"


# ── "$10 a pick" ─────────────────────────────────────────────────────────────
def units_summary(rows):
    """rows: (date, units, won) for every graded moneyline pick (no-decisions
    left out). The running total by day, for the chart and summary.json."""
    rows = sorted((str(d)[:10], float(u), bool(w)) for d, u, w in rows if d)
    if not rows:
        return None
    by_day = {}
    for d, u, _ in rows:
        by_day[d] = by_day.get(d, 0.0) + u
    total, series = 0.0, []
    for d in sorted(by_day):
        total += by_day[d]
        series.append([d, round(total, 2)])
    wins = sum(1 for r in rows if r[2])
    return {"units": round(total, 2), "roi": round(total / len(rows), 4), "picks": len(rows), "wins": wins,
            "losses": len(rows) - wins,
            "since": rows[0][0], "series": series}


def _nice_step(span):
    for step in (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000):
        if span / step <= 6:
            return step
    return 10000


def units_chart(lines, end=None):
    """An SVG step chart of running dollars. lines: [(label, css color,
    units_summary)]. Every line starts at $0 the day before its first pick."""
    lines = [ln for ln in lines if ln[2]]
    if not lines:
        return ""
    W, H, L, R, T, B = 760, 300, 60, 176, 16, 34
    starts = [date.fromisoformat(s["series"][0][0]) - timedelta(days=1) for _, _, s in lines]
    d0 = min(starts)
    d1 = max([date.fromisoformat(s["series"][-1][0]) for _, _, s in lines] + ([end] if end else []))
    if d1 <= d0:
        d1 = d0 + timedelta(days=1)
    vals = [0.0] + [v * STAKE for _, _, s in lines for _, v in s["series"]]
    step = _nice_step(max(vals) - min(vals) or 1)
    lo = min(0, step * (min(vals) // step))
    hi = step * -(-max(vals) // step)
    hi = max(hi, lo + step)

    def x(d):
        return L + (W - L - R) * (d - d0).days / (d1 - d0).days

    def y(v):
        return T + (H - T - B) * (hi - v) / (hi - lo)

    out = []
    v = lo
    while v <= hi + 1e-9:
        cls = "z" if v == 0 else "g"
        lab = "$0" if v == 0 else f"{'+' if v > 0 else MINUS}${abs(v):,.0f}"
        out.append(f'<line x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="{cls}"/>'
                   f'<text x="{L - 8}" y="{y(v) + 4:.1f}" text-anchor="end" class="t">{lab}</text>')
        v += step
    days = (d1 - d0).days
    ticks = [d0, d0 + timedelta(days=days // 2), d1] if days >= 2 else [d0, d1]
    for d in ticks:
        out.append(f'<text x="{x(d):.1f}" y="{H - 10}" text-anchor="middle" class="t">{d:%b} {d.day}</text>')
    # End labels, nudged apart so they never overlap.
    ends = sorted(((y(s["series"][-1][1] * STAKE), i) for i, (_, _, s) in enumerate(lines)))
    placed, last = {}, -99
    for yy, i in ends:
        yy = max(yy, last + 16)
        placed[i] = yy
        last = yy
    for i, (label, color, s) in enumerate(lines):
        path, first = "", True
        pts = [(date.fromisoformat(s["series"][0][0]) - timedelta(days=1), 0.0)] + \
              [(date.fromisoformat(d), u * STAKE) for d, u in s["series"]]
        for d, val in pts:
            path += f"M{x(d):.1f},{y(val):.1f}" if first else f" H{x(d):.1f} V{y(val):.1f}"
            first = False
        path += f" H{x(d1):.1f}"
        endv = s["series"][-1][1] * STAKE
        name = f"{escape(label)} " if label else ""
        out.append(f'<path d="{path}" fill="none" style="stroke:{color}" stroke-width="2.5" stroke-linejoin="round"/>'
                   f'<circle cx="{x(d1):.1f}" cy="{y(endv):.1f}" r="4" style="fill:{color}"/>'
                   f'<text x="{x(d1) + 10:.1f}" y="{placed[i] + 4:.1f}" class="lab" style="fill:{color}">'
                   f'{name}{money(s["series"][-1][1])}</text>')
    desc = "; ".join(f"{label or 'total'} {money(s['units'])} over {s['picks']} picks" for label, _, s in lines)
    return (f'<div class="money-chart"><svg viewBox="0 0 {W} {H}" role="img" '
            f'aria-label="Running total from ${STAKE} on every moneyline pick: {escape(desc)}">'
            + "".join(out) + "</svg></div>")


def dollars_body(summary, what="moneyline pick"):
    """The '$10 a pick' panel: the total, the record behind it, and the chart."""
    if not summary:
        return (f'<div class="empty-state">This starts with the first graded {what}: ${STAKE} on every one, at '
                'the price when it locked.</div>')
    s = summary
    roi = s.get("roi", s["units"] / s["picks"] if s["picks"] else 0)
    tone = "is-up" if s["units"] >= 0 else "is-down"
    tiles = [
        (f'<span class="{tone}">{money(s["units"])}</span>', f"${STAKE} on every pick",
         f"${s['picks'] * STAKE:,} risked on {s['picks']} picks"),
        (f"{s['wins']}-{s['losses']}", "Moneyline record", f"since {short_day(s['since'])}"),
        (f"{roi:+.1%}", "Return", "profit per dollar risked"),
    ]
    stat = "".join(f'<div class="stat"><div class="stat-value">{v}</div><div class="stat-label">{lab}</div>'
                   f'<div class="stat-sub">{sub}</div></div>' for v, lab, sub in tiles)
    return (f'<div class="statline">{stat}</div>'
            + units_chart([("", "var(--ours)", s)])
            + f'<div class="table-footnote">If you had bet ${STAKE} on our pick in every game with a moneyline, at the '
              'price when it locked. Live picks only, never a backtest. A postponed game or a tie is no bet.</div>')


# ── Game pages ───────────────────────────────────────────────────────────────
def _card(title, body, sub=""):
    sub = f'<div class="subtitle">{sub}</div>' if sub else ""
    return (f'<section class="card"><div class="card-header"><h2>{title}</h2>{sub}</div>'
            f'<div class="card-body">{body}</div></section>')


def result_line(g):
    """'Final: NYY 9, BOS 0. Our pick hit.' once graded, else ''."""
    a, h = g["away"], g["home"]
    if g.get("void"):
        return "Postponed. No decision on this pick."
    if not g.get("final") or a.get("score") is None:
        return ""
    verdict = {True: "Our pick hit.", False: "Our pick missed."}.get(g.get("hit"), "No decision.")
    return f"Final: {a['abbr']} {a['score']}, {h['abbr']} {h['score']}. {verdict}"


def _team(t, is_pick):
    img = (f'<img class="gh-logo" src="{escape(t["logo"])}" alt="" loading="lazy" '
           f'onerror="this.style.display=\'none\'">' if t.get("logo") else "")
    sub = " · ".join(x for x in (t.get("abbr") if t.get("name") != t.get("abbr") else "", t.get("record")) if x)
    score = f'<span class="gh-score">{t["score"]}</span>' if t.get("score") is not None else ""
    return (f'<div class="gh-team{" is-pick" if is_pick else ""}">{img}<b>{escape(t.get("name") or t["abbr"])}</b>'
            f'<small>{escape(sub)}</small>{score}</div>')


def why_html(g):
    """Each factor's share of the model's lean, and which team it helps."""
    items = [(label, v) for label, v in g.get("why") or [] if v]
    total = sum(abs(v) for _, v in items)
    if not total:
        return ""
    rows = ""
    for label, v in sorted(items, key=lambda it: -abs(it[1])):
        share = abs(v) / total
        helps = g["pick"] if v > 0 else g["other"]
        rows += (f'<li class="{"" if v > 0 else "is-against"}"><span class="why-label">{escape(label)}'
                 f'<small>helps {escape(helps)}</small></span><span class="why-bar" aria-hidden="true">'
                 f'<span style="width:{share * 100:.0f}%"></span></span><span class="why-pct">{share:.0%}</span></li>')
    return (f'<ul class="why-list">{rows}</ul><div class="table-footnote">Share of the model\'s lean that comes from '
            'each factor, and which team it pulls toward.</div>')


def ml_fact(g):
    ml = g.get("ml")
    if not ml:
        return ("Moneyline", '<span class="faint">No price posted</span>', "")
    value = ' <span class="pill pill-positive">VALUE</span>' if ml.get("value") else ""
    res = ""
    if ml.get("won") is not None and ml.get("units") is not None:
        res = (f' <span class="pill pill-{"positive" if ml["won"] else "danger"}">'
               f'{money(ml["units"])}</span>')
    sub = f"We say {g['prob']:.0f}%, the price says {ml['book']:.0f}%."
    return ("Moneyline", f"{escape(g['pick'])} {price_text(ml['price'])}{value}{res}", sub)


def game_page_body(g, back_href="index.html", back_text="All picks"):
    a, h = g["away"], g["home"]
    at = "vs" if g.get("neutral") else "@"
    result = result_line(g)
    res_pill = ""
    if g.get("final") and g.get("hit") is not None:
        res_pill = (' <span class="pill pill-positive">HIT</span>' if g["hit"]
                    else ' <span class="pill pill-danger">MISS</span>')
    note = f'<div class="gh-note">{escape(result)}{res_pill}</div>' if result else ""
    if g.get("note"):
        note += f'<div class="gh-lock">{g["note"]}</div>'
    hero = f"""<section class="card game-hero">
    <div class="gh-when">{escape(g.get("label") or "")}</div>
    <div class="gh-teams">{_team(a, g["pick"] == a["abbr"])}<div class="gh-at">{at}</div>{_team(h, g["pick"] == h["abbr"])}</div>
    <div class="gh-verdict"><span class="rb-eyebrow">Our pick</span>
      <span class="gh-big">{escape(g["pick"])} {g["prob"]:.0f}<small>%</small></span>
      <span class="gh-sub">chance to beat {escape(g["other"])}</span>{note}</div>
  </section>"""
    facts = [ml_fact(g)] + list(g.get("facts") or [])
    dl = "".join(f'<div><dt>{escape(label)}</dt><dd>{value}{f"<small>{escape(sub)}</small>" if sub else ""}</dd></div>'
                 for label, value, sub in facts)
    panels = ""
    why = why_html(g)
    if why:
        panels += _card(f"Why the model likes {escape(g['pick'])}", why)
    panels += _card("The matchup", f'<dl class="gh-facts">{dl}</dl>')
    body = hero + f'<div class="gh-grid">{panels}</div>'
    if g.get("hitters"):
        rows = "".join(f'<li><span class="hw-name"><b>{escape(n)}</b><small>{escape(t)}</small></span>'
                       f'<span class="hw-pct">{c:.0f}%</span><span class="hw-res">{r}</span></li>'
                       for n, t, c, r in g["hitters"])
        body += _card("Hitters to watch", f'<ul class="hw-list">{rows}</ul>',
                      "Our hitter picks in this game and their chance to get a hit")
    body += f'<p class="gh-back"><a href="{back_href}">&larr; {escape(back_text)}</a></p>'
    return body


def game_link(g, text="Game page"):
    return f'<a class="pl-link" href="{g["file"]}">{text} &rarr;</a>'


# ── summary.json parts for the home site ─────────────────────────────────────
def slate_entry(g):
    """One game still to be decided, for Best Bets and 'Next up'."""
    ml = g.get("ml") or {}
    return {"sport": g["sport"], "id": g["id"], "url": g["url"], "start": g.get("start"), "date": g["date"],
            "away": g["away"]["abbr"], "home": g["home"]["abbr"], "at": "vs" if g.get("neutral") else "@",
            "pick": g["pick"], "other": g["other"], "prob": round(g["prob"], 1),
            "price": int(round(ml["price"])) if ml.get("price") is not None else None,
            "book": round(ml["book"], 1) if ml.get("book") is not None else None, "value": bool(ml.get("value"))}


def recap_text(g):
    """'NYY 9-0' when our pick won, 'HOU lost 6-3' when it lost."""
    a, h = g["away"], g["home"]
    mine, theirs = (a["score"], h["score"]) if g["pick"] == a["abbr"] else (h["score"], a["score"])
    return f"{g['pick']} {mine}-{theirs}" if g.get("hit") else f"{g['pick']} lost {theirs}-{mine}"


def last_day(games, hitters=None):
    """The latest day with final games: each game pick's result and what $10
    on its moneyline did. hitters: {date: [{"name", "hit", "line"}]}."""
    done = [g for g in games if g.get("final") and g.get("hit") is not None and g["away"].get("score") is not None]
    day = max((g["date"] for g in done), default=None)
    if hitters:
        hdays = [d for d, hs in hitters.items() if hs]
        day = max([d for d in (day,) if d] + hdays, default=None)
    if not day:
        return None
    out = {"date": day, "games": [], "hits": (hitters or {}).get(day, [])}
    for g in sorted((g for g in done if g["date"] == day), key=lambda g: (g.get("start") or "", g["id"])):
        ml = g.get("ml") or {}
        out["games"].append({"pick": g["pick"], "other": g["other"], "hit": bool(g["hit"]), "text": recap_text(g),
                             "units": ml.get("units") if ml.get("won") is not None else None, "url": g["url"]})
    return out


def iso_et(day, hhmm, tz):
    """ISO time from a date and 'HH:MM' Eastern, or None."""
    try:
        return datetime.fromisoformat(f"{day[:10]}T{hhmm}").replace(tzinfo=tz).isoformat()
    except (TypeError, ValueError):
        return None
