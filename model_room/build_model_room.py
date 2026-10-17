#!/usr/bin/env python3
"""build_model_room.py - builds "Model Room", one self-contained private page
that shows, for every sport, what each model looks like inside, what it would
have predicted, and how it is doing (the good, the bad, and why).

Usage:  python3 model_room/build_model_room.py <repo_root> [out.html]

repo_root is a checkout of ant56-arch/ant56-arch.github.io. Only the standard
library is used (csv/json), so it runs anywhere. Nothing in the repo is
written. Records count live picks only, never backtests, and ties are left
out. Every bullet needs a sample of at least MIN_N games and prints its size.
"""

import csv
import datetime as dt
import glob
import html
import json
import math
import os
import re
import sys

MIN_N = 8          # smallest sample a Working / Falls short bullet may use
GRADE_MIN_N = 15   # smallest live sample that gets a Working / Mixed / Falling short grade
SMALL_N = 100      # under this, add the small-sample caution
STAKE = 10         # dollars a pick for the moneyline / Value results

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "dist/model-room.html"
NFL_DIR = os.path.join(ROOT, "nfl-cfb")
TRACK = os.path.join(NFL_DIR, "data", "tracking")
NFL_MODELS = os.path.join(NFL_DIR, "src", "models")
MB = os.path.join(ROOT, "mlb-nba-cbb")

MISSING = []       # data we looked for and couldn't find
DATA_DATES = {}    # source -> newest date seen, for the footer


# ── small helpers ────────────────────────────────────────────────────────────
def path(*p):
    return os.path.join(*p)


def load_json(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        MISSING.append(os.path.relpath(p, ROOT))
        return default


def load_csv(p):
    try:
        with open(p, newline="") as f:
            return list(csv.DictReader(f))
    except OSError:
        MISSING.append(os.path.relpath(p, ROOT))
        return []


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if (isinstance(v, float) and math.isnan(v)) else float(v)
    v = str(v).strip()
    if v == "" or v.lower() in ("nan", "none", "null"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "1.0")


def esc(s):
    return html.escape(str(s), quote=True)


def rec(w, l):
    return f"{w}-{l}"


def pc(x, d=0):
    return f"{x * 100:.{d}f}%"


def pct_of(w, n):
    return w / n if n else 0.0


def money(units_total):
    d = units_total * STAKE
    return ("up" if d >= 0 else "down") + f" ${abs(d):,.0f}"


def S(x):
    return f'<span class="num">{esc(x)}</span>'


def nice_date(s, year=False):
    try:
        d = dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return str(s)
    out = d.strftime("%b ") + str(d.day)
    return out + (f", {d.year}" if year else "")


def note_date(src, s):
    if not s:
        return
    s = str(s)[:10]
    if re.match(r"\d{4}-\d{2}-\d{2}", s) and s <= dt.date.today().isoformat() and s > DATA_DATES.get(src, ""):
        DATA_DATES[src] = s


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def american_to_prob(p):
    p = num(p)
    if p is None or p == 0:
        return None
    return 100 / (p + 100) if p > 0 else -p / (-p + 100)


def price_str(p):
    p = num(p)
    if p is None:
        return ""
    return f"+{p:.0f}" if p > 0 else f"{p:.0f}"


def ordinal(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def grade_chip(name):
    cls = {"Working": "g-good", "Mixed": "g-mixed", "Falling short": "g-bad"}.get(name, "g-none")
    return f'<span class="grade {cls}">{esc(name)}</span>'


SCORE_PULL = 100  # picks of "no edge" mixed into every Edge score, so a short hot streak can't max it out


def edge_score(model_pct, base_pct, n):
    """One 1-100 score for every model in every league: 50 means it picks winners
    exactly as often as its baseline (the Vegas favorite, or the home team / the
    average hitter where there are no odds) on the same games. Each point of
    pick rate above the baseline adds 10, each point below takes 10 away, after
    pulling small samples toward 50: the gap counts n / (n + SCORE_PULL) of its
    size. None under GRADE_MIN_N picks."""
    if n < GRADE_MIN_N:
        return None
    gap = (model_pct - base_pct) * 100 * n / (n + SCORE_PULL)
    return max(1, min(100, round(50 + 10 * gap)))


def score_chip(score):
    if score is None:
        return ""
    cls = "g-good" if score >= 60 else "g-bad" if score < 45 else "g-mixed"
    return f'<span class="score {cls}" title="Edge score: 50 matches the baseline">{score}<small>/100</small></span>'


def grade_from(model_pct, base_pct, n, m=None):
    """Simple rule: at least GRADE_MIN_N live picks, then 2+ points better than
    the baseline is Working, 3+ points worse is Falling short, else Mixed. With
    m, also sets the model's Edge score from the same numbers."""
    if m is not None:
        m["score"] = edge_score(model_pct, base_pct, n)
    if n < GRADE_MIN_N:
        return "Not graded"
    d = (model_pct - base_pct) * 100
    if d >= 2:
        return "Working"
    if d <= -3:
        return "Falling short"
    return "Mixed"


def calib_buckets(pairs, edges=(0.5, 0.6, 0.7, 0.8, 1.01)):
    """pairs: (chance given to the picked side, won 1/0). Buckets with n >= MIN_N."""
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        b = [(p, w) for p, w in pairs if lo <= p < hi]
        if len(b) >= MIN_N:
            out.append({"lo": lo, "hi": min(hi, 1.0), "n": len(b), "pred": mean([p for p, _ in b]),
                        "act": mean([w for _, w in b])})
    return out


def calib_bullets(buckets, noun="picks", good=None, bad=None):
    for b in buckets:
        rng = (f"under {b['hi'] * 100:.0f}%" if b["lo"] <= 0 else f"{b['lo'] * 100:.0f}-{b['hi'] * 100:.0f}%" if b["hi"] < 1 else f"{b['lo'] * 100:.0f}% or more")
        gap = b["act"] - b["pred"]
        line = (f"{noun.capitalize()} it gave {rng} won {S(pc(b['act']))} of the time "
                f"({b['n']} {noun}, it expected {pc(b['pred'])}).")
        if abs(gap) <= 0.07:
            good.append("Its chances are honest here. " + line)
        elif gap < 0:
            bad.append("Too sure of itself here. " + line)
        else:
            bad.append("Too cautious here. " + line)


def bar_chart(groups, a_label, b_label, caption):
    """groups: [(label, a_w, a_n, b_w, b_n)] -> weekly winners chart (SVG)."""
    groups = [g for g in groups if g[2] >= 5]
    if len(groups) < 2:
        return ""
    W = 560
    left, right, base, top = 40, 550, 150, 30
    slot = (right - left) / len(groups)
    bw = min(36, slot / 2 - 6)
    parts = [f'<line x1="{left}" y1="{base}" x2="{right}" y2="{base}" stroke="var(--rule)"/>',
             f'<line x1="{left}" y1="90" x2="{right}" y2="90" stroke="var(--rule)" stroke-dasharray="3 4"/>',
             f'<line x1="{left}" y1="{top}" x2="{right}" y2="{top}" stroke="var(--rule)" stroke-dasharray="3 4"/>',
             f'<text x="32" y="154" text-anchor="end">0</text><text x="32" y="94" text-anchor="end">50%</text>'
             f'<text x="32" y="34" text-anchor="end">100%</text>']
    for i, (lab, aw, an, bw_, bn) in enumerate(groups):
        cx = left + slot * i + slot / 2
        for j, (w, n, col) in enumerate(((aw, an, "var(--ours)"), (bw_, bn, "var(--vegas)"))):
            if not n:
                continue
            h = 120 * w / n
            x = cx - bw - 2 if j == 0 else cx + 2
            parts.append(f'<rect x="{x:.1f}" y="{base - h:.1f}" width="{bw:.1f}" height="{h:.1f}" fill="{col}"/>')
            parts.append(f'<text x="{x + bw / 2:.1f}" y="{base - h - 6:.1f}" text-anchor="middle">{w}</text>')
        parts.append(f'<text x="{cx:.1f}" y="172" text-anchor="middle">{esc(lab)}</text>')
    return (f'<figure><div class="chart"><svg viewBox="0 0 {W} 190" width="100%" style="min-width:420px" role="img" '
            f'aria-label="{esc(caption)}">' + "".join(parts) + '</svg></div>'
            f'<div class="legend"><span style="--c:var(--ours)">{esc(a_label)}</span>'
            f'<span style="--c:var(--vegas)">{esc(b_label)}</span></div>'
            f'<figcaption>{esc(caption)}</figcaption></figure>')


# ── recipe settings in plain words ───────────────────────────────────────────
SETTING_WORDS = {
    "team_half_life": ("Forgets team form", lambda v: f"half after {v} games"),
    "rating_half_life": ("Forgets old ratings", lambda v: f"half after {v} weeks"),
    "seasons": ("Seasons it learns from", lambda v: "All" if v == "all" else f"Last {v}"),
    "years": ("Seasons it learns from", lambda v: f"Last {v}"),
    "l2": ("Holds weights back", lambda v: "More" if float(v) >= 0.01 else "Less"),
    "park": ("Ballpark effect", lambda v: "Learned from games" if v == "learned" else "Fixed table"),
    "elo_k": ("How much one result moves a rating", lambda v: str(v)),
    "elo_carry": ("Rating kept from last season", lambda v: f"{float(v) * 100:.0f}%"),
    "sp_shrink": ("Average innings mixed into each starter", lambda v: str(v)),
    "half_life": ("Forgets old games", lambda v: "Never" if v is None else f"half after {v} days"),
    "carry": ("Rating kept from last season", lambda v: f"{float(v) * 100:.0f}%"),
    "reg": ("Pull toward league average", lambda v: str(v)),
    "xg": ("Share built from shots on target", lambda v: f"{float(v) * 100:.0f}%"),
    "home_reg": ("Pull of each league's home edge", lambda v: "One shared edge" if v is None else str(v)),
    "extras": ("Extra inputs", lambda v: ", ".join({"rest": "Rest and travel", "injuries": "Players out"}.get(x, x) for x in v) if v else "None"),
}
SETTING_HELP = {
    "team_half_life": "how fast it forgets old games when it sizes up a team's form",
    "rating_half_life": "how fast the power ratings forget old games",
    "seasons": "how many past seasons it learns from",
    "years": "how many past seasons it learns from",
    "l2": "how hard it holds its weights back from extreme values, so one odd stretch can't run away with it",
    "park": "whether ballpark effects come from a fixed table or are learned from the games",
    "elo_k": "how much one result moves a team's rating (bigger reacts faster)",
    "elo_carry": "how much of last season's rating a team keeps when the new season starts",
    "sp_shrink": "how many innings of an average pitcher get mixed into each starter's line, so a few good starts don't fool it",
    "half_life": "how fast it forgets old games (days until a game counts half)",
    "carry": "how much of last season's rating a team starts the new season with",
    "reg": "how hard a club with few results is pulled toward its league's average",
    "xg": "how much of the rating comes from shots on target instead of goals",
    "home_reg": "how hard each league's home edge is pulled toward the overall one",
    "extras": "inputs added on top of the power ratings: rest days and travel, or how much of each lineup is on the injury report",
}


def recipe_cell(k, v):
    lab, f = SETTING_WORDS.get(k, (k, str))
    if v is None and k == "xg":
        return "0% (off)"
    if isinstance(v, float) and v.is_integer() and k in ("reg", "home_reg"):
        v = int(v)
    try:
        return f(v)
    except (TypeError, ValueError):
        return str(v)


def tryouts_block(cands, live_recipe, metrics, run, title_note="", higher_better=None, extra_callout=""):
    """cands: [{'recipe':{}, metric:...}]; metrics: [(key, label, fmt, lower_is_better)]."""
    if not cands:
        return None
    keys = []
    for c in cands:
        for k in c["recipe"]:
            if k not in keys:
                keys.append(k)
    keys = [k for k in keys if len({json.dumps(c["recipe"].get(k)) for c in cands}) > 1] or keys
    rows = []
    live_idx = None
    for i, c in enumerate(cands):
        is_live = live_recipe is not None and all(c["recipe"].get(k) == live_recipe.get(k) for k in c["recipe"])
        if is_live and live_idx is None:
            live_idx = i
    letters = iter(list("BCDEFGHIJKLMNOPQRSTUVWXYZ") + [f"Z{k}" for k in range(2, 200)])
    main_key, _, _, main_lower = metrics[0]
    score = lambda i: cands[i].get(main_key, 9e9) if main_lower else -cands[i].get(main_key, -9e9)
    best_i = min(range(len(cands)), key=score)
    others = [i for i in range(len(cands)) if i != live_idx]
    hidden = 0
    if len(cands) > 8:
        others = sorted(others, key=score)
        hidden = len(others) - 7
        others = others[:7]
    order = ([live_idx] if live_idx is not None else []) + others
    for i in order:
        c = cands[i]
        name = "Live" if i == live_idx else next(letters)
        cells = [name + (' <span class="tag">' + ("switched in" if run.get("switched_recipe") else "kept") + "</span>" if i == live_idx else "")]
        cells += [esc(recipe_cell(k, c["recipe"].get(k))) for k in keys]
        for mk, _, fmt, _ in metrics:
            v = c.get(mk)
            cells.append(S(fmt(v)) if v is not None else "")
        rows.append({"live": i == live_idx, "best": i == best_i, "cells": cells})
    head = ["Version"] + [SETTING_WORDS.get(k, (k,))[0] for k in keys] + [m[1] for m in metrics]
    helps = [f"<b>{esc(SETTING_WORDS.get(k, (k,))[0])}</b>: {esc(SETTING_HELP.get(k, k))}." for k in keys]
    # Callout: did it switch, and why
    reason = (run.get("reason") or "").strip()
    reason = reason[:1].upper() + reason[1:] if reason else ""
    call = []
    if live_idx is not None and best_i != live_idx:
        lv, bv = cands[live_idx].get(main_key), cands[best_i].get(main_key)
        fmt0 = metrics[0][2]
        call.append(f"The best tryout scored {fmt0(bv)} on the accuracy score, against {fmt0(lv)} for the live recipe. "
                    + ("That gap was too small to trust, so the live version stayed." if not run.get("switched_recipe")
                       else "It took over at this retrain."))
    elif live_idx is not None:
        call.append("The live recipe had the best accuracy score of every version tried.")
    elif live_recipe is not None:
        call.append("The live recipe was not among the versions tried in this run.")
    if reason:
        call.append(f"The retrain's own note: “{esc(reason)}.”")
    if extra_callout:
        call.append(extra_callout)
    if hidden:
        call.append(f"{len(cands)} versions were tried. The table shows the live one and the 7 best; the other {hidden} all scored worse.")
    return {"head": head, "rows": rows, "helps": helps, "callout": " ".join(call), "note": title_note}


def last_switch(runs):
    sw = [r for r in runs if r.get("switched_recipe")]
    return nice_date(sw[-1]["run_at"]) if sw else None


# ── model block skeleton ─────────────────────────────────────────────────────
def new_model(mid, name):
    return {"id": mid, "name": name, "grade": "Not graded", "score": None, "verdict": "", "summary": "",
            "how": None, "table": None, "chart": "", "good": [], "bad": [], "why": [], "tryouts": None,
            "tryout_title": "", "tryout_intro": "", "next": "", "note": "", "status_line": ""}


# ═════════════════════════════════════════════════════════════════════════════
# NFL / CFB games (predictions_log.csv style)
# ═════════════════════════════════════════════════════════════════════════════
def game_rows(rows):
    out = []
    for r in rows:
        g = {
            "season": int(num(r["season"])), "week": int(num(r["week"])),
            "home": r["home_team"], "away": r["away_team"], "day": r.get("gameday", ""),
            "ms": num(r.get("model_spread")), "mp": num(r.get("model_home_win_prob")),
            "ps": num(r.get("sharp_spread")), "pp": num(r.get("sharp_home_win_prob")),
            "vs": num(r.get("vegas_home_favored_by")), "vp": num(r.get("vegas_home_win_prob")),
            "mt": num(r.get("model_total")), "vt": num(r.get("vegas_total")),
            "margin": num(r.get("actual_margin")), "atot": num(r.get("actual_total")),
            "hs": num(r.get("home_score")), "as": num(r.get("away_score")),
            "m_ats": num(r.get("model_ats_correct")), "m_push": truthy(r.get("model_ats_push")),
            "mcp": num(r.get("model_correct_pick")),
            "ml_team": r.get("ml_pick_team") or None, "ml_price": num(r.get("ml_pick_price")),
            "ml_our": num(r.get("ml_our_prob")), "ml_book": num(r.get("ml_book_prob")),
            "ml_edge": num(r.get("ml_edge")), "ml_value": truthy(r.get("ml_value")),
            "ml_won": num(r.get("ml_won")), "ml_push": num(r.get("ml_push")), "ml_units": num(r.get("ml_units")),
            "set_at": r.get("lines_set_at", ""),
        }
        out.append(g)
    return out


def home_pick(p):
    # 0.5 exactly counts as an away pick, to match model_correct_pick
    return p is not None and p > 0.5


def build_game_model(sport, log_path, coef_path, hist_runs, mid, name):
    league = "NFL" if sport == "nfl" else "CFB"
    m = new_model(mid, name)
    raw = load_csv(log_path)
    coefs_file = load_json(coef_path, {}) or {}
    if not raw:
        m["verdict"] = "We couldn't find this model's prediction log."
        return m, None
    allg = game_rows(raw)
    season = max(g["season"] for g in allg)
    cur = [g for g in allg if g["season"] == season]
    for g in cur:
        note_date(f"{league} picks", g["set_at"])
    graded = [g for g in cur if g["margin"] is not None]
    for g in graded:
        note_date(f"{league} results", g["day"])
    live = [g for g in graded if g["margin"] != 0]       # ties left out
    ties = len(graded) - len(live)
    n = len(live)

    def won(p, g):
        return home_pick(p) == (g["margin"] > 0)

    mW = sum(won(g["mp"], g) for g in live)
    pW = sum(won(g["pp"], g) for g in live)
    vg = [g for g in live if g["vp"] is not None or g["vs"] is not None]

    def vhome(g):
        return home_pick(g["vp"]) if g["vp"] is not None else (g["vs"] or 0) > 0

    vW = sum(vhome(g) == (g["margin"] > 0) for g in vg)
    hW = sum(g["margin"] > 0 for g in live)
    # sanity: matches model_correct_pick
    chk = [g for g in live if g["mcp"] is not None]
    assert sum(int(g["mcp"]) for g in chk) == sum(won(g["mp"], g) for g in chk), "model pick rule mismatch"

    co = coefs_file.get("coefficients", {})
    runs = [r for r in hist_runs if r.get("sport") == sport]
    run = runs[-1] if runs else None
    wa = (run or {}).get("weights_after") or {}
    blend = {k: coefs_file.get(f"blend_weight_on_model_{k}", wa.get(f"blend_weight_on_model_{k}")) for k in ("winprob", "spread", "total")}
    hfa = co.get("home_field_advantage", wa.get("home_field_advantage"))
    sigma = co.get("margin_std_dev", wa.get("margin_std_dev"))

    weeks = sorted({g["week"] for g in graded})
    wk_range = f"Weeks {weeks[0]}-{weeks[-1]}" if len(weeks) > 1 else (f"Week {weeks[0]}" if weeks else "")
    m["note"] = f"Live picks only, {season} season {wk_range}." if weeks else ""

    # ── How it makes a pick ──
    how = {"weights": [], "formula": "", "walk": None, "intro": ""}
    if sport == "nfl":
        how["intro"] = ("The model rates every team from its games so far, with recent weeks counting the most, "
                        "turns the rating gap into its own spread and win chance, then blends that with Vegas. "
                        f"These are the live weights from the {nice_date(coefs_file.get('fitted_at', ''))} retrain.")
        W = [("points_rating_weight", "Points rating gap", "points scored and allowed, adjusted for the schedule", "pts of spread per rating point"),
             ("success_rating_weight", "Play success gap", "how often a team's plays succeed", "pts of spread per unit"),
             ("qb_weight", "Starting QB gap", "how good each starting quarterback is", "pts of spread per unit")]
    else:
        how["intro"] = ("The model sizes up each offense against the other defense on expected points per play, adds two smaller "
                        "adjustments and home field, then blends its numbers with Vegas. "
                        f"These are the live weights from the {nice_date(coefs_file.get('fitted_at', ''))} retrain.")
        W = [("ppa_diff_coef", "Points-per-play gap", "each offense's expected points per play against the other defense", "pts of spread per unit"),
             ("success_rate_weight", "Success rate gap", "how often plays succeed", "pts of spread per unit"),
             ("explosiveness_weight", "Big-play gap", "how big the successful plays are", "pts of spread per unit")]
    for k, lab, plain, unit in W:
        v = co.get(k)
        if v is None:
            continue
        extra = " The weight is negative: once the per-play gap is counted, this pulls the spread back a little." if v < 0 else ""
        how["weights"].append({"label": lab, "plain": plain + "." + extra, "value": f"{v:+.2f}", "unit": unit, "bar": None})
    if hfa is not None:
        how["weights"].append({"label": "Home field", "plain": "a bonus for the home team, learned from past seasons.",
                               "value": f"+{hfa:.2f}", "unit": "points", "bar": None})
    if sigma:
        how["weights"].append({"label": "Spread to win chance", "plain": f"{league} games land within about {sigma:.1f} points of the line two times in three.",
                               "value": f"{sigma:.1f}", "unit": "points", "bar": None})
    blend_rows = []
    for k, lab in (("winprob", "Winner (win chance)"), ("spread", "Spread"), ("total", "Total")):
        w = blend[k]
        if w is None:
            continue
        blend_rows.append({"label": f"{lab}: model share", "plain": f"{w * 100:.0f}% model and {100 - w * 100:.0f}% Vegas in what we post.",
                           "value": f"{w * 100:.0f}%", "unit": "", "bar": w})
    how["blend"] = blend_rows
    if sport == "nfl":
        how["formula"] = (f"model spread = {co.get('points_rating_weight', 0):.2f} × points-rating gap\n"
                          f"             + {co.get('success_rating_weight', 0):.1f} × play-success gap\n"
                          f"             + {co.get('qb_weight', 0):.1f} × starting-QB gap\n"
                          f"             + {hfa:.1f}  home field\n"
                          f"win chance   = spread ÷ {sigma:.1f} on a bell curve\n"
                          f"we post      = {blend['winprob']:.2f} × model chance + {1 - blend['winprob']:.2f} × Vegas chance")
    else:
        how["formula"] = (f"model spread = {co.get('ppa_diff_coef', 0):.1f} × points-per-play gap\n"
                          f"             {'+' if co.get('success_rate_weight', 0) >= 0 else '-'} {abs(co.get('success_rate_weight', 0)):.1f} × success-rate gap\n"
                          f"             {'+' if co.get('explosiveness_weight', 0) >= 0 else '-'} {abs(co.get('explosiveness_weight', 0)):.1f} × big-play gap\n"
                          f"             + {hfa:.1f}  home field\n"
                          f"win chance   = spread ÷ {sigma:.1f} on a bell curve\n"
                          f"we post      = {blend['winprob']:.2f} × model chance + {1 - blend['winprob']:.2f} × Vegas chance")

    # Walk one game: the next week's game where model and Vegas disagree the most
    upcoming = [g for g in cur if g["margin"] is None and g["mp"] is not None and g["vp"] is not None and g["pp"] is not None]
    walk_g = None
    if upcoming:
        nxt = min(g["week"] for g in upcoming)
        pool = [g for g in upcoming if g["week"] == nxt]
        walk_g = max(pool, key=lambda g: (home_pick(g["mp"]) != home_pick(g["pp"]), abs(g["mp"] - g["vp"])))
        walk_kind = f"an upcoming game, Week {nxt}"
    elif graded:
        walk_g = sorted(graded, key=lambda g: (g["week"], g["day"]))[-1]
        walk_kind = f"the latest graded game, Week {walk_g['week']}"
    if walk_g:
        g = walk_g
        h, a = g["home"], g["away"]
        steps = []

        def fav(sp, dec=1):
            if sp is None:
                return ""
            if abs(sp) < 0.05:
                return "even"
            return f"{h if sp > 0 else a} by {abs(sp):.{dec}f}"

        source_note = ""
        if sport == "cfb":
            rl = None
            for r in load_csv(path(TRACK, "cfb_ratings_log.csv")):
                if r["home_team"] == h and r["away_team"] == a and int(num(r["week"]) or 0) == g["week"]:
                    rl = num(r["rating_line"])
            rt = load_json(path(TRACK, "cfb_ratings.json"), {}) or {}
            if rl is not None and g["ms"] is not None and abs(rl - g["ms"]) < 0.15 and rt.get("home_field") is not None:
                gap = g["ms"] - rt["home_field"]
                steps.append(("Rate both teams", "This week's numbers came from the power ratings (the backup used when the advanced stats feed is down).",
                              f"{h if gap > 0 else a} rated {abs(gap):.1f} pts better", ""))
                steps.append(("Add home field", "The power ratings' home bonus.", f"+{rt['home_field']:.1f} pts", ""))
            elif g["ms"] is not None and hfa is not None:
                gap = g["ms"] - hfa
                steps.append(("Rate both teams", "Points per play, success rate and big plays, offense against defense.",
                              f"{h if gap > 0 else a} rated {abs(gap):.1f} pts better", ""))
                steps.append(("Add home field", "The home team gets a bonus learned from past seasons.", f"+{hfa:.1f} pts", ""))
        elif g["ms"] is not None and hfa is not None:
            gap = g["ms"] - hfa
            steps.append(("Rate both teams", "Points scored and allowed against the schedule, how often plays succeed, and the starting QB, with recent weeks counting the most.",
                          f"{h if gap > 0 else a} rated {abs(gap):.1f} pts better", ""))
            steps.append(("Add home field", "The home team gets a bonus learned from past seasons.", f"+{hfa:.1f} pts", ""))
        steps.append(("Model's spread", "Add those up to get the model's own line.", fav(g["ms"]), "o"))
        mp_side = h if home_pick(g["mp"]) else a
        mp_val = g["mp"] if home_pick(g["mp"]) else 1 - g["mp"]
        steps.append(("Turn it into a win chance",
                      f"{league} games land within about {sigma:.0f} points of the line two times in three, so the spread maps to a chance.",
                      f"{mp_side} {pc(mp_val)}", "o"))
        vp_side = h if home_pick(g["vp"]) else a
        vp_val = g["vp"] if home_pick(g["vp"]) else 1 - g["vp"]
        vline_ = "pick" if not g["vs"] else f"{h if g['vs'] > 0 else a} by {abs(g['vs']):g}"
        steps.append(("Check Vegas", "The sportsbook line and the win chance it implies.", f"{vline_} · {vp_side} {pc(vp_val)}", "v"))
        w = blend["winprob"]
        mp_h, vp_h = g["mp"], g["vp"]
        steps.append(("Blend the two",
                      f"Retraining found the best mix on recent games: {w * 100:.0f}% model and {100 - w * 100:.0f}% Vegas for the winner"
                      + (f", and {100 - blend['spread'] * 100:.0f}% Vegas for the spread." if blend.get("spread") is not None else "."),
                      f"{h}: {w:.2f} × {pc(mp_h)} + {1 - w:.2f} × {pc(vp_h)}", ""))
        pp_side = h if home_pick(g["pp"]) else a
        flip = home_pick(g["pp"]) != home_pick(g["mp"])
        steps.append(("What we post",
                      ("The pick flips to " + pp_side + ", even though the model alone likes " + mp_side + ".") if flip
                      else f"The model and the blend agree on {pp_side}.",
                      f"{h} {pc(g['pp'])} · {a} {pc(1 - g['pp'])}", "final"))
        if g["ml_team"]:
            steps.append(("Moneyline pick",
                          f"The moneyline pick uses the model's own chance against the book's price. Edge {g['ml_edge'] * 100:+.0f} points"
                          + (", so it's a Value pick." if g["ml_value"] else ", not big enough to be a Value pick."),
                          f"{g['ml_team']} {price_str(g['ml_price'])}", ""))
        how["walk"] = {"title": f"{a} at {h}, Week {g['week']}", "sub": f"This is {walk_kind}, picked because the model and Vegas disagree the most there.",
                       "steps": steps,
                       "note": "Step 1 is the model's spread minus home field. The per-team ratings behind it are worked out during the daily run and aren't saved, so they aren't split out here."}
    m["how"] = how

    # ── What it would have predicted (table) ──
    rows = []
    show = [g for g in cur if g["margin"] is not None or (upcoming and g["week"] == min(x["week"] for x in upcoming))]
    for g in sorted(show, key=lambda g: (g["week"], g["day"], g["home"])):
        h, a = g["home"], g["away"]
        fin = None
        if g["margin"] is not None and g["hs"] is not None:
            fin = f"{a} {g['as']:.0f}, {h} {g['hs']:.0f}"
        elif g["margin"] is not None:
            fin = f"{h} by {g['margin']:.0f}" if g["margin"] > 0 else (f"{a} by {-g['margin']:.0f}" if g["margin"] < 0 else "Tie")
        res = None if g["margin"] is None or g["margin"] == 0 else g["margin"] > 0

        def cell(p, line=None):
            if p is None:
                return ["", "", ""]
            ishome = home_pick(p)
            t = h if ishome else a
            sm = pc(p if ishome else 1 - p)
            if line is not None:
                sm += " · " + line
            st = "" if res is None else ("ok" if ishome == res else "no")
            return [t, sm, st]

        vline = None if g["vs"] is None else ("pick" if g["vs"] == 0 else f"{h if g['vs'] > 0 else a} by {abs(g['vs']):g}")
        mline = None if g["ms"] is None else ("even" if abs(g["ms"]) < 0.05 else f"{h if g['ms'] > 0 else a} by {abs(g['ms']):.1f}")
        rows.append({"g": str(g["week"]), "gl": f"W{g['week']}", "n": f"{a} @ {h}",
                     "d": home_pick(g["mp"]) != home_pick(g["pp"]),
                     "c": [cell(g["mp"], mline), cell(g["vp"], vline), cell(g["pp"])],
                     "f": fin or "Upcoming"})
    sums = {}
    for wk in sorted({g["week"] for g in show}):
        L = [g for g in live if g["week"] == wk]
        if L:
            a_ = sum(won(g["mp"], g) for g in L)
            b_ = sum(won(g["pp"], g) for g in L)
            sums[str(wk)] = f"Model alone {rec(a_, len(L) - a_)}, we posted {rec(b_, len(L) - b_)} (ties left out)"
        else:
            sums[str(wk)] = "Not played yet"
    sums["all"] = f"Model alone {rec(mW, n - mW)}, we posted {rec(pW, n - pW)} (ties left out)"
    opts = [("all", "All weeks")] + [(str(w), f"Week {w}" + ("" if any(g["week"] == w for g in graded) else " (upcoming)"))
                                     for w in sorted({g["week"] for g in show}, reverse=True)]
    default = str(max(weeks)) if weeks else "all"
    tallies = [(rec(mW, n - mW), "Model alone, picking winners", "o"),
               (rec(vW, len(vg) - vW), "Vegas favorite", "v"),
               (rec(pW, n - pW), "What we posted (the blend)", "")]
    callout = ""
    if n:
        diff = mW - pW
        if diff >= 2:
            callout = (f"This season the model alone would have picked {diff} more winners than what we posted. "
                       f"The blend ({blend['winprob'] * 100:.0f}% model) was set on recent seasons' games, where leaning on Vegas did better. "
                       f"{n} games is too few to call it, but the weekly retrain keeps rechecking the mix. If the model keeps winning, its share goes up on its own.")
        elif diff <= -2:
            callout = (f"This season the blend we posted picked {-diff} more winners than the model alone would have. "
                       "Leaning on Vegas is doing its job.")
        else:
            callout = "The model alone and what we posted are within a game of each other this season."
    m["table"] = {"id": f"t-{mid}", "intro": "Every live game this season. Shaded rows are games where the model on its own picked a different winner than what we posted.",
                  "tallies": tallies, "callout": callout, "sel": "Show week", "opts": opts, "def": default,
                  "cols": ["Game", "Model alone", "Vegas", "We posted", "Final"], "rows": rows, "sums": sums,
                  "key": "Model alone and the posted pick disagree. ✓ right, ✗ wrong. Percentages are each side's chance for the team shown."}

    # ── Working / Falls short ──
    good, bad, why = m["good"], m["bad"], m["why"]
    if n >= MIN_N:
        line = (f"Winners: {S(rec(mW, n - mW))} ({pc(pct_of(mW, n), 1)}) over {n} games. "
                f"Taking every Vegas favorite went {S(rec(vW, len(vg) - vW))} ({pc(pct_of(vW, len(vg)), 1)}).")
        (good if mW > vW else bad if mW < vW else good).append(line + ("" if mW != vW else " Even with Vegas."))
    dis = [g for g in vg if home_pick(g["mp"]) != vhome(g)]
    if len(dis) >= MIN_N:
        r_ = sum(won(g["mp"], g) for g in dis)
        (good if r_ * 2 > len(dis) else bad).append(f"When it picked against Vegas, it was right {S(f'{r_} of {len(dis)}')} times.")
    toss = [g for g in vg if g["vs"] is not None and abs(g["vs"]) <= 3]
    if len(toss) >= MIN_N:
        a_ = sum(won(g["mp"], g) for g in toss)
        b_ = sum(vhome(g) == (g["margin"] > 0) for g in toss)
        (good if a_ > b_ else bad).append(f"In {len(toss)} near toss-ups (line of 3 or less) it went {S(rec(a_, len(toss) - a_))}. Vegas favorites went {rec(b_, len(toss) - b_)}.")
    big = [g for g in vg if g["vs"] is not None and abs(g["vs"]) >= 7]
    if len(big) >= MIN_N:
        a_ = sum(won(g["mp"], g) for g in big)
        b_ = sum(vhome(g) == (g["margin"] > 0) for g in big)
        (good if a_ >= b_ else bad).append(f"With a big favorite (line of 7 or more, {len(big)} games) it went {S(rec(a_, len(big) - a_))}. Vegas favorites went {rec(b_, len(big) - b_)}.")
    mlg = [g for g in cur if g["ml_won"] is not None and g["ml_push"] != 1]
    if len(mlg) >= MIN_N:
        w_ = sum(int(g["ml_won"]) for g in mlg)
        u = sum(g["ml_units"] or 0 for g in mlg)
        (good if u > 0 else bad).append(f"Moneyline picks: {S(rec(w_, len(mlg) - w_))}, {S(money(u))} at ${STAKE} a pick.")
        vv = [g for g in mlg if g["ml_value"]]
        if len(vv) >= MIN_N:
            w2 = sum(int(g["ml_won"]) for g in vv)
            u2 = sum(g["ml_units"] or 0 for g in vv)
            (good if u2 > 0 else bad).append(f"Value picks (edge of 6 points or more): {S(rec(w2, len(vv) - w2))}, {S(money(u2))} at ${STAKE} a pick.")
    pairs = [((g["mp"] if home_pick(g["mp"]) else 1 - g["mp"]), int(won(g["mp"], g))) for g in live]
    calib_bullets(calib_buckets(pairs), "picks", good, bad)
    ats = [g for g in graded if g["m_ats"] is not None and not g["m_push"]]
    if len(ats) >= MIN_N:
        a_ = sum(int(g["m_ats"]) for g in ats)
        line = f"Its own spread went {S(rec(a_, len(ats) - a_))} against the line ({pc(pct_of(a_, len(ats)))}). Break-even is 52.4%."
        (good if pct_of(a_, len(ats)) >= 0.524 else bad).append(line)
        for lab, sub in (("road", [g for g in ats if g["vs"] is not None and g["ms"] is not None and g["ms"] < g["vs"]]),
                         ("home", [g for g in ats if g["vs"] is not None and g["ms"] is not None and g["ms"] > g["vs"]])):
            if len(sub) >= MIN_N:
                c_ = sum(int(g["m_ats"]) for g in sub)
                if pct_of(c_, len(sub)) < 0.45:
                    bad.append(f"When it liked the {lab} team more than Vegas did, the {lab} team covered only {S(f'{c_} of {len(sub)}')} times.")
                elif pct_of(c_, len(sub)) > 0.55:
                    good.append(f"When it liked the {lab} team more than Vegas did, the {lab} team covered {S(f'{c_} of {len(sub)}')} times.")
    home_rate = pct_of(hW, n)
    mh = pct_of(sum(home_pick(g["mp"]) for g in live), n)
    lean_gap = mh - home_rate
    if n >= MIN_N and abs(lean_gap) >= 0.05:
        bad.append(f"It leans {'home' if lean_gap > 0 else 'road'}. It picked the home team {S(pc(mh))} of the time, but home teams have won {S(pc(home_rate))} this season ({n} games).")
    # weekly trend
    wk_stats = []
    for wk in weeks:
        L = [g for g in live if g["week"] == wk]
        LV = [g for g in L if g in vg]
        a_ = sum(won(g["mp"], g) for g in L)
        b_ = sum(vhome(g) == (g["margin"] > 0) for g in LV)
        wk_stats.append((wk, a_, len(L), b_, len(LV)))
    ok_w = [w for w in wk_stats if w[2] >= MIN_N]
    if len(ok_w) >= 2:
        worst = min(ok_w, key=lambda w: (w[1] / w[2], w[0]))
        best = max(ok_w, key=lambda w: (w[1] / w[2], -w[0]))
        if worst[1] < worst[3]:
            bad.append(f"Week {worst[0]} was its worst: {S(rec(worst[1], worst[2] - worst[1]))} on winners ({worst[2]} games). Vegas favorites went {rec(worst[3], worst[4] - worst[3])}.")
        if best[1] > best[3] and best[0] != worst[0]:
            good.append(f"Week {best[0]} was its best: {S(rec(best[1], best[2] - best[1]))} on winners ({best[2]} games). Vegas favorites went {rec(best[3], best[4] - best[3])}.")
    m["chart"] = bar_chart([(f"Wk {w[0]}", w[1], w[2], w[3], w[4]) for w in wk_stats], "Our model", "Vegas favorite",
                           f"Winners picked each week, model alone vs Vegas favorites ({n} games, ties left out).")
    sp_err = mean([abs(g["ms"] - g["margin"]) for g in graded if g["ms"] is not None])
    vs_err = mean([abs(g["vs"] - g["margin"]) for g in graded if g["vs"] is not None])
    if len(graded) >= MIN_N and sp_err is not None and vs_err is not None:
        (bad if sp_err > vs_err else good).append(f"Its own spreads miss the final margin by {S(f'{sp_err:.1f}')} points on average. Vegas misses by {vs_err:.1f} ({len(graded)} games).")
    t_err = mean([abs(g["mt"] - g["atot"]) for g in graded if g["mt"] is not None and g["atot"] is not None])
    vt_err = mean([abs(g["vt"] - g["atot"]) for g in graded if g["vt"] is not None and g["atot"] is not None])
    if len(graded) >= MIN_N and t_err is not None and vt_err is not None:
        (bad if t_err > vt_err else good).append(f"Its totals miss by {S(f'{t_err:.1f}')} points on average. Vegas misses by {vt_err:.1f}.")

    # ── Why ──
    hist_seasons = sorted({g["season"] for g in allg if g["season"] < season})
    cur_home_margin = mean([g["margin"] for g in graded])
    if n >= MIN_N and lean_gap >= 0.05 and hfa is not None and cur_home_margin is not None:
        past = []
        for s_ in hist_seasons[-2:]:
            pm = mean([g["margin"] for g in allg if g["season"] == s_ and g["margin"] is not None])
            if pm is not None:
                past.append(f"{pm:.1f} ({s_})")
        strong = cur_home_margin < hfa - 1.5 and len(graded) >= 48
        why.append(("Strong evidence" if strong else "Our best guess",
                    f"Home field looks weaker this year. The model learned home teams are worth about {hfa:.1f} points"
                    + (f" from past seasons, when they won by about {' and '.join(past)}" if past else " from past seasons")
                    + f". This season the home team has won by {cur_home_margin:.1f} on average ({len(graded)} games). The weekly retrain will slowly pull that number down."))
    if (sp_err is not None and vs_err is not None and sp_err > vs_err) or (bad and n >= MIN_N):
        if sport == "nfl":
            why.append(("Our best guess", "Vegas knows about injuries and we don't. The model only knows who the starting QB is. Missing linemen, receivers or corners move the line, and the model can't see them. This is the most likely reason its spreads trail Vegas."))
        else:
            why.append(("Our best guess", "Vegas knows about injuries, suspensions and depth-chart news, and the model doesn't track any of them. That is the most likely reason its own spreads trail Vegas."))
    if weeks and ok_w:
        first = ok_w[0]
        if first[1] / first[2] <= min(w[1] / w[2] for w in ok_w) and first[1] < first[3]:
            why.append(("Expected", f"Week {first[0]} is early. The ratings still lean mostly on last season, so teams that changed a lot get misjudged until a few games are in."))
    if blend.get("spread") == 0 and len(ats) >= MIN_N and pct_of(sum(int(g["m_ats"]) for g in ats), len(ats)) < 0.524:
        hv = coefs_file.get("holdout_validation") or {}
        if hv.get("model_only_spread_mae") and hv.get("vegas_only_spread_mae"):
            why.append(("Strong evidence", f"At the last retrain its own spread missed by {hv['model_only_spread_mae']:.2f} points on {hv.get('n_games')} held-back games, against {hv['vegas_only_spread_mae']:.2f} for Vegas. So the blend gives the model 0% of the posted spread, and spreads on the site come straight from Vegas."))
    if n < SMALL_N:
        why.append(("Keep in mind", f"It's {n} games. A record this size can swing a lot with a few more weeks."))

    # ── Grade + verdict ──
    m["grade"] = grade_from(pct_of(mW, n), pct_of(vW, len(vg)), n, m)
    ats_bad = len(ats) >= MIN_N and pct_of(sum(int(g["m_ats"]) for g in ats), len(ats)) < 0.524
    if m["grade"] == "Working":
        m["verdict"] = "Good at picking who wins." + (" Not good enough to set its own spread, which is why spreads on the site come straight from Vegas." if ats_bad and blend.get("spread") == 0
                                                      else " Its own spreads still trail Vegas." if ats_bad else "")
        m["summary"] = f"Picks winners better than Vegas favorites ({rec(mW, n - mW)} vs {rec(vW, len(vg) - vW)})." + (" Its own spreads are weak." if ats_bad else "")
    elif m["grade"] == "Falling short":
        m["verdict"] = f"Picking winners worse than just taking the Vegas favorite ({rec(mW, n - mW)} vs {rec(vW, len(vg) - vW)}). The blend leans on Vegas for that reason."
        m["summary"] = f"Behind Vegas favorites on winners, {rec(mW, n - mW)} vs {rec(vW, len(vg) - vW)}."
    elif m["grade"] == "Mixed":
        m["verdict"] = f"Picks winners about as well as Vegas favorites ({rec(mW, n - mW)} vs {rec(vW, len(vg) - vW)})." + (" Its own spreads trail Vegas." if ats_bad else "")
        m["summary"] = f"About even with Vegas favorites on winners ({rec(mW, n - mW)} vs {rec(vW, len(vg) - vW)})."
    else:
        m["verdict"] = "Too few live games to grade yet."
        m["summary"] = m["verdict"]
    if ties:
        m["note"] += f" {ties} tie{'s' if ties > 1 else ''} left out."
    tries = []
    if sp_err is not None and vs_err is not None and sp_err > vs_err:
        tries.append("injuries beyond the QB" if sport == "nfl" else "injury and depth-chart news")
    if lean_gap >= 0.05:
        tries.append("checking whether the home edge should be updated faster")
    if not tries:
        tries.append("more live weeks before changing anything")
    m["next"] = ", and ".join(tries[:2]) + "."

    # ── Tryouts ──
    if run:
        mets = [("brier", "Accuracy score<br>(lower is better)", lambda v: f"{v:.4f}".lstrip("0"), True),
                ("accuracy", "Winners picked", lambda v: pc(v, 1), False),
                ("spread_mae", "Avg spread miss", lambda v: f"{v:.2f}", True)]
        live_recipe = coefs_file.get("recipe") or run.get("live_recipe")
        ls = last_switch(runs)
        m["tryouts"] = tryouts_block(run.get("candidates", []), live_recipe, mets, run,
                                     extra_callout=(f"The last real switch was on {ls}." if ls else "No switch has happened in the logged retrains."))
        m["tryout_title"] = f"Versions tested at the {nice_date(run['run_at'])} retrain"
        m["tryout_intro"] = (f"Every version was trained on older games and tested on the {run.get('holdout_games')} most recent ones it hadn't seen. "
                             "A new version takes over only if it beats the live one by a clear margin. These are test scores, not live records.")
        note_date(f"{league} retrain", run["run_at"])
    m["status_line"] = f"{season} season, {n} graded games"
    return m, {"season": season, "weeks": weeks}


# ═════════════════════════════════════════════════════════════════════════════
# NFL TD scorers
# ═════════════════════════════════════════════════════════════════════════════
def build_td():
    m = new_model("nfl-td", "TD scorers")
    raw = load_csv(path(TRACK, "td_props_log.csv"))
    summ = load_json(path(TRACK, "td_props_summary.json"), {}) or {}
    tdc = load_json(path(NFL_MODELS, "fitted_td_coefficients.json"), {}) or {}
    if not raw:
        return m
    rows = []
    for r in raw:
        rows.append({"season": int(num(r["season"])), "week": int(num(r["week"])), "name": r["player_name"], "pos": r["pos"],
                     "team": r["team"], "opp": r["opponent"], "kick": r["kickoff"], "p": num(r["our_prob"]),
                     "top10": truthy(r["top10"]), "price": num(r["price"]), "bp": num(r["book_prob"]),
                     "edge": num(r["edge"]), "value": truthy(r["value"]), "tds": num(r["tds"]),
                     "res": r["result"], "profit": num(r["profit"])})
    season = max(r["season"] for r in rows)
    rows = [r for r in rows if r["season"] == season]
    for r in rows:
        note_date("TD scorers", r["kick"])
    graded = [r for r in rows if r["res"] in ("W", "L")]
    gb = [r for r in graded if r["bp"] is not None]
    n = len(graded)

    def brier(rs, key):
        return mean([(r[key] - (1 if r["res"] == "W" else 0)) ** 2 for r in rs])

    # value + top10
    val = [r for r in graded if r["value"]]
    vW = sum(r["res"] == "W" for r in val)
    vprof = sum(r["profit"] or 0 for r in val)
    t10 = [r for r in graded if r["top10"]]
    t10W = sum(r["res"] == "W" for r in t10)
    good, bad, why = m["good"], m["bad"], m["why"]
    if len(val) >= MIN_N:
        (good if vprof > 0 else bad).append(f"Value picks: {S(rec(vW, len(val) - vW))}, {S(('up' if vprof >= 0 else 'down') + f' ${abs(vprof):,.0f}')} on ${STAKE * len(val)} risked.")
    if len(t10) >= MIN_N:
        exp = sum(r["p"] for r in t10)
        (good if t10W >= exp - 1 else bad).append(f"Top 10 most likely: {S(f'{t10W} of {len(t10)}')} scored. It expected about {exp:.0f}.")
    ob, bb = brier(gb, "p"), brier(gb, "bp")
    if len(gb) >= MIN_N and ob is not None:
        if ob > bb:
            bad.append(f"Across all {len(gb)} graded players with a book price, the sportsbook's chances were more accurate than ours (accuracy score {bb:.3f} vs our {ob:.3f}, lower is better).")
        else:
            good.append(f"Across all {len(gb)} graded players with a book price, our chances were more accurate than the sportsbook's ({ob:.3f} vs {bb:.3f}, lower is better).")
    # by position
    pos_rows = []
    for pos in ("QB", "RB", "WR", "TE"):
        P = [r for r in gb if r["pos"] == pos]
        if len(P) >= MIN_N:
            pos_rows.append((pos, len(P), mean([r["p"] for r in P]), mean([r["bp"] for r in P]), mean([1.0 if r["res"] == "W" else 0.0 for r in P])))
    low = [x for x in pos_rows if x[2] < x[4] - 0.02]
    if pos_rows and len(low) >= len(pos_rows) / 2:
        worst = max(pos_rows, key=lambda x: x[4] - x[2])
        bad.append(f"It rates most positions too low. {worst[0]}s ({worst[1]} players): it said {pc(worst[2])}, the book said {pc(worst[3])}, and {S(pc(worst[4]))} scored.")
    on_target = [x for x in pos_rows if abs(x[2] - x[4]) <= 0.02]
    for x in on_target:
        good.append(f"{x[0]}s came in on target ({x[1]} players): it said {pc(x[2])} and {S(pc(x[4]))} scored. The book said {pc(x[3])}.")
    # by gap vs the book
    hi = [r for r in gb if r["edge"] is not None and r["edge"] >= 0.05]
    lo = [r for r in gb if r["edge"] is not None and r["edge"] <= -0.05]
    gap_rows = []
    for lab, G, word in (("5+ points higher than the book", hi, "higher"), ("5+ points lower than the book", lo, "lower")):
        if len(G) >= MIN_N:
            ours, book, act = mean([r["p"] for r in G]), mean([r["bp"] for r in G]), mean([1.0 if r["res"] == "W" else 0.0 for r in G])
            gap_rows.append((lab, len(G), ours, book, act))
            right = abs(ours - act) < abs(book - act)
            line = (f"When it rated a player 5+ points <i>{word}</i> than the book ({len(G)} players), "
                    + (f"it was right: it said {pc(ours)} and {S(pc(act))} scored. The book said {pc(book)}." if right
                       else f"the book was right. It said {pc(ours)}, the book said {pc(book)}, and {S(pc(act))} scored."))
            (good if right else bad).append(line)
    weeks_b = sorted({r["week"] for r in gb})
    if weeks_b:
        bad.append(f"Only {len(weeks_b)} week{'s' if len(weeks_b) > 1 else ''} of book prices so far (Week{'s' if len(weeks_b) > 1 else ''} {weeks_b[0]}{'-' + str(weeks_b[-1]) if len(weeks_b) > 1 else ''}).") if len(weeks_b) < 4 else None
    # chart by position: our / book / actual
    if pos_rows:
        parts = ['<line x1="40" y1="170" x2="550" y2="170" stroke="var(--rule)"/>',
                 '<line x1="40" y1="110" x2="550" y2="110" stroke="var(--rule)" stroke-dasharray="3 4"/>',
                 '<line x1="40" y1="50" x2="550" y2="50" stroke="var(--rule)" stroke-dasharray="3 4"/>',
                 '<text x="32" y="174" text-anchor="end">0</text><text x="32" y="114" text-anchor="end">20%</text><text x="32" y="54" text-anchor="end">40%</text>']
        slot = 510 / len(pos_rows)
        for i, (pos, nn, o, b, a) in enumerate(pos_rows):
            x0 = 40 + slot * i + (slot - 90) / 2
            for j, (v, col) in enumerate(((o, "var(--ours)"), (b, "var(--vegas)"), (a, "var(--actual)"))):
                hgt = min(v, 0.55) * 300
                parts.append(f'<rect x="{x0 + 30 * j:.1f}" y="{170 - hgt:.1f}" width="28" height="{hgt:.1f}" fill="{col}"/>')
            parts.append(f'<text x="{x0 + 44:.1f}" y="192" text-anchor="middle">{pos} ({nn})</text>')
        m["chart"] = ('<figure><div class="chart"><svg viewBox="0 0 560 210" width="100%" style="min-width:420px" role="img" '
                      'aria-label="TD chance by position: our chance, book chance, and how often they scored">' + "".join(parts) + '</svg></div>'
                      '<div class="legend"><span style="--c:var(--ours)">Our chance</span><span style="--c:var(--vegas)">Sportsbook chance</span>'
                      '<span style="--c:var(--actual)">How often they scored</span></div>'
                      f'<figcaption>Average chance by position for graded players with book prices, Week{"s" if len(weeks_b) > 1 else ""} '
                      f'{weeks_b[0]}{"-" + str(weeks_b[-1]) if len(weeks_b) > 1 else ""}. Number of players in brackets.</figcaption></figure>')
    # grade
    v_ok = len(val) >= MIN_N and vprof > 0
    b_ok = ob is not None and ob <= bb
    if n < GRADE_MIN_N:
        m["grade"] = "Not graded"
    else:
        m["grade"] = "Working" if v_ok and b_ok else ("Mixed" if v_ok or b_ok else "Falling short")
    if hi and gap_rows and any(g[0].startswith("5+ points higher") and abs(g[2] - g[4]) < abs(g[3] - g[4]) for g in gap_rows):
        m["verdict"] = "When it disagrees with the sportsbook by a lot in the player's favor, it has been right." + (" Overall it rates players too low." if low else "")
    else:
        m["verdict"] = "The sportsbook's chances have been closer than ours." if not b_ok else "Its chances have held up against the sportsbook."
    m["summary"] = (f"Value picks are {rec(vW, len(val) - vW)}" if val else "No Value picks yet") + (", but it rates most players too low." if low else ".")
    # why
    if low:
        why.append(("Our best guess", f"The model was fit on {len(tdc.get('train_seasons', [])) or 'several'} past seasons of games, and this season's scoring may differ. If touchdowns are up league-wide this year, every chance it gives will run low. The weekly refit should catch this as weeks pile up."))
    if any(g[0].startswith("5+ points lower") and abs(g[3] - g[4]) < abs(g[2] - g[4]) for g in gap_rows):
        why.append(("Our best guess", "The book reacts to news the model can't see, like a teammate ruled out or a new goal-line role. That would explain why it's so often wrong when it's much lower than the book."))
    why.append(("Keep in mind", "The sportsbook's chances include its cut, which makes the book look high. Players beating even the book's chance is a sign the whole season is running hot."))
    if len(gb) < SMALL_N * 10:
        why.append(("Keep in mind", f"{len(gb)} graded players over {len(weeks_b)} week{'s' if len(weeks_b) != 1 else ''} is still a small sample for a 1-in-5 event."))
    m["next"] = "recent snap and target share, teammate injuries, and a check on whether TDs are running high this season."
    # how
    co = tdc.get("coefficients", {})
    words = {"log_xtd": ("Expected TDs from his touches", "every carry and target is worth the league TD rate from that spot on the field"),
             "log_finish": ("Finishing", "his actual TDs over his expected TDs, pulled hard toward normal"),
             "rz_share": ("Red-zone share", "his share of his team's carries and targets inside the 20"),
             "log_implied": ("Team's expected points", "from the Vegas spread and total"),
             "log_def_pos": ("Defense vs his position", "TDs the opponent allowed to his position over its last 8 games")}
    biggest = max([abs(co.get(k, 0)) for k in words] or [1])
    how = {"intro": f"For each player it estimates his expected touchdowns, then turns that into a chance to score at least once. Weights are from the {nice_date(tdc.get('fit_at', ''))} refit on {tdc.get('n_player_games', 0):,} player-games.",
           "weights": [], "blend": [], "formula": "", "walk": None,
           "bar_note": "Bar length shows the size of each weight. They act on different scales, so treat it as a rough guide."}
    for k, (lab, plain) in words.items():
        if k in co:
            how["weights"].append({"label": lab, "plain": plain + ".", "value": f"{co[k]:+.2f}", "unit": "", "bar": abs(co[k]) / biggest})
    pos_adj = ", ".join(f"{p[3:]} {co[p]:+.2f}" for p in ("is_RB", "is_TE", "is_QB") if p in co)
    if pos_adj:
        how["weights"].append({"label": "Position adjustment", "plain": f"compared with a wide receiver: {pos_adj}.", "value": "", "unit": "", "bar": None})
    how["formula"] = ("expected TDs = e^( {:.2f}".format(co.get("intercept", 0))
                      + "".join(f"\n               {'+' if co[k] >= 0 else '-'} {abs(co[k]):.2f} × log of {lab[0].lower() + lab[1:]}" if k.startswith("log_") else f"\n               {'+' if co[k] >= 0 else '-'} {abs(co[k]):.2f} × {lab[0].lower() + lab[1:]}" for k, (lab, _) in words.items() if k in co)
                      + "\n               + position adjustment )\nchance to score = 1 - e^(-expected TDs)\nValue pick     = our chance is 6+ points above the book's, at a fair price")
    up = [r for r in rows if r["res"] not in ("W", "L", "void") and r["top10"] and r["bp"] is not None]
    gp = [r for r in graded if r["bp"] is not None]
    pick = max(up, key=lambda r: r["p"]) if up else (max(gp, key=lambda r: (r["week"], r["value"], r["p"])) if gp else None)
    if pick:
        lam = -math.log(1 - pick["p"])
        steps = [("Expected touchdowns", "Built from where his carries and targets happen, his finishing, red-zone share, his team's expected points and the defense. Only the total is logged.", f"{lam:.2f} TDs", "o"),
                 ("Turn it into a chance", "Chance of at least one = 1 - e^(-expected TDs).", f"{pc(pick['p'])}", "o")]
        if pick["bp"] is not None:
            steps.append(("Check the sportsbook", f"{price_str(pick['price'])}, with the book's cut taken out.", f"{pc(pick['bp'])}", "v"))
            steps.append(("Compare", "A Value pick needs our chance 6+ points above the book's.",
                          f"{(pick['p'] - pick['bp']) * 100:+.0f} points · {'Value' if pick['value'] else 'not Value'}", "final"))
        else:
            steps.append(("Check the sportsbook", "No book price was logged for him yet.", "No price", "v"))
        res = "" if pick["res"] not in ("W", "L") else (f" He scored {pick['tds']:.0f}." if pick["res"] == "W" else " He didn't score.")
        how["walk"] = {"title": f"{pick['name']} ({pick['pos']}, {pick['team']} vs {pick['opp']}), Week {pick['week']}",
                       "sub": ("His is the highest chance on the upcoming slate with a book price." if up else "A Value pick from the latest graded week with book prices." if pick["value"] else "The top chance from the latest graded week with book prices.") + res,
                       "steps": steps, "note": "The log keeps the final chance, not each input, so the inputs aren't split out per player."}
    m["how"] = how
    # table: top 10 + value picks per week, graded or upcoming
    trows = []
    for r in sorted(rows, key=lambda r: (r["week"], -r["p"])):
        if not (r["top10"] or r["value"]):
            continue
        st = "" if r["res"] not in ("W", "L") else ("ok" if r["res"] == "W" else "no")
        fin = {"W": f"Scored {r['tds']:.0f}" if r["tds"] else "Scored", "L": "No TD", "void": "Didn't play"}.get(r["res"], "Upcoming")
        trows.append({"g": str(r["week"]), "gl": f"W{r['week']}", "n": f"{r['name']} · {r['pos']}, {r['team']} vs {r['opp']}",
                      "d": r["value"], "c": [[pc(r["p"]), "Top 10" if r["top10"] else "", st],
                                              [pc(r["bp"]) if r["bp"] is not None else "", price_str(r["price"]), ""],
                                              [("Value" if r["value"] else ""), (f"{'+' if (r['profit'] or 0) >= 0 else '-'}${abs(r['profit'] or 0):.0f}" if r["value"] and r["profit"] is not None else ""), ""]],
                      "f": fin})
    sums = {}
    for wk in sorted({int(t["g"]) for t in trows}):
        T = [r for r in t10 if r["week"] == wk]
        V = [r for r in val if r["week"] == wk]
        sums[str(wk)] = (f"Top 10: {sum(r['res'] == 'W' for r in T)} of {len(T)} scored" if T else "Not played yet") + (f" · Value {rec(sum(r['res'] == 'W' for r in V), len(V) - sum(r['res'] == 'W' for r in V))}" if V else "")
    sums["all"] = f"Top 10: {t10W} of {len(t10)} scored · Value {rec(vW, len(val) - vW)}"
    gw = sorted({r["week"] for r in graded})
    m["table"] = {"id": "t-nfl-td", "intro": "The top 10 most likely scorers each week, plus every Value pick. Shaded rows are Value picks.",
                  "tallies": [(f"{t10W} of {len(t10)}", "Top 10 picks that scored", "o"),
                              (f"{len(gb) and pc(mean([1.0 if r['res'] == 'W' else 0.0 for r in gb]))}", f"All {len(gb)} priced players who scored", "v"),
                              (rec(vW, len(val) - vW), f"Value picks, {('up' if vprof >= 0 else 'down')} ${abs(vprof):,.0f}", "")],
                  "callout": "", "sel": "Show week",
                  "opts": [("all", "All weeks")] + [(str(w), f"Week {w}" + ("" if w in gw else " (upcoming)")) for w in sorted({int(t["g"]) for t in trows}, reverse=True)],
                  "def": str(max(gw)) if gw else "all", "cols": ["Player", "Our chance", "Book chance", "Value pick", "Final"],
                  "rows": trows, "sums": sums, "key": "Value pick. ✓ scored, ✗ didn't. Players who didn't play are left out of every record."}
    # gap table (by position + by gap) as a small extra table
    extra = []
    for pos, nn, o, b, a in pos_rows:
        extra.append([f"{pos}s", str(nn), pc(o), pc(b), pc(a)])
    for lab, nn, o, b, a in gap_rows:
        extra.append([f"Rated {lab}", str(nn), pc(o), pc(b), pc(a)])
    m["extra_table"] = {"head": ["Group", "Players", "Our chance", "Book chance", "Scored"], "rows": extra,
                        "caption": "Graded players with a book price, grouped by position and by how far we were from the book."}
    # tryouts from recent_holdout
    rh = tdc.get("recent_holdout") or {}
    if rh:
        rows_t = []
        for k, lab in (("live", "Live"), ("refit", "Refit with newest games")):
            v = rh.get(k)
            if v:
                rows_t.append({"live": k == "live", "best": False, "cells": [lab + (' <span class="tag">kept</span>' if k == "live" else ""),
                               S(f"{v['brier']:.4f}".lstrip("0")), S(pc(v["mean_pred"], 1)), S(pc(v["actual_rate"], 1)), S(f"{v['n']:,}")]})
        m["tryouts"] = {"head": ["Version", "Accuracy score<br>(lower is better)", "Average chance it gave", "How often they scored", "Player-games"],
                        "rows": rows_t, "helps": [],
                        "callout": "The two versions are within a hair of each other on the last few weeks of games, and both average chance and real scoring rate line up on that test. These are test scores, not live records."}
        m["tryout_title"] = f"Refit check, {nice_date(tdc.get('fit_at', ''))}"
        m["tryout_intro"] = f"The refit was tested on the last {rh.get('weeks')} weeks of games it hadn't seen, against the live version."
    m["note"] = f"Live picks only, {season} season. {n} graded players ({len([r for r in rows if r['res'] == 'void'])} who didn't play left out)."
    m["status_line"] = f"{n} graded players"
    return m


# ═════════════════════════════════════════════════════════════════════════════
# NFL player stats (not graded live)
# ═════════════════════════════════════════════════════════════════════════════
def build_props():
    m = new_model("nfl-props", "Player stats")
    d = load_json(path(NFL_MODELS, "fitted_props_coefficients.json"), {}) or {}
    hv = (d.get("holdout_validation") or {}).get("by_stat_type", {})
    m["grade"] = "Not graded"
    good, bad, why = m["good"], m["bad"], m["why"]
    names = {"receiving": "Receiving yards", "rushing": "Rushing yards", "passing": "Passing yards"}
    seasons = (d.get("holdout_validation") or {}).get("seasons", [])
    for k, lab in names.items():
        v = hv.get(k)
        if not v:
            continue
        fit = f"{v['mae_fitted']:.1f}"
        yrs = "-".join(map(str, seasons))
        if v["mae_fitted"] < v["mae_original_handpicked"]:
            good.append(f"{lab}: on {v['n_games']:,} held-back player-games ({yrs}), it missed by {S(fit)} on average, down from {v['mae_original_handpicked']:.1f} for the old hand-picked version.")
        gap = v["mae_baseline_only"] - v["mae_fitted"]
        if gap < 1.0 or gap / v["mae_baseline_only"] < 0.03:
            bad.append(f"{lab}: it only just beats a simple “use his recent average”. It misses by {S(fit)} vs {v['mae_baseline_only']:.1f}.")
    inj = (d.get("injury_multipliers") or {}).get("Questionable")
    if inj:
        good.append(f"Its injury adjustment is learned from {S(format(inj['n_samples'], ','))} real cases. A “Questionable” player plays about {inj['multiplier'] * 100:.0f}% of his usual role.")
    bad.append("It isn't graded on live games, so there's no live record to show. The numbers above are held-back test games, not live picks.")
    bad.append("It replaces itself every week without the “only if better” check the game models have.")
    why.append(("Strong evidence", "Yards for one player in one game are very random. One long catch can swing 40 yards, so even a good model misses by about 20."))
    why.append(("Our best guess", "It doesn't know the game script. A team that falls behind throws more, so the Vegas spread and total should help it, and it doesn't use them yet."))
    m["verdict"] = "This projects yards for the Players page. Our weakest spot is that we don't track how it does on live games yet."
    m["summary"] = "Barely beats “use his average”, and isn't graded on live games yet."
    m["next"] = "grade it every week, add the “only if better” check, and feed it the Vegas line."
    ms = d.get("matchup_scaling") or {}
    how = {"intro": f"Projected stat = his usage × his efficiency, adjusted for the opponent's defense and his injury status. Recent games count the most: a game {d.get('half_life_games')} games back counts half. Fit on {nice_date(d.get('fitted_at', ''))}.",
           "weights": [], "blend": [], "formula": "", "walk": None}
    for k, lab in names.items():
        v = ms.get(k)
        if v:
            how["weights"].append({"label": lab, "plain": f"keeps {v['baseline_scale'] * 100:.0f}% of his recent average, and each unit of defense quality moves it by {v['matchup_scale']:.2f}.",
                                   "value": f"×{v['baseline_scale']:.2f}", "unit": "", "bar": None})
    if inj:
        how["weights"].append({"label": "Questionable tag", "plain": "projected volume is cut to this share.", "value": f"×{inj['multiplier']:.2f}", "unit": "", "bar": None})
    how["formula"] = ("projection = baseline scale × his recent average\n"
                      "             × (1 + matchup scale × how much worse than average the defense is)\n"
                      "             × injury discount (Questionable = {:.2f})".format(inj["multiplier"] if inj else 1))
    m["how"] = how
    grid = d.get("half_life_grid_search") or []
    if grid:
        best = min(grid, key=lambda g: g["receiving_baseline_mae"])
        rows = []
        for g in grid:
            is_live = g["half_life"] == d.get("half_life_games")
            rows.append({"live": is_live, "best": g is best, "cells": [("Live" + ' <span class="tag">kept</span>') if is_live else f"{g['half_life']} games",
                                                                      esc(f"half after {g['half_life']} games"), S(f"{g['receiving_baseline_mae']:.2f}"), S(f"{g['n']:,}")]})
        m["tryouts"] = {"head": ["Version", "Forgets old games", "Receiving yards miss<br>(lower is better)", "Player-games"], "rows": rows,
                        "helps": ["<b>Forgets old games</b>: how fast his old games stop counting toward his average."],
                        "callout": f"The fit picks the setting with the smallest miss, so {d.get('half_life_games')} games is live. There is no “only if better” check against the previous version."}
        m["tryout_title"] = f"Settings tried at the {nice_date(d.get('fitted_at', ''))} fit"
        m["tryout_intro"] = "Each setting is how fast a player's old games fade. All were tested on games they hadn't seen."
    m["note"] = "Held-back test games only. Nothing on this card is a live record."
    m["status_line"] = "Not graded live"
    return m


# ═════════════════════════════════════════════════════════════════════════════
# CFB power ratings (monitor only)
# ═════════════════════════════════════════════════════════════════════════════
def build_cfb_ratings():
    m = new_model("cfb-ratings", "Power ratings")
    raw = load_csv(path(TRACK, "cfb_ratings_log.csv"))
    rt = load_json(path(TRACK, "cfb_ratings.json"), {}) or {}
    preds = load_csv(path(TRACK, "cfb_predictions_log.csv"))
    vmap = {(r["season"], r["week"], r["home_team"], r["away_team"]): (num(r["vegas_home_favored_by"]), num(r["vegas_home_win_prob"])) for r in preds}
    note_date("CFB ratings", rt.get("updated"))
    games = []
    for r in raw:
        hs, as_ = num(r["home_score"]), num(r["away_score"])
        v = vmap.get((r["season"], r["week"], r["home_team"], r["away_team"]), (None, None))
        games.append({"week": int(num(r["week"])), "h": r["home_team"], "a": r["away_team"], "line": num(r["rating_line"]),
                      "hs": hs, "as": as_, "vs": v[0], "vp": v[1], "neutral": truthy(r["neutral"]), "start": r["start"]})
        note_date("CFB ratings", r["logged_at"])
    live = [g for g in games if g["hs"] is not None and g["hs"] != g["as"] and g["line"] is not None]
    n = len(live)
    W = sum((g["line"] > 0) == (g["hs"] > g["as"]) for g in live)
    hW = sum(g["hs"] > g["as"] for g in live)
    vg = [g for g in live if g["vs"] is not None]
    rW = sum((g["line"] > 0) == (g["hs"] > g["as"]) for g in vg)
    vW = sum(((g["vp"] > 0.5) if g["vp"] is not None else g["vs"] > 0) == (g["hs"] > g["as"]) for g in vg)
    good, bad, why = m["good"], m["bad"], m["why"]
    if n >= MIN_N:
        (good if W > hW else bad).append(f"Winners: {S(rec(W, n - W))} ({pc(pct_of(W, n), 1)}) over {n} games. Always taking the home team went {rec(hW, n - hW)}.")
    if len(vg) >= MIN_N:
        (good if rW >= vW else bad).append(f"On the {len(vg)} games that also had a Vegas line, the ratings went {S(rec(rW, len(vg) - rW))}. Vegas favorites went {rec(vW, len(vg) - vW)}.")
        err_r = mean([abs(g["line"] - (g["hs"] - g["as"])) for g in vg])
        err_v = mean([abs(g["vs"] - (g["hs"] - g["as"])) for g in vg])
        (good if err_r <= err_v else bad).append(f"On those games its line missed the final margin by {S(f'{err_r:.1f}')} points on average. Vegas missed by {err_v:.1f}.")
    pairs = [(norm_cdf(abs(g["line"]) / 16.95), int((g["line"] > 0) == (g["hs"] > g["as"]))) for g in live if g["line"] != 0]
    m["grade"] = grade_from(pct_of(rW, len(vg)), pct_of(vW, len(vg)), len(vg), m) if len(vg) >= GRADE_MIN_N else grade_from(pct_of(W, n), pct_of(hW, n), n, m)
    base_word = "Vegas favorites" if len(vg) >= GRADE_MIN_N else "always taking the home team"
    m["verdict"] = (f"Tracked on the side. It feeds the picks only as a backup, on runs where the advanced stats feed is down. "
                    f"So far it picks winners {('better than' if m['grade'] == 'Working' else 'worse than' if m['grade'] == 'Falling short' else 'about as well as')} {base_word}.")
    m["summary"] = f"Monitor only. {rec(W, n - W)} on winners so far."
    why.append(("Keep in mind", f"It's {n} games{', and only ' + str(len(vg)) + ' with a Vegas line to compare' if len(vg) < n else ''}. Weeks of results will tell more than this."))
    why.append(("Expected", f"Every team starts the season from a preseason rating worth {rt.get('preseason_weight', '?')} games, so early weeks lean on last year until real games pile up."))
    m["next"] = "keep logging it next to the main model and compare once there are a few hundred games."
    how = {"intro": f"Each team gets one number: how many points better it is than an average team, built from this season's scores. Updated {nice_date(rt.get('updated', ''))}, through Week {rt.get('games_through_week', '?')}.",
           "weights": [{"label": "Home field", "plain": "points added for the home team (none at a neutral site).", "value": f"+{rt.get('home_field', 0):.2f}", "unit": "points", "bar": None},
                       {"label": "Forgets old games", "plain": f"a game counts half after {rt.get('half_life_weeks')} weeks, so this season's games all count about the same.", "value": str(rt.get("half_life_weeks")), "unit": "weeks", "bar": None},
                       {"label": "Preseason rating", "plain": "worth this many games until real results take over.", "value": str(rt.get("preseason_weight")), "unit": "games", "bar": None}],
           "blend": [], "formula": f"ratings line = home team's rating - away team's rating + {rt.get('home_field', 0):.2f} home field\n               (no home field at a neutral site)", "walk": None}
    up = sorted([g for g in games if g["hs"] is None and g["line"] is not None], key=lambda g: g["start"])
    teams = {t["team"]: t for t in rt.get("teams", [])}
    if up:
        g = next((x for x in up if x["h"] in teams and x["a"] in teams), up[0])
        th, ta = teams.get(g["h"]), teams.get(g["a"])
        steps = []
        if th and ta:
            steps.append((f"{g['h']}'s rating", f"Offense {th['offense']:.1f}, defense {th['defense']:.1f}, ranked {th['overall_rank']}.", f"{th['overall']:+.1f}", ""))
            steps.append((f"{g['a']}'s rating", f"Offense {ta['offense']:.1f}, defense {ta['defense']:.1f}, ranked {ta['overall_rank']}.", f"{ta['overall']:+.1f}", ""))
            steps.append(("Add home field", "None at a neutral site." if g["neutral"] else "The home bonus.", "+0.0" if g["neutral"] else f"+{rt.get('home_field', 0):.1f}", ""))
        steps.append(("Ratings line", "The logged line for this game (ratings may have moved a little since it was logged).", f"{g['h'] if g['line'] > 0 else g['a']} by {abs(g['line']):.1f}", "final"))
        if g["vs"] is not None:
            steps.append(("Check Vegas", "Not used by the ratings, shown to compare.", f"{g['h'] if g['vs'] > 0 else g['a']} by {abs(g['vs']):g}", "v"))
        how["walk"] = {"title": f"{g['a']} at {g['h']}, Week {g['week']}", "sub": "The next game on the log.", "steps": steps, "note": ""}
    m["how"] = how
    rows = []
    for g in sorted(games, key=lambda g: (g["week"], g["start"])):
        res = None if g["hs"] is None or g["hs"] == g["as"] else g["hs"] > g["as"]
        if g["line"] is None:
            continue
        rp = g["line"] > 0
        c1 = [g["h"] if rp else g["a"], f"by {abs(g['line']):.1f}", "" if res is None else ("ok" if rp == res else "no")]
        if g["vs"] is not None:
            vp_ = (g["vp"] > 0.5) if g["vp"] is not None else g["vs"] > 0
            c2 = [g["h"] if vp_ else g["a"], f"by {abs(g['vs']):g}" if g["vs"] else "pick", "" if res is None else ("ok" if vp_ == res else "no")]
        else:
            c2 = ["", "no line", ""]
        rows.append({"g": str(g["week"]), "gl": f"W{g['week']}", "n": f"{g['a']} @ {g['h']}", "d": bool(g["vs"] is not None and (g["vs"] > 0) != rp),
                     "c": [c1, c2], "f": f"{g['a']} {g['as']:.0f}, {g['h']} {g['hs']:.0f}" if g["hs"] is not None else "Upcoming"})
    wks = sorted({g["week"] for g in games})
    sums = {}
    for wk in wks:
        L = [g for g in live if g["week"] == wk]
        a_ = sum((g["line"] > 0) == (g["hs"] > g["as"]) for g in L)
        sums[str(wk)] = f"Ratings {rec(a_, len(L) - a_)} (ties left out)" if L else "Not played yet"
    sums["all"] = f"Ratings {rec(W, n - W)} (ties left out)"
    gw = sorted({g["week"] for g in live})
    m["table"] = {"id": "t-cfb-ratings", "intro": "Every logged game. Shaded rows are games where the ratings and Vegas picked different winners.",
                  "tallies": [(rec(W, n - W), "Ratings, picking winners", "o"), (rec(vW, len(vg) - vW), f"Vegas favorite ({len(vg)} games with a line)", "v"),
                              (rec(hW, n - hW), "Always the home team", "")],
                  "callout": "", "sel": "Show week", "opts": [("all", "All weeks")] + [(str(w), f"Week {w}" + ("" if w in gw else " (upcoming)")) for w in sorted(wks, reverse=True)],
                  "def": str(max(gw)) if gw else "all", "cols": ["Game", "Ratings pick", "Vegas", "Final"], "rows": rows, "sums": sums,
                  "key": "The ratings and Vegas disagree. ✓ right, ✗ wrong."}
    m["tryout_title"] = "none logged"
    m["tryout_intro"] = "No tryouts are logged for the power ratings. Their settings are fixed in the code and tested by hand."
    m["note"] = f"Live log only, {n} graded games."
    m["status_line"] = f"{n} graded games"
    return m


# ═════════════════════════════════════════════════════════════════════════════
# MLB hitters
# ═════════════════════════════════════════════════════════════════════════════
FACTOR_WORDS = {"season_avg": "Season batting average", "recent_form": "Recent form", "playing_time": "At-bats per game",
                "pitcher_matchup": "Opposing starter", "platoon": "Platoon edge (lefty vs righty)", "park_factor": "Ballpark",
                "home_away": "Home or away"}
FEATURE_WORDS = {"season_avg": ("Season batting average", "factor: season_avg"), "recent_form_avg": ("Recent form", ""), "ab_per_game": ("At-bats per game", ""),
                 "is_home": ("Playing at home", ""), "platoon": ("Platoon edge", ""), "park_factor": ("Ballpark", ""),
                 "opp_pitcher_era": ("Opposing starter's ERA", ""), "opp_pitcher_whip": ("Opposing starter's walks + hits per inning", ""),
                 "opp_pitcher_k9": ("Opposing starter's strikeouts per 9", "")}


def build_hitters():
    m = new_model("mlb-hitters", "Hitters (1+ hit)")
    ph = load_json(path(MB, "picks_history.json"), {}) or {}
    mw = load_json(path(MB, "model_weights.json"), {}) or {}
    hist = (load_json(path(MB, "model_history.json"), {}) or {}).get("runs", [])
    picks = ph.get("picks", [])
    base = ph.get("baselines", {})
    for p in picks:
        note_date("MLB hitters", p["date"])
    graded = [p for p in picks if not p.get("void") and isinstance(p.get("got_hit"), bool)]
    n = len(graded)
    W = sum(p["got_hit"] for p in graded)
    # baseline: each pick day's all-hitter rate, weighted by that day's picks
    bl = [(base[p["date"]]["with_hit"] / base[p["date"]]["hitters"]) for p in graded if base.get(p["date"], {}).get("hitters")]
    bl_rate = mean(bl)
    nb = len(bl)
    era = [p for p in graded if p.get("model")]
    eW = sum(p["got_hit"] for p in era)
    good, bad, why = m["good"], m["bad"], m["why"]
    if n >= MIN_N and bl_rate is not None:
        line = f"Our picks got a hit {S(pc(pct_of(W, n), 1))} of the time ({rec(W, n - W)}, {n} picks). On the same days, {pc(bl_rate, 1)} of all hitters with an at-bat got one."
        (good if pct_of(W, n) > bl_rate + 0.02 else bad).append(line)
    if len(era) >= MIN_N:
        exp = mean([p["confidence"] / 100 for p in era])
        bl2 = mean([(base[p["date"]]["with_hit"] / base[p["date"]]["hitters"]) for p in era if base.get(p["date"], {}).get("hitters")])
        line = (f"Since the trained model took over on {nice_date(min(p['date'] for p in era))}: {S(rec(eW, len(era) - eW))} ({pc(pct_of(eW, len(era)))}), "
                f"against the {pc(exp)} it expected" + (f" and {pc(bl2)} for all hitters." if bl2 else "."))
        (good if pct_of(eW, len(era)) >= exp - 0.04 else bad).append(line)
        calib_bullets(calib_buckets([(p["confidence"] / 100, int(p["got_hit"])) for p in era], edges=(0.5, 0.6, 0.65, 0.7, 1.01)), "picks", good, bad)
    old = [p for p in graded if not p.get("model")]
    if len(old) >= MIN_N and len(era) >= MIN_N:
        oW = sum(p["got_hit"] for p in old)
        if pct_of(oW, len(old)) > pct_of(eW, len(era)) + 0.03:
            bad.append(f"The old scoring system it replaced went {S(rec(oW, len(old) - oW))} ({pc(pct_of(oW, len(old)))}), better than the trained model so far.")
        else:
            good.append(f"The old scoring system it replaced went {S(rec(oW, len(old) - oW))} ({pc(pct_of(oW, len(old)))}).")
    # by month trend
    months = sorted({p["date"][:7] for p in graded})
    mstats = []
    for mo in months:
        L = [p for p in graded if p["date"][:7] == mo]
        mstats.append((mo, sum(p["got_hit"] for p in L), len(L)))
    okm = [x for x in mstats if x[2] >= MIN_N]
    if len(okm) >= 2:
        best = max(okm, key=lambda x: x[1] / x[2])
        worst = min(okm, key=lambda x: x[1] / x[2])
        if best != worst:
            good.append(f"Best month: {dt.date.fromisoformat(best[0] + '-01').strftime('%B')}, {S(rec(best[1], best[2] - best[1]))} ({pc(best[1] / best[2])}).")
            bad.append(f"Worst month: {dt.date.fromisoformat(worst[0] + '-01').strftime('%B')}, {S(rec(worst[1], worst[2] - worst[1]))} ({pc(worst[1] / worst[2])}).")
    voids = sum(1 for p in picks if p.get("void"))
    if voids >= MIN_N:
        bad.append(f"{voids} picks were voided because the player didn't bat (benched, scratched or postponed). They aren't counted either way.")
    d = pct_of(W, n) - (bl_rate or 0)
    m["score"] = edge_score(pct_of(W, n), bl_rate or 0, n)
    m["grade"] = "Not graded" if n < GRADE_MIN_N else ("Working" if d >= 0.05 else "Mixed" if d >= 0 else "Falling short")
    m["verdict"] = (f"Its picks get a hit more often than the average hitter ({pc(pct_of(W, n))} vs {pc(bl_rate or 0)}), "
                    + ("by a clear margin." if d >= 0.05 else "but only by a little." if d >= 0 else "but it isn't beating the average hitter."))
    m["summary"] = f"{pc(pct_of(W, n))} of picks got a hit, vs {pc(bl_rate or 0)} for all hitters."
    why.append(("Strong evidence", "A hit in one game is close to a coin flip even for good hitters, so the edge any model can find is a few points, not a sure thing. The model's own test said a top-10 pick hits about " + pc((mw.get("metrics", {}).get("backtest") or {}).get("top_n_hit_rate", 0.7)) + " of the time."))
    if len(old) >= MIN_N and len(era) >= MIN_N:
        why.append(("Keep in mind", f"Most of the record ({len(old)} of {n} picks) comes from the old scoring system. The trained model has only {len(era)} graded picks."))
    if any("cold stretch" in (r.get("trigger") or "") for r in hist):
        r = [r for r in hist if "cold stretch" in (r.get("trigger") or "")][-1]
        why.append(("Our best guess", f"A cold run set off an early retrain on {nice_date(r['run_at'])}. It found nothing better and kept the recipe, which points to bad luck more than a broken model."))
    if len(era) < SMALL_N:
        why.append(("Keep in mind", f"{len(era)} picks from the trained model is a small sample. One bad week moves the rate a lot."))
    m["next"] = "the batting-order spot and whether the lineup is confirmed as inputs, since both are already logged."
    # how
    feats, wts = mw.get("features", []), mw.get("weights", [])
    biggest = max([abs(w) for w in wts] or [1])
    how = {"intro": f"A logistic regression on 9 inputs, each measured against a typical hitter. Trained on {mw.get('training_rows', 0):,} hitter-games through {nice_date(mw.get('trained_through', ''))}.",
           "weights": [], "blend": [], "walk": None, "bar_note": "Inputs are put on the same scale first, so bar length is a fair guide to how much each one matters."}
    for f, w in zip(feats, wts):
        lab = FEATURE_WORDS.get(f, (f, ""))[0]
        how["weights"].append({"label": lab, "plain": ("raises" if w > 0 else "lowers") + " the chance as it goes up.", "value": f"{w:+.3f}", "unit": "", "bar": abs(w) / biggest})
    how["formula"] = ("score  = {:.3f}".format(mw.get("bias", 0)) + " + sum of (weight × how far the input is from a typical hitter)\n"
                      "chance = 1 ÷ (1 + e^(-score))\npicks  = the day's top 10 chances, at most 2 per game, once lineups are posted")
    live_up = [p for p in picks if p.get("model") and p.get("factors") and p.get("raw_features")]
    pick = live_up[-1] if live_up else None
    if pick:
        steps = [("Start from a typical hitter", "Every hitter starts at the model's base score.", f"{pc(1 / (1 + math.exp(-mw.get('bias', 0))))}", "")]
        z = mw.get("bias", 0)
        for k, v in sorted(pick["factors"].items(), key=lambda kv: -abs(kv[1])):
            z += v
            steps.append((FACTOR_WORDS.get(k, k), "", f"{v:+.3f}", "o" if v >= 0 else "v"))
        steps.append(("His chance of a hit", f"Add them up ({z:.3f}) and turn the score into a chance.", f"{pick['confidence']:.1f}%", "final"))
        res = "" if pick.get("got_hit") is None else (" He got a hit." if pick["got_hit"] else " He went hitless.")
        rf = pick.get("raw_features", {})
        how["walk"] = {"title": f"{pick['player_name']} ({pick.get('team_abbr', '')} {'vs' if pick.get('is_home') else 'at'} {pick.get('opponent_abbr', '')}), {nice_date(pick['date'])}",
                       "sub": f"The latest pick on the log. Batting {ordinal(pick.get('batting_order'))}, facing {pick.get('opp_pitcher')} ({pick.get('opp_hand')}HP). Season average {format(rf.get('season_avg', 0), '.3f').lstrip('0')}, {rf.get('ab_per_game', 0):.1f} at-bats a game.{res}",
                       "steps": steps, "note": "Each step is that input's push on the score, from the log. Small differences from the final chance are rounding."}
    m["how"] = how
    rows = []
    for p in sorted(picks, key=lambda p: (p["date"], -p["confidence"])):
        if p.get("void"):
            fin, st = "Didn't bat", ""
        elif p.get("got_hit") is None:
            fin, st = "Upcoming", ""
        else:
            fin, st = f"{p.get('hits', 0)} for {p.get('at_bats', 0)}", "ok" if p["got_hit"] else "no"
        conf = f"{p['confidence']:.1f}%" if p.get("model") else f"score {p['confidence']:.0f}"
        rows.append({"g": p["date"], "gl": nice_date(p["date"]), "n": f"{p['player_name']} · {p.get('team_abbr') or p.get('team', '')}",
                     "d": False, "c": [[conf, "model" if p.get("model") else "old system", st]], "f": fin})
    sums = {}
    for day in sorted({p["date"] for p in picks}):
        L = [p for p in graded if p["date"] == day]
        b = base.get(day)
        sums[day] = (f"Picks {rec(sum(p['got_hit'] for p in L), len(L) - sum(p['got_hit'] for p in L))}" if L else "Not played yet") + (f" · all hitters {pc(b['with_hit'] / b['hitters'])}" if b and b.get("hitters") else "")
    sums["all"] = f"Picks {rec(W, n - W)} · all hitters {pc(bl_rate or 0)}"
    gd = sorted({p["date"] for p in graded})
    m["table"] = {"id": "t-mlb-hitters", "intro": "Every live pick. Before the trained model, picks came from an older point score, shown as “score”.",
                  "tallies": [(pc(pct_of(W, n), 1), f"Our picks with a hit ({rec(W, n - W)})", "o"), (pc(bl_rate or 0, 1), "All hitters, same days", "v"),
                              (pc(pct_of(eW, len(era)), 1) if era else "-", f"Trained model only ({len(era)} picks)", "")],
                  "callout": "", "sel": "Show date", "opts": [("all", "All dates")] + [(d_, nice_date(d_) + ("" if d_ in gd else " (upcoming)")) for d_ in sorted({p["date"] for p in picks}, reverse=True)],
                  "def": gd[-1] if gd else "all", "cols": ["Hitter", "Our chance", "Final"], "rows": rows, "sums": sums,
                  "key": "✓ got a hit, ✗ didn't. Picks where he didn't bat are left out of every record."}
    run = hist[-1] if hist else None
    if run:
        mets = [("log_loss", "Accuracy score<br>(lower is better)", lambda v: f"{v:.4f}", True),
                ("top10_hit_rate", "Top-10 picks with a hit", lambda v: pc(v, 1), False),
                ("auc", "Sorting score<br>(higher is better)", lambda v: f"{v:.3f}", False)]
        m["tryouts"] = tryouts_block(run.get("candidates", []), mw.get("recipe"), mets, run,
                                     extra_callout=(f"The last real switch was on {last_switch(hist)}." if last_switch(hist) else ""))
        m["tryout_title"] = f"Versions tested at the {nice_date(run['run_at'])} retrain"
        m["tryout_intro"] = (f"Every version was tested on {run.get('holdout', {}).get('rows', 0):,} hitter-games from {nice_date(run.get('holdout', {}).get('from', ''))} on that it hadn't seen. "
                             "The sorting score says how well it puts the hitters who got a hit above those who didn't. These are test scores, not live records.")
        note_date("MLB retrain", run["run_at"])
    m["note"] = f"Live picks only, {nice_date(min(p['date'] for p in picks))} to {nice_date(max(p['date'] for p in picks))}. {voids} picks where he didn't bat are left out."
    m["status_line"] = f"{n} graded picks"
    return m


# ═════════════════════════════════════════════════════════════════════════════
# Daily team-game models: MLB games, NHL, Soccer, NBA, CBB
# ═════════════════════════════════════════════════════════════════════════════
TEAM_CFG = {
    "mlb-games": {"dir": "teams", "name": "MLB games", "unit": "runs", "league": "MLB",
                  "feat": {"home_field": ("Home field", "the home team's edge, applied to every game"),
                           "elo": ("Team rating gap", "an Elo rating that moves with every result, carried across seasons"),
                           "starters": ("Starting pitchers", "each starter's edge over an average starter, from ERA and FIP, pulled toward average when he has few innings")},
                  "kind": "logit", "missing": "the lineup and the bullpen", "next": "the day's lineup and bullpen rest"},
    "nhl": {"dir": "nhl", "name": "NHL games", "unit": "goals", "league": "NHL",
            "feat": {"home_ice": ("Home ice", "goals added for the home team"), "elo": ("Team rating gap", "Elo rating, goal-margin adjusted"),
                     "net": ("Season goal difference", "per game, pulled toward 0 early in the season"),
                     "recent": ("Last 10 games", "goal difference over the last 10 games"), "rest": ("Rest", "days since the last game, capped at 3"),
                     "b2b_home": ("Home team on a back-to-back", "playing the second of two straight days"),
                     "b2b_away": ("Road team on a back-to-back", "playing the second of two straight days")},
            "kind": "margin", "missing": "the starting goalie", "next": "the confirmed starting goalie"},
    "nba": {"dir": "nba", "name": "NBA games", "unit": "points", "league": "NBA",
            "feat": {"home_court": ("Home court", "points added for the home team"), "elo": ("Team rating gap", "Elo rating, margin adjusted"),
                     "net": ("Season point difference", "per game, pulled toward 0 early on"), "recent": ("Last 10 games", "point difference over the last 10 games"),
                     "rest": ("Rest", "days since the last game, capped at 3"), "b2b_home": ("Home team on a back-to-back", ""), "b2b_away": ("Road team on a back-to-back", ""),
                     "missing_home": ("Home players out", "value of regular rotation players who aren't playing"),
                     "missing_away": ("Road players out", "value of regular rotation players who aren't playing")},
            "kind": "margin", "missing": "late injury news", "next": "",
            "start": "No live picks yet this season. NBA picks start with the first regular-season games in late October."},
    "cbb": {"dir": "cbb", "name": "CBB games", "unit": "points", "league": "CBB",
            "feat": {"home_court": ("Home court", "1 at a home court, 0 at a neutral site"), "em": ("Efficiency margin", "projected neutral-court margin from offense and defense ratings per 100 possessions"),
                     "elo": ("Team rating gap", "Elo rating; negative once the efficiency margin is counted"), "efg": ("Shooting", "effective field goal %, offense against defense"),
                     "tov": ("Turnovers", "offense against defense"), "orb": ("Offensive rebounds", "offense against defense"), "ftr": ("Free throw rate", "offense against defense"),
                     "recent": ("Last 5 games", "point difference"), "rest": ("Rest", "days since the last game, capped at 4"), "trank": ("Outside ratings", "")},
            "kind": "margin", "missing": "injuries", "next": "",
            "start": "No live picks yet this season. College basketball picks start when the season tips off in early November."},
    "soccer": {"dir": "soccer", "name": "Soccer matches", "unit": "goals", "league": "Soccer", "kind": "poisson", "missing": "team news and squad rotation",
               "next": "team news and a way to pick draws", "feat": {}},
}
COMP = {"EPL": "Premier League", "LALIGA": "LaLiga", "UCL": "Champions League"}


def book_fav(ml, side_keys):
    """Return (side, prob) of the book favorite from American prices, no-vig."""
    pr = {k: american_to_prob(ml.get(k + "_ml")) for k in side_keys}
    if any(v is None for v in pr.values()):
        return None, None
    tot = sum(pr.values())
    side = min(pr, key=lambda k: -pr[k])
    if sorted(pr.values())[-1] == sorted(pr.values())[-2]:
        return None, None
    return side, pr[side] / tot


def build_team(mid):
    cfg = TEAM_CFG[mid]
    d = path(MB, cfg["dir"])
    m = new_model(mid, cfg["name"])
    ph = load_json(path(d, "picks_history.json"), {}) or {}
    mw = load_json(path(d, "model_weights.json"), {}) or {}
    hist = (load_json(path(d, "model_history.json"), {}) or {}).get("runs", [])
    picks = ph.get("picks", [])
    soccer = cfg["kind"] == "poisson"
    sides = ("home", "draw", "away") if soccer else ("home", "away")
    for p in picks:
        note_date(cfg["league"] + " picks", p.get("date"))
    graded = [p for p in picks if not p.get("void") and p.get("correct") in (True, False) and p.get("winner")]
    # leave out ties (a soccer draw is a real result: our pick never takes the draw, so it counts as a miss)
    if not soccer:
        graded = [p for p in graded if p["winner"] in (p["home"], p["away"])]
    n = len(graded)
    W = sum(p["correct"] for p in graded)
    hW = sum(p["winner"] == p["home"] for p in graded)
    bf = []
    for p in graded:
        side, prob = book_fav(p.get("ml") or {}, sides)
        if side:
            team = p["home"] if side == "home" else p["away"] if side == "away" else "Draw"
            bf.append((p, team, prob))
    bW = sum(t == p["winner"] for p, t, _ in bf)
    ourW_bf = sum(p["correct"] for p, _, _ in bf)
    good, bad, why = m["good"], m["bad"], m["why"]
    upcoming = [p for p in picks if p.get("correct") is None and not p.get("void")]

    # How it makes a pick
    coef = mw.get("coef", {})
    how = {"intro": "", "weights": [], "blend": [], "formula": "", "walk": None}
    if soccer:
        how["intro"] = (f"Every club gets an attack and a defence rating, tied to its league's level, with older matches fading (half after {mw.get('recipe', {}).get('half_life')} days). "
                        f"Expected goals for each side become home win, draw and away win chances, and the pick is the most likely of home win or away win. Trained on {mw.get('training_matches', 0):,} matches through {nice_date(mw.get('trained_through', ''))}.")
        leagues = {k[7:]: v for k, v in coef.items() if k.startswith("league_")}
        lname = {"E0": "England", "SP1": "Spain", "D1": "Germany", "I1": "Italy", "F1": "France", "N1": "Netherlands", "P1": "Portugal", "B1": "Belgium",
                 "SC0": "Scotland", "T1": "Turkey", "OTHER": "Other leagues"}
        lo, hi = min(leagues.values() or [0]), max(leagues.values() or [1])
        for k, v in sorted(leagues.items(), key=lambda kv: -kv[1]):
            how["weights"].append({"label": lname.get(k, k), "plain": "league strength, from Champions League and other cross-league results.", "value": f"{v:+.2f}", "unit": "", "bar": (v - lo) / (hi - lo) if hi > lo else 0.5})
        how["bar_note"] = "Bar length shows league strength, weakest to strongest. A club's rating is its league's level plus its own difference."
        how["formula"] = (f"home goals ~ e^(base + home edge ({coef.get('home', 0):.2f}) + home attack - away defence)\n"
                          "away goals ~ e^(base + away attack - home defence)\n"
                          f"low scores get a small draw correction ({coef.get('rho', 0):+.2f})\n"
                          "chances    = add up every scoreline from 0-0 to 10-10\npick       = home win or away win, whichever is more likely")
    else:
        feats = mw.get("features") or list(coef)
        biggest = max([abs(coef.get(f, 0)) for f in feats] or [1])
        if cfg["kind"] == "logit":
            how["intro"] = (f"A logistic regression on three inputs. Trained on {mw.get('training_games', 0):,} games ({mw.get('trained_on', '')}). "
                            "Each input pushes the home team's chance up or down.")
            how["bar_note"] = "Bar length shows the average push each input gave across our live picks, so it is a fair guide to how much each one matters."
            avg = {f: mean([abs(p.get("factors", {}).get(f, 0)) for p in picks if p.get("factors")]) or 0 for f in feats}
            big2 = max(avg.values() or [1]) or 1
            for f in feats:
                lab, plain = cfg["feat"].get(f, (f, ""))
                how["weights"].append({"label": lab, "plain": plain + f". Average push {avg[f]:.3f}.", "value": f"{coef.get(f, 0):+.3f}", "unit": "", "bar": avg[f] / big2})
            how["formula"] = ("score  = " + "\n       + ".join(f"{coef.get(f, 0):.3f} × {cfg['feat'].get(f, (f,))[0].lower()}" for f in feats)
                              + "\nchance = 1 ÷ (1 + e^(-score))   (home team's chance to win)\npick   = whichever team has the higher chance")
        else:
            how["intro"] = (f"It predicts the home team's margin from {len(feats)} inputs, then turns the margin into a win chance. "
                            f"Trained on {mw.get('training_games', 0):,} games ({mw.get('trained_on', '')}).")
            how["bar_note"] = "Bar length shows the size of each weight. Inputs are on different scales (a yes/no flag, a rating gap, goals per game), so treat it as a rough guide."
            for f in feats:
                if f not in coef or coef.get(f) == 0:
                    continue
                lab, plain = cfg["feat"].get(f, (f, ""))
                how["weights"].append({"label": lab, "plain": (plain + ". " if plain else "") + f"{'Adds' if coef[f] > 0 else 'Takes'} {abs(coef[f]):.2f} {cfg['unit']} {'to' if coef[f] > 0 else 'from'} the home margin per unit.",
                                       "value": f"{coef[f]:+.2f}", "unit": "", "bar": abs(coef[f]) / biggest})
            terms = [(coef[f], cfg['feat'].get(f, (f,))[0].lower()) for f in feats if coef.get(f)]
            how["formula"] = ("home margin = " + f"{terms[0][0]:.2f} × {terms[0][1]}" + "".join(f"\n            {'+' if c >= 0 else '-'} {abs(c):.2f} × {lab}" for c, lab in terms[1:])
                              + f"\nwin chance  = margin ÷ {mw.get('sigma', 0):.2f} on a bell curve")
    # walkthrough
    pick = None
    if upcoming:
        pick = sorted(upcoming, key=lambda p: (p.get("start", ""), p.get("game_id")))[0]
        kind = "the next pick waiting on a result"
    elif graded:
        pick = graded[-1]
        kind = "the latest graded game"
    if pick:
        steps = []
        H, A = pick["home"], pick["away"]
        if cfg["kind"] == "logit" and pick.get("factors"):
            z = 0
            for f, v in pick["factors"].items():
                z += v
                extra = ""
                if f == "starters":
                    extra = f"{pick.get('home_sp', {}).get('name', '?')} (ERA {pick.get('home_sp', {}).get('era', '?')}) vs {pick.get('away_sp', {}).get('name', '?')} (ERA {pick.get('away_sp', {}).get('era', '?')})."
                elif f == "elo":
                    extra = f"Records: {H} {pick.get('home_record', '')}, {A} {pick.get('away_record', '')}."
                elif f == "home_field":
                    extra = "Same for every game."
                steps.append((cfg["feat"].get(f, (f,))[0], extra, f"{abs(v):.3f} toward {H if v >= 0 else A}", "o" if v >= 0 else "v"))
            steps.append(("Turn it into a chance", f"Add them up ({z:+.3f}) and turn the score into the home team's chance.", f"{H} {pick['home_prob']:.1f}%", "o"))
        elif cfg["kind"] == "margin" and pick.get("margin") is not None:
            steps.append(("Predict the margin", f"Ratings, goal difference, recent form and rest go in. Rest: {H} {pick.get('rest', {}).get('home', '?')} days, {A} {pick.get('rest', {}).get('away', '?')} days. Only the final margin is logged.",
                          f"{pick['pick']} by {pick['margin']:.2f} {cfg['unit']}", "o"))
            steps.append(("Turn it into a win chance", f"{cfg['league']} margins land within about {mw.get('sigma', 0):.1f} {cfg['unit']} of the prediction two times in three.", f"{pick['pick']} {pick['prob']:.1f}%", "o"))
        elif soccer:
            xg = pick.get("xg", {})
            pr = pick.get("probs", {})
            steps.append(("Expected goals", f"From each club's attack and defence, with the home edge added. {COMP.get(pick.get('comp'), pick.get('comp', ''))}.", f"{H} {xg.get('home', 0):.2f} · {A} {xg.get('away', 0):.2f}", "o"))
            steps.append(("Three chances", "Every scoreline from 0-0 to 10-10, added up.", f"{H} {pr.get('home', 0):.0f}% · draw {pr.get('draw', 0):.0f}% · {A} {pr.get('away', 0):.0f}%", "o"))
        ml = pick.get("ml") or {}
        if ml.get("book_prob") is not None:
            steps.append(("Check the sportsbook", f"{ml.get('book', 'Book')}: {H} {price_str(ml.get('home_ml'))}" + (f", draw {price_str(ml.get('draw_ml'))}" if soccer else "") + f", {A} {price_str(ml.get('away_ml'))}. Its chance for our side, with the cut taken out:",
                          f"{pick['pick']} {ml['book_prob']:.1f}%", "v"))
        steps.append(("What we post", (f"Edge {ml['edge']:+.1f} points" + (", a Value pick." if ml.get("value") else ", not big enough for a Value pick.")) if ml.get("edge") is not None else "",
                      f"{pick['pick']} {pick['prob']:.1f}%", "final"))
        res = ""
        if pick.get("winner"):
            res = f" Final: {A} {pick.get('away_runs', pick.get('away_pts', ''))}, {H} {pick.get('home_runs', pick.get('home_pts', ''))}."
        how["walk"] = {"title": f"{pick.get('away_name', A)} at {pick.get('home_name', H)}, {nice_date(pick['date'])}", "sub": f"This is {kind}.{res}", "steps": steps,
                       "note": "" if cfg["kind"] == "logit" else "The log keeps the model's final numbers for each game, not every input, so the inputs aren't split out here."}
    m["how"] = how

    # Table
    rows = []
    for p in sorted(picks, key=lambda p: (p["date"], p.get("start", ""))):
        H, A = p["home"], p["away"]
        res_known = p.get("winner") and not p.get("void")
        st = "" if not res_known else ("ok" if p.get("correct") else "no")
        ml = p.get("ml") or {}
        side, prob = book_fav(ml, sides)
        bteam = None if not side else (H if side == "home" else A if side == "away" else "Draw")
        bst = "" if not res_known or not bteam else ("ok" if bteam == p["winner"] else "no")
        mlres = ""
        if ml.get("units") is not None and res_known:
            mlres = f"{'+' if ml['units'] >= 0 else '-'}${abs(ml['units']) * STAKE:.0f}"
        hp = p.get("home_pts", p.get("home_runs"))
        ap = p.get("away_pts", p.get("away_runs"))
        fin = "Void" if p.get("void") else (f"{A} {ap}, {H} {hp}" if hp is not None else "Upcoming")
        rows.append({"g": p["date"], "gl": nice_date(p["date"]), "n": f"{A} @ {H}" + (f" · {COMP.get(p.get('comp'), p.get('comp'))}" if soccer else (" · playoffs" if p.get("type") == "postseason" else "")),
                     "d": bool(bteam and bteam != p["pick"]),
                     "c": [[p["pick"], f"{p['prob']:.0f}%", st], [bteam or "", (f"{prob * 100:.0f}%" if prob else ""), bst],
                           [("Value " if ml.get("value") else "") + price_str(ml.get("price")) if ml.get("price") is not None else "", mlres, ""]],
                     "f": fin})
    dates = sorted({p["date"] for p in picks})
    gd = sorted({p["date"] for p in graded})
    sums = {}
    for day in dates:
        L = [p for p in graded if p["date"] == day]
        a_ = sum(p["correct"] for p in L)
        sums[day] = f"Our picks {rec(a_, len(L) - a_)}" if L else "Not played yet"
    sums["all"] = f"Our picks {rec(W, n - W)}"
    if picks:
        m["table"] = {"id": f"t-{mid}", "intro": "Every live pick. Shaded rows are games where our pick and the sportsbook favorite differ." + (" A draw counts as a miss, since we never pick a draw." if soccer else ""),
                      "tallies": [(rec(W, n - W), "Our picks", "o"), (rec(bW, len(bf) - bW), f"Sportsbook favorite ({len(bf)} with odds)", "v"),
                                  (rec(hW, n - hW), "Always the home team", "")],
                      "callout": "", "sel": "Show date", "opts": [("all", "All dates")] + [(d_, nice_date(d_) + ("" if d_ in gd else " (upcoming)")) for d_ in reversed(dates)],
                      "def": gd[-1] if gd else "all", "cols": ["Game", "Our pick", "Sportsbook favorite", f"Moneyline (${STAKE})", "Final"], "rows": rows, "sums": sums,
                      "key": "Our pick and the sportsbook favorite differ. ✓ right, ✗ wrong. Moneyline shows the price we took and the result at $" + str(STAKE) + " a pick."}

    # Working / falls short
    if n >= MIN_N:
        line = f"Winners: {S(rec(W, n - W))} ({pc(pct_of(W, n), 1)}) over {n} {'matches' if soccer else 'games'}."
        if len(bf) >= MIN_N:
            line += f" Taking every sportsbook favorite went {S(rec(bW, len(bf) - bW))} ({pc(pct_of(bW, len(bf)), 1)})" + (f" on the {len(bf)} with odds." if len(bf) != n else ".")
            (good if ourW_bf > bW else bad if ourW_bf < bW else good).append(line + (" Even with the sportsbook." if ourW_bf == bW else ""))
        else:
            (good if W > hW else bad).append(line + f" Always taking the home team went {rec(hW, n - hW)}.")
    dis = [(p, t) for p, t, _ in bf if t != p["pick"]]
    if len(dis) >= MIN_N:
        r_ = sum(p["correct"] for p, _ in dis)
        (good if r_ * 2 > len(dis) else bad).append(f"When it picked against the sportsbook favorite, it was right {S(f'{r_} of {len(dis)}')} times.")
    toss = [p for p in graded if p["prob"] < 55]
    if len(toss) >= MIN_N:
        a_ = sum(p["correct"] for p in toss)
        (good if a_ * 2 > len(toss) else bad).append(f"In {len(toss)} near toss-ups (it gave its pick under 55%) it went {S(rec(a_, len(toss) - a_))}.")
    strong = [p for p in graded if p["prob"] >= 60]
    if len(strong) >= MIN_N:
        a_ = sum(p["correct"] for p in strong)
        exp = mean([p["prob"] / 100 for p in strong])
        (good if pct_of(a_, len(strong)) >= exp - 0.05 else bad).append(f"When it was confident (60% or more, {len(strong)} games) it went {S(rec(a_, len(strong) - a_))}, about {pc(exp)} expected.")
    mlg = [p for p in graded if (p.get("ml") or {}).get("units") is not None and (p.get("ml") or {}).get("won") is not None]
    if len(mlg) >= MIN_N:
        w_ = sum(bool(p["ml"]["won"]) for p in mlg)
        u = sum(p["ml"]["units"] for p in mlg)
        (good if u > 0 else bad).append(f"Moneyline picks: {S(rec(w_, len(mlg) - w_))}, {S(money(u))} at ${STAKE} a pick.")
    vv = [p for p in mlg if p["ml"].get("value")]
    if vv:
        w_ = sum(bool(p["ml"]["won"]) for p in vv)
        u = sum(p["ml"]["units"] for p in vv)
        if len(vv) >= MIN_N:
            (good if u > 0 else bad).append(f"Value picks: {S(rec(w_, len(vv) - w_))}, {S(money(u))} at ${STAKE} a pick.")
    calib_bullets(calib_buckets([(p["prob"] / 100, int(p["correct"])) for p in graded],
                                edges=(0.0, 0.45, 0.55, 0.65, 1.01) if soccer else (0.5, 0.55, 0.6, 0.65, 1.01)), "picks", good, bad)
    home_rate = pct_of(hW, n)
    hp_rate = pct_of(sum(p["pick"] == p["home"] for p in graded), n)
    if n >= MIN_N and abs(hp_rate - home_rate) >= 0.08 and not soccer:
        bad.append(f"It leans {'home' if hp_rate > home_rate else 'road'}. It picked the home team {S(pc(hp_rate))} of the time, but home teams won {S(pc(home_rate))} ({n} games).")
    if soccer:
        draws = sum(p["winner"] == "Draw" for p in graded)
        if n >= MIN_N and draws:
            bad.append(f"{S(draws)} of {n} matches ended in a draw, and a draw is always a miss for us. Without them it went {rec(W, n - W - draws)}.")
    post = [p for p in graded if p.get("type") == "postseason"]
    reg = [p for p in graded if p.get("type") == "regular"]
    if len(post) >= MIN_N and len(reg) >= MIN_N:
        a_, b_ = sum(p["correct"] for p in reg), sum(p["correct"] for p in post)
        (good if pct_of(b_, len(post)) >= pct_of(a_, len(reg)) else bad).append(f"Regular season {S(rec(a_, len(reg) - a_))}, playoffs {S(rec(b_, len(post) - b_))}.")
    # weekly groups
    def wk(p):
        d_ = dt.date.fromisoformat(p["date"])
        return (d_ - dt.timedelta(days=d_.weekday())).isoformat()
    wks = sorted({wk(p) for p in graded})
    wst = []
    for w_ in wks:
        L = [p for p in graded if wk(p) == w_]
        LB = [(p, t) for p, t, _ in bf if wk(p) == w_]
        wst.append((w_, sum(p["correct"] for p in L), len(L), sum(t == p["winner"] for p, t in LB), len(LB)))
    okw = [x for x in wst if x[2] >= MIN_N]
    if len(okw) >= 2:
        best = max(okw, key=lambda x: x[1] / x[2])
        worst = min(okw, key=lambda x: x[1] / x[2])
        if best != worst:
            if best[1] / best[2] > (best[3] / best[4] if best[4] else 0.5):
                good.append(f"Best week: the week of {nice_date(best[0])}, {S(rec(best[1], best[2] - best[1]))} ({best[2]} {'matches' if soccer else 'games'})" + (f". Sportsbook favorites went {rec(best[3], best[4] - best[3])}." if best[4] else "."))
            if worst[1] / worst[2] < (worst[3] / worst[4] if worst[4] else 0.5):
                bad.append(f"Worst week: the week of {nice_date(worst[0])}, {S(rec(worst[1], worst[2] - worst[1]))} ({worst[2]} {'matches' if soccer else 'games'})" + (f". Sportsbook favorites went {rec(worst[3], worst[4] - worst[3])}." if worst[4] else "."))
    m["chart"] = bar_chart([(f"Wk of {nice_date(x[0])}", x[1], x[2], x[3], x[4]) for x in wst], "Our picks", "Sportsbook favorite",
                           f"Winners picked each week, our picks vs sportsbook favorites ({n} {'matches' if soccer else 'games'}).") if len(wst) >= 2 else ""
    # brier vs book on the same games
    ob = mean([((p["prob"] / 100) - (1 if p["correct"] else 0)) ** 2 for p, _, _ in bf])
    bkb = None
    if bf:
        vals = []
        for p, _, _ in bf:
            ml = p["ml"]
            if ml.get("book_prob") is not None:
                vals.append(((ml["book_prob"] / 100) - (1 if p["correct"] else 0)) ** 2)
        bkb = mean(vals)

    # Why
    if n >= MIN_N and len(bf) >= MIN_N and ourW_bf < bW:
        why.append(("Our best guess", f"The sportsbook knows {cfg['missing']} before the game, and the model doesn't use {'it' if cfg['missing'].startswith('the starting') else 'them'}. That is the most likely reason it trails the book's favorites."))
    elif n >= MIN_N and ob is not None and bkb is not None and ob > bkb:
        why.append(("Our best guess", f"The sportsbook's chances were a little more accurate than ours on the same games. The book knows {cfg['missing']}, which the model doesn't use."))
    if mid == "nhl" and picks:
        first = min(p["date"] for p in picks)
        why.append(("Expected", f"The season started {nice_date(first)}. Season goal difference and recent form start at zero and grow in, and team ratings keep {mw.get('league', {}).get('elo_carry', 0.7) * 100:.0f}% of last season, so early picks lean mostly on last year."))
    if mid == "mlb-games" and post:
        why.append(("Keep in mind", f"{len(post)} of these are playoff games, where every team is good and the gaps the model looks for are smaller."))
    if soccer and n:
        dr = (mw.get("recent_holdout") or {}).get("draw_rate")
        why.append(("Strong evidence", f"The model never picks a draw, and about {pc(dr or 0.24)} of matches end in one (in its own test games). So a soccer pick starts out losing about one match in four before any team is picked wrong."))
    if n >= MIN_N and abs(hp_rate - home_rate) >= 0.08 and not soccer:
        why.append(("Our best guess", f"The home edge comes from past seasons. This season home teams have won {pc(home_rate)} of our {n} games, which may just be noise this early."))
    if 0 < n < SMALL_N:
        why.append(("Keep in mind", f"It's {n} {'matches' if soccer else 'games'}. A few results either way move these numbers a lot."))

    # Grade + verdict
    if not picks:
        m["grade"] = "Off-season"
        m["verdict"] = cfg.get("start", "No live picks yet this season.")
        m["summary"] = cfg.get("start", "No live picks yet.")
        m["status_line"] = "No live picks yet"
    else:
        if len(bf) >= GRADE_MIN_N:
            m["grade"] = grade_from(pct_of(ourW_bf, len(bf)), pct_of(bW, len(bf)), len(bf), m)
            base_txt = f"sportsbook favorites ({rec(bW, len(bf) - bW)})"
            mine = rec(ourW_bf, len(bf) - ourW_bf)
        else:
            m["grade"] = grade_from(pct_of(W, n), pct_of(hW, n), n, m)
            base_txt = f"always taking the home team ({rec(hW, n - hW)})"
            mine = rec(W, n - W)
        g = m["grade"]
        same = f" on the {len(bf)} {'matches' if soccer else 'games'} with odds" if len(bf) >= GRADE_MIN_N else ""
        if g == "Working":
            m["verdict"] = f"Picking more winners than {base_txt.split(' (')[0]}: {mine} against {base_txt.split('(')[1][:-1]}{same}."
        elif g == "Falling short":
            m["verdict"] = f"Picking fewer winners than {base_txt.split(' (')[0]}: {mine} against {base_txt.split('(')[1][:-1]}{same}."
        elif g == "Mixed":
            m["verdict"] = f"About even with {base_txt.split(' (')[0]}: {mine} against {base_txt.split('(')[1][:-1]}{same}."
        else:
            m["verdict"] = f"Only {n} graded {'matches' if soccer else 'games'} so far, too few to grade. {rec(W, n - W)} to date."
        if soccer and n:
            m["verdict"] += " Draws count against it."
        m["summary"] = m["verdict"]
        m["status_line"] = f"{n} graded {'matches' if soccer else 'games'}"
        m["note"] = f"Live picks only, {nice_date(min(p['date'] for p in picks))} to {nice_date(max(p['date'] for p in picks))}." + (" Ties left out." if not soccer else "")
    m["next"] = cfg["next"] + "." if cfg.get("next") else ("grading its first live picks once the season starts." if not picks else "")

    # Tryouts
    run = hist[-1] if hist else None
    if run:
        cands = [{"recipe": c["recipe"], "log_loss": c.get("log_loss")} for c in run.get("candidates", [])]
        mets = [("log_loss", "Accuracy score<br>(lower is better)", lambda v: f"{v:.4f}", True)]
        m["tryouts"] = tryouts_block(cands, mw.get("recipe"), mets, run,
                                     extra_callout=(f"The last real switch was on {last_switch(hist)}." if last_switch(hist) else ""))
        ho = run.get("holdout", {})
        m["tryout_title"] = f"Versions tested at the {nice_date(run['run_at'])} retrain"
        m["tryout_intro"] = (f"Every version was tested on the {ho.get('games', '?')} most recent {'matches' if soccer else 'games'} it hadn't seen (from {nice_date(ho.get('from', ''))}). "
                             f"For scale, always guessing the usual home win rate scores {ho.get('home_rate_log_loss', '?')}. These are test scores, not live records.")
        note_date(cfg["league"] + " retrain", run["run_at"])
    return m


# ═════════════════════════════════════════════════════════════════════════════
# Rendering
# ═════════════════════════════════════════════════════════════════════════════
CSS = r"""
:root{
  --bg:#f2eee6;--surface:#f8f5ef;--surface-2:#e7e1d5;--rule:#d3ccbe;--text:#1b1b19;--muted:#5e5a51;--faint:#6b665c;
  --ours:#a4532b;--vegas:#3c6788;--hit:#2f6b45;--miss:#9a3b2c;--warn:#8a6a1c;--forest:#1e3a2c;--forest-ink:#f2eee6;--actual:#1b1b19;
  --font:'Archivo','Helvetica Neue',Arial,sans-serif;--serif:'Instrument Serif','Iowan Old Style',Georgia,serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#141815;--surface:#1a1f1b;--surface-2:#212722;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--faint:#8d887c;
  --ours:#d98b5f;--vegas:#9db8cf;--hit:#8cc59c;--miss:#e58c78;--warn:#d9b85f;--forest:#22402f;--forest-ink:#ece7dc;--actual:#ece7dc}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#141815;--surface:#1a1f1b;--surface-2:#212722;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--faint:#8d887c;
  --ours:#d98b5f;--vegas:#9db8cf;--hit:#8cc59c;--miss:#e58c78;--warn:#d9b85f;--forest:#22402f;--forest-ink:#ece7dc;--actual:#ece7dc}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.55;margin:0}
.top{background:var(--forest);color:var(--forest-ink);padding-inline:16px;padding-block:10px;font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.top b{font-family:var(--font);font-stretch:125%;font-weight:800;letter-spacing:.06em}
.wrap{max-width:1040px;margin:0 auto;padding-inline:16px;padding-block:24px 64px;display:grid;gap:28px;min-width:0}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.1rem,6vw,3.2rem);line-height:1.02;margin:0;text-wrap:balance}
h1 i{color:var(--ours)}
.lede{color:var(--muted);max-width:66ch;margin:8px 0 0}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:2px solid var(--text);padding-bottom:10px}
.tabs button{font:inherit;font-weight:700;font-stretch:112%;font-size:.9rem;background:transparent;color:var(--text);border:1px solid var(--rule);border-radius:999px;padding:6px 14px;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.tabs button:focus-visible{outline:2px solid var(--ours);outline-offset:2px}
.panel{display:grid;gap:28px;min-width:0}
.panel[hidden]{display:none}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.sum{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;display:grid;gap:4px;text-decoration:none;color:inherit}
.sum:hover{border-color:var(--text)}
.sum h3{margin:0;font-size:.95rem;font-stretch:112%;font-weight:800}
.sum p{margin:0;font-size:.88rem;color:var(--muted)}
.grade{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid currentColor;justify-self:start;white-space:nowrap}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.score{font-family:var(--mono);font-weight:500;font-size:13px;padding:1px 8px;border-radius:999px;background:var(--surface-2);white-space:nowrap}
.score small{font-size:10px;opacity:.7}
.chips{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.board{width:100%;border-collapse:collapse;font-size:14px}
.board th,.board td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--rule)}
.board th{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:400}
@media (max-width:520px){.board .barcol{display:none}}
.board td.n{font-family:var(--mono);white-space:nowrap}
.bar{height:8px;border-radius:4px;background:var(--surface-2);position:relative;min-width:80px}
.bar i{position:absolute;inset:0 auto 0 0;border-radius:4px;background:currentColor}
.bar b{position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--faint)}
.g-good{color:var(--hit)}.g-mixed{color:var(--warn)}.g-bad{color:var(--miss)}.g-none{color:var(--faint)}
.model{display:grid;gap:14px;border-top:1px solid var(--rule);padding-top:20px;min-width:0}
.model-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.model-h h2{margin:0;font-stretch:112%;font-weight:800;font-size:1.35rem}
.verdict{margin:0;font-family:var(--serif);font-size:1.35rem;line-height:1.25;max-width:60ch}
.sub{display:grid;gap:12px;min-width:0}
.sub>h3{margin:6px 0 0;font-size:1.05rem;font-weight:800;font-stretch:112%;border-top:2px solid var(--text);padding-top:10px}
.sub>p,.subp{margin:0;color:var(--muted);max-width:72ch}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:720px){.two{grid-template-columns:1fr}}
.col{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:14px 16px;display:grid;gap:8px;align-content:start;min-width:0}
.col h3{margin:0;font-size:.78rem;font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase;font-weight:500}
.col.good h3{color:var(--hit)}.col.bad h3{color:var(--miss)}
.col ul{margin:0;padding-left:1.1em;display:grid;gap:7px}
.col .none{color:var(--faint);font-size:.9rem;margin:0}
.num{font-variant-numeric:tabular-nums;font-weight:700}
.why{background:var(--surface-2);border-radius:6px;padding:14px 16px;display:grid;gap:8px}
.why h3{margin:0;font-size:1rem;font-weight:800;font-stretch:112%}
.why ol{margin:0;padding-left:1.2em;display:grid;gap:8px;max-width:75ch}
.why .tag{font-family:var(--mono);font-size:10.5px;color:var(--faint);letter-spacing:.06em;text-transform:uppercase;border:0;padding:0;margin:0}
.try{margin:0;font-size:.92rem}
.try b{color:var(--ours)}
figure{margin:0;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:14px 16px;display:grid;gap:8px;min-width:0}
figcaption{font-size:.85rem;color:var(--muted)}
figure .chart{overflow-x:auto}
svg text{fill:var(--muted);font-family:var(--mono);font-size:11px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:.82rem;color:var(--muted)}
.legend span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--c)}
.note{color:var(--faint);font-size:.85rem;max-width:75ch;margin:0}
/* weights */
.wts{display:grid;gap:0;background:var(--surface);border:1px solid var(--rule);border-radius:6px;min-width:0}
.wt{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) 5.5rem;gap:12px;align-items:center;padding:9px 14px;border-bottom:1px solid var(--rule)}
.wt:last-child{border-bottom:0}
.wt b{font-weight:700;font-size:.92rem}
.wt p{margin:0;color:var(--muted);font-size:.85rem}
.wt .v{font-family:var(--mono);font-size:.9rem;text-align:right;white-space:nowrap}
.wt .bar{height:6px;background:var(--surface-2);border-radius:3px;margin-top:6px;overflow:hidden}
.wt .bar i{display:block;height:100%;background:var(--ours);border-radius:3px}
@media (max-width:560px){.wt{grid-template-columns:minmax(0,1fr) auto}.wt p{grid-column:1/-1;grid-row:2}}
/* walkthrough */
.matchup{margin:0;font-stretch:112%;font-weight:800;font-size:1.1rem}
.steps{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:s}
.steps li{display:grid;grid-template-columns:2.2rem minmax(0,1fr) auto;gap:12px;align-items:center;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;counter-increment:s}
.steps li::before{content:counter(s);font-family:var(--mono);font-size:12px;width:1.8rem;height:1.8rem;border-radius:50%;border:1px solid var(--rule);display:grid;place-items:center;color:var(--faint)}
.steps h4{margin:0;font-size:.98rem;font-weight:700}
.steps p{margin:2px 0 0;color:var(--muted);font-size:.88rem}
.out{font-family:var(--mono);font-size:.95rem;font-weight:500;white-space:nowrap;text-align:right}
.out.o{color:var(--ours)}.out.v{color:var(--vegas)}
.steps li.final{border-color:var(--text);border-width:2px}
@media (max-width:560px){.steps li{grid-template-columns:2.2rem minmax(0,1fr)}.out{grid-column:2;text-align:left;white-space:normal}}
.formula{font-family:var(--mono);font-size:.84rem;background:var(--surface-2);border-radius:6px;padding:12px 14px;overflow-x:auto;white-space:pre;line-height:1.7;margin:0}
/* tallies + tables */
.tally{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media (max-width:560px){.tally{grid-template-columns:1fr}}
.t{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;display:grid;gap:2px}
.t b{font-family:var(--mono);font-size:1.5rem;font-weight:500;font-variant-numeric:tabular-nums}
.t span{color:var(--muted);font-size:.85rem}
.t.o b{color:var(--ours)}.t.v b{color:var(--vegas)}
.bar-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
label{font-size:.9rem;color:var(--muted)}
select{font:inherit;padding:5px 8px;border-radius:4px;border:1px solid var(--rule);background:var(--surface);color:var(--text);max-width:100%}
select:focus-visible{outline:2px solid var(--ours);outline-offset:2px}
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:6px;background:var(--surface);max-height:640px;overflow-y:auto}
table{border-collapse:collapse;width:100%;min-width:600px;font-size:.88rem}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--rule);font-variant-numeric:tabular-nums;vertical-align:top}
th{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:500;background:var(--surface-2);position:sticky;top:0}
tr:last-child td{border-bottom:0}
td.game{font-weight:700}
.pick{white-space:nowrap}
.pick small{color:var(--faint);margin-left:4px}
.ok::after{content:" ✓";color:var(--hit);font-weight:700}
.no::after{content:" ✗";color:var(--miss);font-weight:700}
.differ{background:color-mix(in srgb,var(--ours) 9%,transparent)}
.key{font-size:.85rem;color:var(--muted);margin:0}
.key i{display:inline-block;width:12px;height:12px;vertical-align:-2px;border-radius:2px;background:color-mix(in srgb,var(--ours) 18%,transparent);margin-right:5px}
.callout{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--ours);border-radius:6px;padding:12px 16px;max-width:80ch}
.callout p{margin:0}
.live td{font-weight:700}
.best td:first-child::after{content:" · best score";font-weight:400;color:var(--faint);font-size:.8rem}
.tag{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:1px 6px;margin-left:6px;color:var(--hit)}
.helps{margin:0;padding-left:1.1em;color:var(--muted);font-size:.86rem;display:grid;gap:3px;max-width:80ch}
.empty{background:var(--surface);border:1px dashed var(--rule);border-radius:6px;padding:14px 16px;color:var(--muted);margin:0}
footer{border-top:2px solid var(--text);padding-top:12px;display:grid;gap:6px}
"""

JS = r"""
(function(){
  var D=JSON.parse(document.getElementById('mr-data').textContent);
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function render(id,g){
    var T=D[id],html='';
    T.rows.forEach(function(r){
      if(g!=='all'&&r.g!==g)return;
      html+='<tr'+(r.d?' class="differ"':'')+'><td class="game">'+(g==='all'?esc(r.gl)+' · ':'')+esc(r.n)+'</td>';
      r.c.forEach(function(c){html+='<td class="pick'+(c[2]?' '+c[2]:'')+'">'+esc(c[0])+(c[1]?'<small>'+esc(c[1])+'</small>':'')+'</td>'});
      html+='<td>'+esc(r.f)+'</td></tr>';
    });
    document.getElementById(id+'-rows').innerHTML=html||'<tr><td colspan="9">Nothing logged for this pick.</td></tr>';
    document.getElementById(id+'-sum').textContent=T.sums[g]||'';
  }
  Object.keys(D).forEach(function(id){
    var sel=document.getElementById(id+'-sel');if(!sel)return;
    sel.innerHTML=D[id].opts.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'}).join('');
    sel.value=D[id].def;
    sel.addEventListener('change',function(){render(id,sel.value)});
    render(id,D[id].def);
  });
  var tabs=[].slice.call(document.querySelectorAll('.tabs button'));
  function show(key,push){
    var ok=tabs.some(function(b){return b.dataset.p===key});if(!ok)key=tabs[0].dataset.p;
    tabs.forEach(function(b){var on=b.dataset.p===key;b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1;document.getElementById('p-'+b.dataset.p).hidden=!on});
    if(push){try{history.replaceState(null,'','#'+key)}catch(e){try{location.hash=key}catch(e2){}}}
  }
  tabs.forEach(function(b,i){
    b.addEventListener('click',function(){show(b.dataset.p,true)});
    b.addEventListener('keydown',function(e){var j=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:null;if(j===null)return;j=(j+tabs.length)%tabs.length;tabs[j].focus();show(tabs[j].dataset.p,true)});
  });
  var h='';try{h=(location.hash||'').replace('#','').toLowerCase()}catch(e){}
  show(h||tabs[0].dataset.p,false);
  window.addEventListener('hashchange',function(){show((location.hash||'').replace('#','').toLowerCase(),false)});
})();
"""


def scoreboard(sports):
    """Every model's Edge score on one board, best first."""
    rows = [(m.get("score"), lab, m["name"]) for _, lab, models in sports for m in models]
    scored = sorted((r for r in rows if r[0] is not None), key=lambda r: -r[0])
    if not scored:
        return ""
    o = ['<section class="sub" aria-labelledby="h-board"><h3 id="h-board">Edge scores, every league</h3>',
         '<p class="note">One score from 1 to 100 for every model. 50 means it picks winners exactly as often as the simple baseline '
         '(the Vegas favorite, or the home team or average hitter where there are no odds) on the same games. '
         f'Each point of pick rate above the baseline adds 10 and each point below takes 10 away. Small samples are pulled toward 50, '
         f'and a model needs {GRADE_MIN_N}+ live picks to get a score.</p>',
         '<div class="tablewrap"><table class="board"><thead><tr><th>League</th><th>Model</th><th>Score</th><th class="barcol" style="width:40%"><span class="sr">Bar</span></th></tr></thead><tbody>']
    for sc, lab, name in scored:
        cls = "g-good" if sc >= 60 else "g-bad" if sc < 45 else "g-mixed"
        o.append(f'<tr><td>{esc(lab)}</td><td>{esc(name)}</td><td class="n">{sc}</td>'
                 f'<td class="barcol"><div class="bar {cls}"><i style="width:{sc}%"></i><b></b></div></td></tr>')
    rest = [name if name.startswith(lab) else f"{lab} {name}" for sc, lab, name in rows if sc is None]
    o.append('</tbody></table></div>')
    o.append('<p class="note">MLB hitters have no sportsbook line to beat, so they are measured against the average hitter. '
             'That bar is easier than Vegas, so their score runs high.</p>')
    if rest:
        o.append(f'<p class="note">No score yet (too few live picks, off-season, or not graded on picks): {esc(", ".join(rest))}.</p>')
    o.append('</section>')
    return "".join(o)


def render_model(m, data):
    o = [f'<section class="model" id="m-{m["id"]}" aria-labelledby="h-{m["id"]}">',
         f'<div class="model-h"><h2 id="h-{m["id"]}">{esc(m["name"])}</h2><span class="chips">{score_chip(m.get("score"))}{grade_chip(m["grade"])}</span></div>',
         f'<p class="verdict">{esc(m["verdict"])}</p>']
    how = m.get("how")
    if how:
        o.append('<div class="sub"><h3>How it makes a pick</h3>')
        if how.get("intro"):
            o.append(f'<p>{esc(how["intro"])}</p>')
        for group in (how.get("weights") or [], how.get("blend") or []):
            if not group:
                continue
            o.append('<div class="wts">')
            for w in group:
                bar = f'<div class="bar" aria-hidden="true"><i style="width:{max(2, w["bar"] * 100):.0f}%"></i></div>' if w.get("bar") is not None else ""
                o.append(f'<div class="wt"><div><b>{esc(w["label"])}</b>{bar}</div><p>{esc(w["plain"])}</p>'
                         f'<div class="v">{esc(w["value"])}{(" <small>" + esc(w["unit"]) + "</small>") if w.get("unit") and len(w["unit"]) < 8 else ""}</div></div>')
            o.append('</div>')
        if how.get("bar_note"):
            o.append(f'<p class="note">{esc(how["bar_note"])}</p>')
        if how.get("formula"):
            o.append(f'<pre class="formula">{esc(how["formula"])}</pre>')
        wk = how.get("walk")
        if wk:
            o.append(f'<p class="matchup">{esc(wk["title"])}</p><p class="subp">{esc(wk["sub"])}</p><ol class="steps">')
            for h_, p_, out, cls in wk["steps"]:
                li_cls = ' class="final"' if cls == "final" else ""
                o.append(f'<li{li_cls}><div><h4>{esc(h_)}</h4>{("<p>" + esc(p_) + "</p>") if p_ else ""}</div>'
                         f'<div class="out{(" " + cls) if cls in ("o", "v") else ""}">{esc(out)}</div></li>')
            o.append('</ol>')
            if wk.get("note"):
                o.append(f'<p class="note">{esc(wk["note"])}</p>')
        o.append('</div>')
    t = m.get("table")
    if t or m["grade"] == "Off-season":
        o.append('<div class="sub"><h3>What it would have predicted</h3>')
    if t:
        tid = t["id"]
        o.append(f'<p>{esc(t["intro"])}</p><div class="tally">')
        for v, lab, cls in t["tallies"]:
            o.append(f'<div class="t{(" " + cls) if cls else ""}"><b class="num">{esc(v)}</b><span>{esc(lab)}</span></div>')
        o.append('</div>')
        if t.get("callout"):
            o.append(f'<div class="callout"><p>{esc(t["callout"])}</p></div>')
        o.append(f'<div class="bar-row"><label for="{tid}-sel">{esc(t["sel"])}</label><select id="{tid}-sel"></select>'
                 f'<span id="{tid}-sum" class="key"></span></div>')
        o.append('<div class="tablewrap"><table><thead><tr>' + "".join(f"<th>{esc(c)}</th>" for c in t["cols"]) +
                 f'</tr></thead><tbody id="{tid}-rows"></tbody></table></div>')
        o.append(f'<p class="key"><i></i>{esc(t["key"])}</p>')
        data[tid] = {"opts": t["opts"], "def": t["def"], "rows": t["rows"], "sums": t["sums"]}
    elif m["grade"] == "Off-season":
        o.append(f'<p class="empty">{esc(m["verdict"])} Records start with the first graded pick.</p>')
    if t or m["grade"] == "Off-season":
        o.append('</div>')
    if m.get("chart"):
        o.append(m["chart"])
    ex = m.get("extra_table")
    if ex and ex["rows"]:
        o.append('<div class="tablewrap"><table><thead><tr>' + "".join(f"<th>{esc(h)}</th>" for h in ex["head"]) + '</tr></thead><tbody>' +
                 "".join("<tr>" + "".join(f'<td class="num">{esc(c)}</td>' if i else f'<td class="game">{esc(c)}</td>' for i, c in enumerate(r)) + "</tr>" for r in ex["rows"]) +
                 f'</tbody></table></div><p class="key">{esc(ex["caption"])}</p>')
    if m["grade"] != "Off-season" or m["good"] or m["bad"]:
        o.append('<div class="two">')
        for cls, title, items in (("good", "What's working", m["good"]), ("bad", "Where it falls short", m["bad"])):
            body = "<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>" if items else f'<p class="none">Nothing with at least {MIN_N} games to show yet.</p>'
            o.append(f'<div class="col {cls}"><h3>{title}</h3>{body}</div>')
        o.append('</div>')
    if m["why"]:
        o.append('<div class="why"><h3>Why we think ' + ("it falls short" if m["bad"] else "it does what it does") + '</h3><ol>')
        for tag, txt in m["why"]:
            o.append(f'<li><span class="tag">{esc(tag)}</span><br>{esc(txt)}</li>')
        o.append('</ol></div>')
    tr = m.get("tryouts")
    if tr or m.get("tryout_intro"):
        o.append(f'<div class="sub"><h3>Tryouts: {esc(m.get("tryout_title") or "the latest retrain")}</h3>')
        if m.get("tryout_intro"):
            o.append(f'<p>{esc(m["tryout_intro"])}</p>')
        if tr:
            o.append('<div class="tablewrap" style="max-height:none"><table><thead><tr>' + "".join(f"<th>{h}</th>" for h in tr["head"]) + '</tr></thead><tbody>')
            for r in tr["rows"]:
                cls = " ".join(c for c, on in (("live", r["live"]), ("best", r["best"])) if on)
                o.append(f'<tr{(" class=" + chr(34) + cls + chr(34)) if cls else ""}>' + "".join(f"<td>{c}</td>" for c in r["cells"]) + "</tr>")
            o.append('</tbody></table></div>')
            if tr.get("helps"):
                o.append('<ul class="helps">' + "".join(f"<li>{h}</li>" for h in tr["helps"]) + '</ul>')
            if tr.get("callout"):
                o.append(f'<div class="callout"><p>{tr["callout"]}</p></div>')
        o.append('</div>')
    if m.get("next"):
        o.append(f'<p class="try"><b>What we\'d try next:</b> {esc(m["next"])}</p>')
    if m.get("note"):
        o.append(f'<p class="note">{esc(m["note"])}</p>')
    o.append('</section>')
    return "\n".join(o)


def main():
    hist_nfl = (load_json(path(TRACK, "model_history.json"), {}) or {}).get("runs", [])
    nfl, nfl_info = build_game_model("nfl", path(TRACK, "predictions_log.csv"), path(NFL_MODELS, "fitted_coefficients.json"), hist_nfl, "nfl-games", "NFL games")
    cfb, cfb_info = build_game_model("cfb", path(TRACK, "cfb_predictions_log.csv"), path(NFL_MODELS, "fitted_cfb_coefficients.json"), hist_nfl, "cfb-games", "CFB games")
    sports = [
        ("nfl", "NFL", [nfl, build_td(), build_props()]),
        ("cfb", "CFB", [cfb, build_cfb_ratings()]),
        ("mlb", "MLB", [build_team("mlb-games"), build_hitters()]),
        ("nhl", "NHL", [build_team("nhl")]),
        ("soccer", "Soccer", [build_team("soccer")]),
        ("nba", "NBA", [build_team("nba")]),
        ("cbb", "CBB", [build_team("cbb")]),
    ]
    updated = max(DATA_DATES.values()) if DATA_DATES else dt.date.today().isoformat()
    data = {}
    out = ['<title>Model Room</title>',
           '<link rel="preconnect" href="https://fonts.googleapis.com">',
           '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..800&family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">',
           '<style>' + CSS + '</style>',
           f'<div class="top"><b>EDGE</b> &nbsp;·&nbsp; Model Room &nbsp;·&nbsp; updated {esc(nice_date(updated, year=True))}</div>',
           '<main class="wrap">',
           '<header><div class="eyebrow">Inside every model</div><h1>Model <i>room</i></h1>'
           '<p class="lede">Pick a sport. For each model you can see how it makes a pick, what it would have predicted in every live game, '
           'how it is doing against a simple baseline, our best explanation for where it falls short, and the versions that tried out at the last retrain.</p></header>',
           ]
    out.append(scoreboard(sports))
    out.append('<nav class="tabs" role="tablist" aria-label="Sport">')
    for i, (key, lab, _) in enumerate(sports):
        out.append(f'<button role="tab" id="tab-{key}" aria-controls="p-{key}" aria-selected="{"true" if i == 0 else "false"}" data-p="{key}">{lab}</button>')
    out.append('</nav>')
    for i, (key, lab, models) in enumerate(sports):
        out.append(f'<div id="p-{key}" class="panel" role="tabpanel" aria-labelledby="tab-{key}"{"" if i == 0 else " hidden"}>')
        out.append('<div class="summary">')
        for m in models:
            out.append(f'<a class="sum" href="#{key}" onclick="var e=document.getElementById(\'m-{m["id"]}\');if(e){{e.scrollIntoView({{behavior:\'smooth\'}});}}return false;">'
                       f'<span class="chips">{score_chip(m.get("score"))}{grade_chip(m["grade"])}</span><h3>{esc(m["name"])}</h3><p>{esc(m["summary"])}</p></a>')
        out.append('</div>')
        for m in models:
            out.append(render_model(m, data))
        out.append('</div>')
    dates = " · ".join(f"{k} {nice_date(v)}" for k, v in sorted(DATA_DATES.items()))
    out.append('<footer><p class="note"><b>Live picks only, never backtests.</b> Ties are left out. A bullet appears only when it has at least '
               f'{MIN_N} games behind it, and every grade needs at least {GRADE_MIN_N}. Grades: Working means at least 2 points better than the baseline '
               '(Vegas or sportsbook favorites, or always taking the home team when there are no odds), Falling short means 3 or more points worse, '
               'and Mixed is in between. Labels on each explanation show how sure we are: “Strong evidence” means the numbers show it directly, '
               'and “Our best guess” means it fits the numbers but hasn\'t been tested. Accuracy scores in the tryouts measure how far each chance '
               'was from what happened, so lower is better.</p>'
               f'<p class="note">Newest data: {esc(dates)}.</p></footer>')
    out.append('</main>')
    js_data = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    out.append(f'<script type="application/json" id="mr-data">{js_data}</script>')
    out.append('<script>' + JS + '</script>')
    page = "\n".join(out)
    # copy rules
    page = page.replace("—", ", ")
    assert "points over book" not in page.lower()
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(page)
    print(f"wrote {OUT} ({len(page.encode()):,} bytes)")
    for key, lab, models in sports:
        for m in models:
            print(f"  {lab:7s} {m['name']:20s} {m['grade']:14s} {m['verdict']}")
    if MISSING:
        print("missing:", ", ".join(sorted(set(MISSING))))


if __name__ == "__main__":
    main()
