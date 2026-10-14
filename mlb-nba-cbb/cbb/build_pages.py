"""
build_pages.py - generates the CBB Edge (men's college basketball) pages into
dist/cbb/.

Built by team_pages.TeamSite like NBA Edge; this file holds what's different
about college basketball: KenPom-style ratings (cbb/ratings.json) on a Ratings
tab and a Top 25 on Home, projected scores, AP ranks, the top five picks a day,
and no ESPN scoreboard feed.
"""

import os
import sys
from html import escape

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from build_site import DASH, card  # noqa: E402
from team_pages import TeamSite, day_label, load_json  # noqa: E402


def logo(team_id):
    return (f'<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/ncaa/500/{escape(str(team_id))}.png" '
            f'alt="" loading="lazy" onerror="this.style.display=\'none\'">')


def as_of(ratings):
    if ratings.get("final"):
        s = ratings["season"]
        return f"Final {s - 1}-{str(s)[2:]} ratings, through {day_label(ratings['date'])}. The new season starts from these"
    return f"As of {day_label(ratings['date'])}"


def ratings_preview(ratings, n=25):
    teams = (ratings or {}).get("teams", [])[:n]
    if not teams:
        return ""
    return card(f"Top {len(teams)} by Adjusted Efficiency",
                f"{as_of(ratings)}. Every team and the four factors are on the Ratings tab.",
                ratings_table(teams, compact=True))


# ── Ratings ──────────────────────────────────────────────────────────────────
def ff(v):
    return f"{100 * v:.1f}"


def ratings_table(teams, compact=False):
    def cell(key, value, text):
        return f'<td class="num" data-key="{key}" data-value="{value}">{text}</td>'

    rows = ""
    for t in teams:
        o, d = t["off"], t["def"]
        row = (cell("rank", t["rank"], t["rank"])
               + f'<td data-key="team" data-value="{escape(t["name"])}"><span class="matchup-team">{logo(t["id"])}'
                 f'{escape(t["name"])}</span> <span class="faint">{t["record"]}</span></td>'
               + cell("em", t["adj_em"], f"{t['adj_em']:+.1f}")
               + cell("o", t["adj_o"], f"{t['adj_o']:.1f}") + cell("d", t["adj_d"], f"{t['adj_d']:.1f}")
               + cell("t", t["adj_t"], f"{t['adj_t']:.1f}"))
        if not compact:
            row += (cell("sos", t["sos"], f"{t['sos']:+.1f}")
                    + cell("efg_o", o["efg"], ff(o["efg"])) + cell("efg_d", d["efg"], ff(d["efg"]))
                    + cell("tov_o", o["tov"], ff(o["tov"])) + cell("tov_d", d["tov"], ff(d["tov"]))
                    + cell("orb_o", o["orb"], ff(o["orb"])) + cell("orb_d", d["orb"], ff(d["orb"]))
                    + cell("ftr_o", o["ftr"], ff(o["ftr"])) + cell("ftr_d", d["ftr"], ff(d["ftr"])))
        rows += f"<tr>{row}</tr>"

    def th(key, label, title="", cls="num"):
        t = f' title="{title}"' if title else ""
        return f'<th data-sort-key="{key}" class="{cls}"{t}>{label}</th>'

    head = (th("rank", "Rk") + th("team", "Team", cls="")
            + th("em", "AdjEM", "Points per 100 possessions better than an average team")
            + th("o", "AdjO", "Points scored per 100 possessions, adjusted for opponents and venue")
            + th("d", "AdjD", "Points allowed per 100 possessions, adjusted (lower is better)")
            + th("t", "AdjT", "Possessions per game against an average opponent"))
    if not compact:
        head += (th("sos", "SOS", "Average AdjEM of opponents played")
                 + th("efg_o", "eFG% O") + th("efg_d", "eFG% D") + th("tov_o", "TO% O") + th("tov_d", "TO% D")
                 + th("orb_o", "OR% O") + th("orb_d", "OR% D") + th("ftr_o", "FTR O") + th("ftr_d", "FTR D"))
    return f"""<table class="data ratings-table" data-sortable>
      <thead><tr>{head}</tr></thead>
      <tbody>{rows}</tbody>
    </table>"""


def build_ratings(ratings, page_shell):
    teams = (ratings or {}).get("teams", [])
    if not teams:
        body = card("Ratings", "", '<div class="empty-state">Ratings appear once the season has games. Every team '
                    'starts from part of last season\'s rating.</div>')
        return page_shell("Ratings", "ratings.html", body)
    avg = ratings.get("average", {})
    note = f"""<div class="table-footnote">Computed from every Division I box score this season, the way KenPom
      does it. Possessions = FGA - offensive rebounds + turnovers + 0.475 x FTA. AdjO and AdjD are points scored and
      allowed per 100 possessions, adjusted for each opponent's strength and for home court. AdjEM is the gap
      between them: how many points per 100 possessions a team would beat an average team by. AdjT is possessions
      against an average opponent. An average offense scores {avg.get('eff', DASH)} per 100 possessions at a tempo
      of {avg.get('tempo', DASH)}, and home court is worth about {avg.get('home_court', DASH)} points. The four
      factors are effective FG%, turnover rate, offensive rebound rate and free throw rate (FTA per FGA), for the
      team's offense (O) and what its defense allows (D), not adjusted for opponents. SOS is the average AdjEM of
      the opponents played. Early in the season every team
      starts from part of last season's rating. Select a column header to sort.</div>"""
    body = card("Ratings", f"All {len(teams)} Division I teams, best first. {as_of(ratings)}.",
                ratings_table(teams) + note)
    return page_shell("Ratings", "ratings.html", body)


class CBBSite(TeamSite):
    sport = "CBB"
    slug = "cbb"
    tagline = ("Who wins every Division I men's basketball game and by how much, from KenPom-style team ratings "
               "graded against every final score.")
    top_n = 5
    tabs = [("index.html", "Home"), ("ratings.html", "Ratings"), ("history.html", "History"),
            ("accuracy.html", "Accuracy"), ("model.html", "Model")]
    sources = "Scores, box scores and moneyline prices via ESPN. Not affiliated with KenPom."
    has_games_feed = True
    has_schedule = False  # not on the shared Schedule tab yet
    board_note = ("Scores are our projections, and the odds are our pick's moneyline. Value means our chance beats the "
                  "odds by 6 points or more. Tap a game for more.")
    no_games = "No Division I games today."
    preseason = "The season tips off in early November"
    summary_empty = "No college basketball picks yet. They start on opening night in early November."
    postseason = "the postseason"
    retrain_after = 300
    looks_at = ""
    factor_labels = {
        "home_court": ("Home court", "points for the home team"),
        "em": ("Adjusted efficiency margin", "per point of margin projected from AdjEM and tempo"),
        "elo": ("Team rating (Elo) gap", "points per 100 rating points"),
        "efg": ("Shooting matchup (eFG%)", "points per percentage point of edge"),
        "tov": ("Turnover matchup", "points per percentage point of edge"),
        "orb": ("Offensive rebounding matchup", "points per percentage point of edge"),
        "ftr": ("Free throw rate matchup", "points per percentage point of edge"),
        "recent": ("Last 5 games form gap", "points per point of differential"),
        "rest": ("Extra rest", "points per extra day off vs. the opponent"),
    }

    def logo_url(self, p, side):
        return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{p[f'{side}_id']}.png"

    def team_label(self, p, side):
        """'#4 Duke' style: AP rank when ranked."""
        rank = p.get(f"{side}_rank")
        return (f"#{rank} " if rank else "") + p.get(f"{side}_name", p[side])

    def game_notes(self, p):
        notes = []
        if p.get("note"):
            notes.append(p["note"])
        ranks = [f"{p[s]} No. {p[f'{s}_em_rank']}" for s in ("away", "home") if p.get(f"{s}_em_rank")]
        if ranks:
            notes.append("AdjEM rank: " + ", ".join(ranks))
        return "; ".join(notes)

    def game_facts(self, p):
        proj = p.get("proj") or {}
        facts = [("Projected score", f"{escape(p['away'])} {proj['away']}, {escape(p['home'])} {proj['home']}"
                  if proj else f"{escape(p['pick'])} by {p['margin']:.1f}",
                  f"{p['pick']} by {p['margin']:.1f}" + (f", {proj['tempo']} possessions" if proj.get("tempo") else ""))]
        notes = self.game_notes(p)
        if notes:
            facts.append(("Notes", escape(notes), ""))
        return facts

    def recipe_setup(self, recipe):
        hl, carry, years = recipe.get("half_life"), recipe.get("carry", 0.6), recipe.get("years", 3)
        return [
            ("Learns from:", f"the last {years} seasons of Division I games"),
            ("Team ratings:", f"recent games count more; a game's weight halves every {hl} days" if hl
             else "every game this season counts the same"),
            ("Over the summer:", f"each team starts from {carry:.0%} of last season's rating, which fades as games come in"),
        ]

    def backtest_top(self, bt):
        return bt["top"], bt["top"]["n"]

    def index_extra(self):
        return ratings_preview(self.ratings)

    def extra_pages(self):
        return {"ratings.html": build_ratings(self.ratings, self.page_shell)}

    def build(self):
        self.ratings = load_json(os.path.join(self.here, "ratings.json"), {})
        super().build()


if __name__ == "__main__":
    CBBSite().build()
