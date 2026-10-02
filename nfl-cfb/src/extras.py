"""Game pages, the game cards on every sport's Home tab, and the data the home
site's Betting tab and "Last night" strip read, shared by every Sports Edge
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

and, for the game cards on each sport's Home tab (all optional): tv and venue
(from ESPN's scoreboard), "proj" on away/home (projected points), and lines
[(label, value html, "vegas"|"ours"|"", sub)] for the strip under the teams.
Soccer adds (also optional): "chance" on away/home (that team's own chance to
win, since a draw takes the rest), pick_name / pick_label / pick_sub for a pick
that isn't a team ("Draw"), and group (data-group on the card, for filters).

and this module renders the page, the cards and the JSON from it. Money
(units, "$10 a pick") only ever shows on the home site's Betting tab, which
reads it from summary.json: a moneyline unit is 1 bet at the price the pick
locked at, so dollars are units times 10. Live picks only.
"""
from datetime import date, datetime
from html import escape
from zoneinfo import ZoneInfo

MINUS = "−"


def price_text(price):
    price = int(round(price))
    return f"+{price}" if price > 0 else f"{MINUS}{abs(price)}"


def payout_text(price):
    """What a price pays: '$100 wins $135' / 'Bet $150 to win $100'."""
    return f"$100 wins ${price:,.0f}" if price >= 100 else f"Bet ${-price:,.0f} to win $100"


def short_day(iso):
    d = date.fromisoformat(iso[:10])
    return f"{d:%b} {d.day}"


# ── Units, for the home site's Betting tab ──────────────────────────────────
def _tally(rows):
    wins = sum(1 for r in rows if r[2])
    units = sum(r[1] for r in rows)
    return {"picks": len(rows), "wins": wins, "losses": len(rows) - wins, "units": round(units, 2),
            "roi": round(units / len(rows), 4) if rows else 0.0}


def units_summary(rows):
    """rows: (date, units, won, price, value) for every graded moneyline pick
    (no-decisions left out). The running total by day for the chart, and the
    same picks split into favorites, underdogs and value picks."""
    rows = sorted((str(r[0])[:10], float(r[1]), bool(r[2]), r[3], bool(r[4])) for r in rows if r[0])
    if not rows:
        return None
    by_day = {}
    for d, u, *_ in rows:
        by_day[d] = by_day.get(d, 0.0) + u
    total, series = 0.0, []
    for d in sorted(by_day):
        total += by_day[d]
        series.append([d, round(total, 2)])
    out = _tally(rows)
    out.update(since=rows[0][0], series=series, splits={
        "favorites": _tally([r for r in rows if r[3] is not None and r[3] < 0]),
        "underdogs": _tally([r for r in rows if r[3] is not None and r[3] > 0]),
        "value": _tally([r for r in rows if r[4]]),
    })
    return out


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
    name = t.get("name") or t["abbr"]
    longest = max(len(w) for w in name.split()) if name.split() else 1  # CSS shrinks long words to fit
    return (f'<div class="gh-team{" is-pick" if is_pick else ""}" style="--n:{longest}">{img}<b>{escape(name)}</b>'
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
    sub = f"{payout_text(ml['price'])}. We say {g['prob']:.0f}%, the price says {ml['book']:.0f}%."
    return ("Moneyline", f"{escape(g['pick'])} {price_text(ml['price'])}{value}", sub)


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
      <span class="gh-sub">{escape(g.get("pick_sub") or f"chance to beat {g['other']}")}</span>{note}</div>
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


# ── Game cards: every sport's Home tab ──────────────────────────────────────
# One card per game, two across (one on phones), grouped by day with buttons
# to show one day (site.js), our three surest open picks tagged "Top 3".
ET = ZoneInfo("America/New_York")


def _when(g):
    """'Sun 1:00 PM ET' from a game's start, or its day without one."""
    try:
        t = datetime.fromisoformat(str(g["start"]).replace("Z", "+00:00")).astimezone(ET)
        return f"{t:%a} {t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'} ET"
    except (KeyError, TypeError, ValueError):
        try:
            return f"{date.fromisoformat(g['date'][:10]):%a, %b} {int(g['date'][8:10])}"
        except (KeyError, TypeError, ValueError):
            return ""


def _logo(t):
    """The team's logo over its abbreviation, which shows if the image can't load."""
    img = (f'<img src="{escape(t["logo"])}" alt="" loading="lazy" onerror="this.remove()">'
           if t.get("logo") else "")
    return f'<span class="gc-logo" aria-hidden="true"><em>{escape(t["abbr"][:4])}</em>{img}</span>'


def _side_number(g, side):
    """What a team row shows on the right: the final score, else our
    projected points, else that team's chance to win."""
    t = g[side]
    if g.get("final") and t.get("score") is not None:
        return str(t["score"])
    if t.get("proj") is not None:
        return f"{t['proj']:.1f}"
    if t.get("chance") is not None:
        return f'{t["chance"]:.0f}<i>%</i>'
    chance = g["prob"] if g["pick"] == t["abbr"] else 100 - g["prob"]
    return f'{chance:.0f}<i>%</i>'


def _leads(g, side):
    """Whether this side is ahead: the winner once final, else the team our numbers favor."""
    other = "home" if side == "away" else "away"
    a, b = g[side], g[other]
    if g.get("final") and a.get("score") is not None and b.get("score") is not None:
        return a["score"] > b["score"]
    if a.get("proj") is not None and b.get("proj") is not None:
        return a["proj"] > b["proj"]
    return g["pick"] == a["abbr"]


def game_card(g, top=False):
    """One game: when, TV and stadium; both teams with their record and our
    projected points (or chance to win); the lines strip; and our pick to win
    with its odds and chance, and HIT / MISS once final."""
    head = "Final" if g.get("final") else ("Postponed" if g.get("void") else _when(g))
    if g.get("tv"):
        head += f" · {escape(g['tv'])}"
    tag = '<em class="gc-top">Top 3 pick</em>' if top else ""
    venue = f'<span class="gc-venue">{escape(g["venue"])}</span>' if g.get("venue") else ""
    rows = ""
    for side in ("away", "home"):
        t = g[side]
        rec = f"<small>{escape(t['record'])}</small>" if t.get("record") else ""
        rows += (f'<div class="gc-team{" is-lead" if _leads(g, side) else ""}">{_logo(t)}'
                 f'<span class="gc-name"><b>{escape(t.get("name") or t["abbr"])}</b>{rec}</span>'
                 f'<span class="gc-num">{_side_number(g, side)}</span></div>')
    lines = ""
    if g.get("lines"):
        cells = "".join(f'<div><dt>{escape(label)}</dt><dd class="{cls}">{value}'
                        f'{f"<small>{sub}</small>" if sub else ""}</dd></div>'
                        for label, value, cls, sub in g["lines"])
        lines = f'<dl class="gc-lines" style="--cols:{len(g["lines"])}">{cells}</dl>'
    pick_name = g.get("pick_name") or (g["home"]["name"] if g["pick"] == g["home"]["abbr"] else g["away"]["name"])
    ml = g.get("ml") or {}
    odds = f'<span class="gc-odds">{price_text(ml["price"])}</span>' if ml.get("price") is not None else ""
    value = '<span class="gc-value">Value</span>' if ml.get("value") else ""
    res = ""
    if g.get("void"):
        res = '<span class="pill pill-void">NO DECISION</span>'
    elif g.get("final") and g.get("hit") is not None:
        res = ('<span class="pill pill-positive">HIT</span>' if g["hit"]
               else '<span class="pill pill-danger">MISS</span>')
    group = f' data-group="{escape(g["group"])}"' if g.get("group") else ""
    return (f'<a class="gc{" is-top" if top else ""}" href="{g["file"]}" data-day="{escape(g["date"][:10])}"{group}>'
            f'<div class="gc-head"><span class="gc-when">{head}{tag}</span>{venue}</div>{rows}{lines}'
            f'<div class="gc-pick"><span class="gc-label">{escape(g.get("pick_label") or "Pick to win")}</span>'
            f'<b>{escape(pick_name or g["pick"])}</b>{odds}{value}{res}'
            f'<span class="gc-pct">{g["prob"]:.0f}<i>%</i></span></div></a>')


def _day_name(iso):
    d = date.fromisoformat(iso)
    return f"{d:%A}, {d:%b} {d.day}"


def game_board(games, top_n=3, empty=""):
    """Every game as a card, under a header per day, with day buttons when
    the games span more than one day."""
    if not games:
        return f'<div class="empty-state">{empty}</div>' if empty else ""
    games = sorted(games, key=lambda g: (g["date"][:10], str(g.get("start") or ""), g["id"]))
    live = [g for g in games if not g.get("final") and not g.get("void")]
    tops = {g["id"] for g in sorted(live, key=lambda g: -g["prob"])[:top_n]}
    days = {}
    for g in games:
        days.setdefault(g["date"][:10], []).append(g)
    chips = ""
    if len(days) > 1:
        chips = ('<div class="day-chips" role="group" aria-label="Day">'
                 f'<button type="button" data-day="all" aria-pressed="true">All games<span>{len(games)}</span></button>'
                 + "".join(f'<button type="button" data-day="{d}" aria-pressed="false">{date.fromisoformat(d):%A}'
                           f'<span>{len(gs)}</span></button>' for d, gs in days.items()) + "</div>")
    out = ""
    for d, gs in days.items():
        n = f"{len(gs)} game{'s' if len(gs) != 1 else ''}"
        out += (f'<section class="gc-day" data-day="{d}"><div class="gc-day-head"><h3>{_day_name(d)}</h3>'
                f'<span>{n}</span></div><div class="gc-grid">'
                + "".join(game_card(g, g["id"] in tops) for g in gs) + "</div></section>")
    return chips + out


def board_section(title, sub, body):
    """A Home tab section without a panel around it: a heading, a line on how
    to read it, and the cards."""
    sub = f"<p>{sub}</p>" if sub else ""
    return f'<section class="slate-sec"><div class="slate-head"><h2>{title}</h2>{sub}</div>{body}</section>'


# ── summary.json parts for the home site ─────────────────────────────────────
def slate_entry(g):
    """One game still to be decided, for the Betting tab and 'Next up'."""
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
