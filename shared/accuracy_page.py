"""The Accuracy tab: the same four sections, in the same order, on every sport.

  1. Record               this season's live picks as stat tiles (plus the
                          sport's moneyline record under them)
  2. Accuracy Over Time   by week and season to date: how often the picks won
                          next to how often the model expected them to
  3. Calibration          picks grouped by the chance the model gave them
  4. Backtest             how the model did on games it was never trained on
  then any sport-only extras (NFL TD props, the NFL/CFB charts against Vegas).

A section with nothing to show yet keeps its place with a short note, so the
page never changes shape between the offseason and the season. Each sport
builds a `spec` from its own data; this module only renders it.

spec keys (all optional except prefix):
  prefix       id prefix for the charts, unique per page ("acc", "acc-hits")
  noun         what's graded: {"chance": "Win chance", "actual": "Actually won",
               "rate": "Win rate", "count": "Picks", "won": "won"}
  record       {"subtitle", "tiles": [(value, label, sub)], "html", "note"}
  groups       [(label, [(prob 0-1, correct bool), ...], vegas)] oldest first;
               vegas is a list of bools (Vegas favourite won) or None
  trend_note   footnote under the charts
  calibration  {"rows": [(label, n, said, actual)], "note"}
  backtest     {"subtitle", "tiles", "groups", "rows", "note", "html"}
  extras       [(title, subtitle, html)] or ready-made card html
  empty        {"record", "trend", "calibration", "backtest"}: notes for
               sections with nothing yet
"""
import json
from datetime import date, timedelta
from html import escape

OURS, MODEL, VEGAS = "#e5793b", "#a8a7a1", "#8db4d8"

NOUN = {"chance": "Win chance", "actual": "Actually won", "rate": "Win rate", "count": "Picks", "won": "won"}


def pct(x, digits=1):
    return f"{x * 100:.{digits}f}%"


def card(title, subtitle, body):
    sub = f'<div class="subtitle">{subtitle}</div>' if subtitle else ""
    return f"""<section class="card">
    <div class="card-header"><h2>{title}</h2>{sub}</div>
    <div class="card-body">{body}</div>
  </section>"""


def statline(stats):
    return '<div class="statline">' + "".join(
        f'<div class="stat"><div class="stat-value">{v}</div><div class="stat-label">{label}</div>'
        f'<div class="stat-sub">{sub}</div></div>' for v, label, sub in stats) + "</div>"


def empty(text):
    return f'<div class="empty-state">{text}</div>'


# ── Charts (drawn by sport-pages.js initEdgeCharts from window.EDGE_CHARTS) ──
def chart(cid, title, labels, series, fmt="pct"):
    """series: [{"label", "data", "color", "dash"?}]. fmt: pct, num1, num3, pm1."""
    return {"id": cid, "title": title, "labels": labels, "fmt": fmt, "series": series}


def charts_html(charts):
    boxes = "".join(f'<div class="chart-card" data-state="loading"><canvas id="{escape(c["id"])}"></canvas></div>'
                    for c in charts)
    data = json.dumps(charts, separators=(",", ":")).replace("</", "<\\/")
    return boxes + f"<script>(window.EDGE_CHARTS = window.EDGE_CHARTS || []).push(...{data});</script>"


def weekly_groups(items):
    """items: [(date ISO, prob 0-1, correct)] -> groups by Monday-start week."""
    weeks = {}
    for d, p, c in items:
        day = date.fromisoformat(d[:10])
        weeks.setdefault(day - timedelta(days=day.weekday()), []).append((p, c))
    return [("Wk of " + wk.strftime("%b %-d"), weeks[wk], None) for wk in sorted(weeks)]


def trend_charts(groups, prefix, noun, unit="Week"):
    labels, actual, said, vegas, cum_a, cum_s, cum_v = [], [], [], [], [], [], []
    seen = right = conf = v_seen = v_right = 0
    for label, items, veg in groups:
        if not items:
            continue
        labels.append(label)
        actual.append(round(sum(c for _, c in items) / len(items), 3))
        said.append(round(sum(p for p, _ in items) / len(items), 3))
        seen += len(items)
        right += sum(c for _, c in items)
        conf += sum(p for p, _ in items)
        cum_a.append(round(right / seen, 3))
        cum_s.append(round(conf / seen, 3))
        if veg:
            v_seen += len(veg)
            v_right += sum(veg)
            vegas.append(round(sum(veg) / len(veg), 3))
            cum_v.append(round(v_right / v_seen, 3))
        else:
            vegas.append(None)
            cum_v.append(round(v_right / v_seen, 3) if v_seen else None)
    has_vegas = any(v is not None for v in vegas)
    rate = noun["rate"].lower()

    def series(a, s, v):
        out = [{"label": f"Our picks, {rate}", "data": a, "color": OURS},
               {"label": "What the model expected", "data": s, "color": MODEL, "dash": [4, 4]}]
        if has_vegas:
            out.append({"label": "Vegas favorites", "data": v, "color": VEGAS})
        return out
    title = noun["rate"].title()
    return [chart(f"{prefix}-weekly", f"{title} by {unit}", labels, series(actual, said, vegas)),
            chart(f"{prefix}-cumulative", f"{title}, Season to Date", labels, series(cum_a, cum_s, cum_v))]


def bands(items, edges):
    """items: [(prob 0-1, correct)]; edges: [(lo, hi)] in 0-1, hi >= 1 for the top band."""
    rows = []
    for lo, hi in edges:
        b = [(p, c) for p, c in items if lo <= p < hi]
        if b:
            label = f"{lo:.0%} and up" if hi >= 1 else (f"Under {hi:.0%}" if lo <= 0 else f"{lo:.0%}-{hi:.0%}")
            rows.append((label, len(b), sum(p for p, _ in b) / len(b), sum(c for _, c in b) / len(b)))
    return rows


def calibration_table(rows, noun, note=""):
    body = "".join(f"""<tr><td class="row-label">{label}</td>
      <td data-label="{noun['count']}" class="num">{n}</td>
      <td data-label="Model said" class="num">{pct(said)}</td>
      <td data-label="{noun['actual']}" class="num accent">{pct(actual)}</td></tr>""" for label, n, said, actual in rows)
    foot = note or "If the model is honest, each row's two percentages should be close. Small rows swing a lot."
    return f"""<table class="data record-table responsive-stack">
      <thead><tr><th>{noun['chance']}</th><th class="num">{noun['count']}</th><th class="num">Model said</th>
      <th class="num">{noun['actual']}</th></tr></thead>
      <tbody>{body}</tbody></table><div class="table-footnote">{foot}</div>"""


def record_tiles(items, noun, strong=None, as_rate=False):
    """items: [(date ISO, prob 0-1, correct)] this season, graded. Three tiles:
    the season, the last 7 days, and the model's most confident picks."""
    def tile(sub_items, label):
        n = len(sub_items)
        if not n:
            return ("-", label, "no graded picks")
        w = sum(c for _, _, c in sub_items)
        said = sum(p for _, p, _ in sub_items) / n
        if as_rate:
            return (pct(w / n), label, f"{w} of {n} {noun['won']}; model said {pct(said)}")
        return (f"{w}-{n - w}", label, f"{pct(w / n)} right; model said {pct(said)}")
    last = max(d for d, _, _ in items)[:10]
    week_ago = (date.fromisoformat(last) - timedelta(days=6)).isoformat()
    tiles = [tile(items, "This season"), tile([i for i in items if i[0][:10] >= week_ago], "Last 7 days")]
    if strong is not None:
        tiles.append(tile([i for i in items if i[1] >= strong], f"Picks at {strong:.0%}+"))
    return tiles


def band_rows(bands):
    """A model file's backtest bands [{range: [lo, hi], n, predicted, actual}] as calibration rows."""
    def label(lo, hi):
        return f"{lo:.0%} and up" if hi >= 1 else (f"Under {hi:.0%}" if lo <= 0 else f"{lo:.0%}-{hi:.0%}")
    return [(label(*b["range"]), b["n"], b["predicted"], b["actual"]) for b in bands]


def ml_tile(rec):
    """moneyline.record(...) -> a Record tile, or None."""
    if not rec:
        return None
    return (f"{rec['wins']}-{rec['losses']}", "Moneyline", f"{rec['units']:+.2f} units, {rec['roi']:+.1%} ROI")


def season_items(items, season_of):
    """Keep the latest season's items: [(date ISO, ...)] -> (season, items)."""
    if not items:
        return None, []
    season = season_of(max(i[0] for i in items)[:10])
    return season, [i for i in items if season_of(i[0][:10]) == season]


def has_charts(html):
    return "EDGE_CHARTS" in html


def render(spec):
    noun = dict(NOUN, **spec.get("noun", {}))
    prefix = spec["prefix"]
    blanks = spec.get("empty", {})
    parts = []

    rec = spec.get("record") or {}
    if rec.get("tiles"):
        body = statline(rec["tiles"])
        if rec.get("note"):
            body += f'<div class="table-footnote">{rec["note"]}</div>'
    else:
        body = empty(blanks.get("record", "No graded picks yet this season."))
    body += rec.get("html", "")
    parts.append(card("Record", rec.get("subtitle", "This season's live picks, graded against the final score"), body))

    groups = [g for g in spec.get("groups") or [] if g[1]]
    if groups:
        n = sum(len(g[1]) for g in groups)
        body = charts_html(trend_charts(groups, prefix, noun, spec.get("unit", "Week")))
        if spec.get("trend_note"):
            body += f'<div class="table-footnote">{spec["trend_note"]}</div>'
        parts.append(card("Accuracy Over Time", f"{n} graded picks: how often they {noun['won']} vs. what the "
                          "model expected", body))
    else:
        parts.append(card("Accuracy Over Time", "How often the picks win vs. what the model expected",
                          empty(blanks.get("trend", "The charts start after the first week of graded picks."))))

    cal = spec.get("calibration") or {}
    if cal.get("rows"):
        body = calibration_table(cal["rows"], noun, cal.get("note", ""))
    else:
        body = empty(blanks.get("calibration", "Fills in once picks are graded."))
    parts.append(card("Calibration", f"Picks grouped by the {noun['chance'].lower()} the model gave them", body))

    bt = spec.get("backtest") or {}
    if bt:
        body = statline(bt["tiles"]) if bt.get("tiles") else ""
        if bt.get("groups"):
            body += charts_html(trend_charts([g for g in bt["groups"] if g[1]], f"{prefix}-bt", noun,
                                             bt.get("unit", "Month")))
        if bt.get("rows"):
            body += calibration_table(bt["rows"], noun, bt.get("note", ""))
        elif bt.get("note"):
            body += f'<div class="table-footnote">{bt["note"]}</div>'
        body += bt.get("html", "")
        parts.append(card("Backtest", bt.get("subtitle", "How the model did on games it was never trained on"), body))
    else:
        parts.append(card("Backtest", "How the model did on games it was never trained on",
                          empty(blanks.get("backtest", "No backtest yet."))))

    for extra in spec.get("extras", []):
        parts.append(extra if isinstance(extra, str) else card(*extra))
    return "".join(parts)


def switcher(panels, label):
    """[(panel id, button text, html)] -> buttons that show one panel at a
    time (sport-pages.js initSwitchers). Used where a sport has two models."""
    buttons = "".join(
        f'<button type="button" class="subtab{" active" if i == 0 else ""}" aria-pressed="{str(i == 0).lower()}" '
        f'data-panel="{pid}">{escape(text)}</button>' for i, (pid, text, _) in enumerate(panels))
    return (f'<div class="subtabs model-switch" role="group" aria-label="{escape(label)}">{buttons}</div>'
            + "".join(f'<div class="switch-panel" id="{pid}"{"" if i == 0 else " hidden"}>{html}</div>'
                      for i, (pid, _, html) in enumerate(panels)))
