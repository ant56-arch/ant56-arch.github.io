"""
bracket_page.py - CBB Edge's Bracket tab (March Madness), drawn from the
newest cbb/brackets/<season>.json that bracket.py wrote.
"""

import glob
import json
import os
from datetime import date
from html import escape

from bracket import POINTS, ROUND_NAMES
from build_site import card

HERE = os.path.dirname(os.path.abspath(__file__))
ODDS_COLS = ["Round of 32", "Sweet 16", "Elite 8", "Final Four", "Title game", "Champion"]


def latest():
    files = sorted(glob.glob(os.path.join(HERE, "brackets", "*.json")))
    if not files:
        return None
    with open(files[-1]) as f:
        return json.load(f)


def season_label(s):
    return f"{s - 1}-{str(s)[2:]}"


def day_text(iso):
    d = date.fromisoformat(iso[:10])
    return f"{d:%A, %B} {d.day}"


def logo(team_id):
    return (f'<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/ncaa/500/{escape(str(team_id))}.png" '
            f'alt="" loading="lazy" onerror="this.style.display=\'none\'">')


def pct(p):
    if p is None:
        return "&ndash;"
    if p >= 0.995:
        return "&gt;99%" if p < 1 else "100%"
    if p < 0.005:
        return "&lt;1%" if p > 0 else "&ndash;"
    return f"{100 * p:.0f}%"


def build_bracket(b, page_shell, this_season):
    if not b:
        body = card("March Madness", "", '<div class="empty-state">The bracket fills in here by itself on '
                         'Selection Sunday in mid-March.</div>')
        return page_shell("Bracket", "bracket.html", body)
    T = b["teams"]
    games = b["games"]
    by_key = {g["key"]: g for g in games}
    losers = _losers(games)

    def name(t):
        return escape(T[t]["name"]) if t in T else "TBD"

    # ── the lead panel ──
    s = b["season"]
    champ = by_key.get("6-FF-0", {}).get("pick")
    sc = b["score"]
    if b["season"] < this_season:
        lead = (f"The {season_label(this_season)} bracket fills in here by itself on Selection Sunday in mid-March, "
                f"straight from ESPN. Until then, this is last season's tournament with the bracket our model "
                f"would have filled out the morning of the First Four. The model used is today's, which learned "
                f"partly from that season, so read it as a demo, not a track record.")
    elif b["status"] == "pre":
        lead = (f"The field is set. Our bracket below takes the model's favorite in every game, and it locks when "
                f"the First Four tips off on {day_text(b['first_day'])}. Until then it updates with each run.")
    elif b["status"] == "live":
        lead = ("Our bracket locked when the First Four tipped off and is graded like a pool: 10, 20, 40, 80, 160 "
                "and 320 points for a right pick in each round. The title chances update after every game.")
    else:
        lead = ("Final. Our bracket was locked when the First Four tipped off and graded like a pool: 10, 20, 40, "
                "80, 160 and 320 points for a right pick in each round.")
    winner = b.get("champion")
    side = "".join(
        f'<div class="bk-round-score"><b>{r["right"]}-{r["wrong"]}</b><span>{ROUND_NAMES[int(k)]}</span></div>'
        for k, r in sc["rounds"].items() if r["right"] + r["wrong"])
    band = f"""<section class="card record-card"><div class="record-band">
      <div><div class="rb-eyebrow">{season_label(s)} March Madness &middot; our bracket</div>
        <div class="rb-num">{sc['points']}<small> of {sum(POINTS[r] * (32 >> (r - 1)) for r in POINTS)} points</small></div>
        <div class="rb-since">Our champion: {logo(champ) if champ else ''}<b>{name(champ) if champ else 'TBD'}</b>"""
    band += (f" &middot; Champion: {logo(winner)}<b>{name(winner)}</b>" if winner else
             f" &middot; Still possible: {sc['max']} points")
    band += f"""</div><p class="bk-lead">{lead}</p></div>
      <div class="rb-side bk-rounds">{side}</div></div></section>"""

    # ── title chances ──
    live = b.get("live_odds")
    odds = live or b["pre_odds"]
    rows = ""
    for t, v in sorted(odds.items(), key=lambda x: (-x[1][5], -x[1][4], -x[1][3], T[x[0]]["seed"])):
        info = T[t]
        gone = t in losers
        out_tag = ' <span class="faint">out</span>' if gone and not winner else ""
        cells = "".join(f'<td class="num" data-key="r{i}" data-value="{p}">{pct(p)}</td>' for i, p in enumerate(v))
        pre = b["pre_odds"].get(t, [0] * 6)[5]
        pre_cell = f'<td class="num faint" data-key="pre" data-value="{pre}">{pct(pre)}</td>' if live else ""
        rows += (f'<tr class="{"bk-out" if gone else ""}"><td class="num" data-key="seed" data-value="{info["seed"]}">{info["seed"]}</td>'
                 f'<td data-key="team" data-value="{escape(info["name"])}"><span class="matchup-team">{logo(t)}{escape(info["name"])}'
                 f'</span>{out_tag}</td>'
                 f'<td data-key="region" data-value="{escape(info["region"])}">{escape(info["region"])}</td>{cells}{pre_cell}</tr>')
    head = ('<th data-sort-key="seed" class="num">Seed</th><th data-sort-key="team">Team</th>'
            '<th data-sort-key="region">Region</th>'
            + "".join(f'<th class="num" data-sort-key="r{i}">{c}</th>' for i, c in enumerate(ODDS_COLS))
            + ('<th class="num" data-sort-key="pre" title="Chance to win it all before the First Four">Before</th>'
               if live else ""))
    odds_sub = ("Each team's chance to reach every round, from playing out every possible matchup with our model "
                "on a neutral court. " + ("They update after every game; Before is the title chance when the "
                                          "bracket locked." if live else
                                          "As of the morning of the First Four."))
    odds_card = card("Title chances", odds_sub, f"""<table class="data" data-sortable>
      <thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>""")

    # ── the bracket ──
    def team_line(g, t):
        if not t:
            return '<div class="bk-team bk-tbd"><span class="bk-seed"></span><span class="bk-name">TBD</span></div>'
        info = T[t]
        cls = ["bk-team"]
        if g["winner"] == t:
            cls.append("bk-won")
        elif g["winner"]:
            cls.append("bk-lost")
        mark = ""
        if g["pick"] == t:
            cls.append("bk-picked")
            mark = '<span class="bk-pick" title="Our pick">&#9679;</span>'
        sc = (g.get("score") or {}).get(t)
        return (f'<div class="{" ".join(cls)}"><span class="bk-seed">{info["seed"]}</span>{logo(t)}'
                f'<span class="bk-name">{escape(info["name"])}</span>{mark}'
                f'<span class="bk-score">{sc if sc is not None else ""}</span></div>')

    def game_box(key):
        g = by_key.get(key)
        if not g:
            return '<div class="bk-game"></div>'
        lines = "".join(team_line(g, t) for t in g["teams"])
        foot = ""
        if g["pick"] and g["pick"] not in g["teams"]:
            gone = g["pick"] in losers
            foot = (f'<div class="bk-foot{" bk-busted" if gone else ""}">Our pick: {name(g["pick"])}'
                    f'{" (out)" if gone else ""}</div>')
        elif g.get("correct") is not None:
            foot = f'<div class="bk-foot {"bk-right" if g["correct"] else "bk-wrong"}">' \
                   f'{"Right" if g["correct"] else "Wrong"} &middot; we had {g["pick_prob"]:.0f}%</div>'
        elif g["pick"] and g["pick_prob"]:
            foot = f'<div class="bk-foot">Our pick {name(g["pick"])}, {g["pick_prob"]:.0f}%</div>'
        cls = "bk-game" + (" bk-done" if g["winner"] else "")
        return f'<div class="{cls}">{lines}{foot}</div>'

    regions_html = ""
    for region in b["regions"]:
        cols = ""
        for rnd in (1, 2, 3, 4):
            boxes = "".join(game_box(f"{rnd}-{region}-{i}") for i in range(8 >> (rnd - 1)))
            cols += f'<div class="bk-col"><div class="bk-col-head">{ROUND_NAMES[rnd]}</div><div class="bk-col-games">{boxes}</div></div>'
        regions_html += card(f"{escape(region)} Region", "",
                                  f'<div class="bk-scroll"><div class="bk-region">{cols}</div></div>')

    a, c = b["semis"]
    ff_note = "" if b.get("semis_known") else (
        '<p class="faint">Which regions meet in the Final Four is our best guess until ESPN lists the semifinals: '
        'the committee pairs the best No. 1 seed with the fourth best, and we rank the No. 1 seeds by our ratings.</p>')
    final_four = card("Final Four", f"{escape(a[0])} vs {escape(a[1])}, {escape(c[0])} vs {escape(c[1])}", f"""
      {ff_note}<div class="bk-scroll"><div class="bk-region bk-ff">
        <div class="bk-col"><div class="bk-col-head">Final Four</div><div class="bk-col-games">{game_box('5-FF-0')}{game_box('5-FF-1')}</div></div>
        <div class="bk-col"><div class="bk-col-head">Championship</div><div class="bk-col-games">{game_box('6-FF-0')}</div></div>
      </div></div>""")

    ff_games = [g for g in games if g["round"] == 0]
    first_four = ""
    if ff_games:
        first_four = card("First Four", "Their winners take the spot shown in the region.",
                               '<div class="bk-ff-row">' + "".join(
                                   f'<div><div class="bk-col-head">{escape(g["region"])} &middot; {T[g["teams"][0]]["seed"]} seed</div>'
                                   f'{game_box(g["key"])}</div>' for g in ff_games) + "</div>")

    legend = ('<p class="table-footnote">&#9679; marks our pick in each game. A game\'s line says whether our pick '
              'was right and how sure the model was. Where our pick was knocked out earlier, it says so. '
              'Tap or scroll sideways to see each whole region.</p>')
    body = band + odds_card + final_four + first_four + regions_html + legend
    return page_shell("Bracket", "bracket.html", body)


def _losers(games):
    out = set()
    for g in games:
        if g["winner"]:
            out.update(t for t in g["teams"] if t and t != g["winner"])
    return out

