"""
build_pages.py - generates the NHL Edge pages into dist/nhl/.

Built by team_pages.TeamSite like NBA Edge; this file holds what's different
about hockey: goals instead of points, rest instead of injuries, and the
model's own factors.
"""

import os
import sys
from html import escape

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from team_pages import TeamSite  # noqa: E402


class NHLSite(TeamSite):
    sport = "NHL"
    slug = "nhl"
    tagline = "Who wins every NHL game tonight and how likely it is, from a model graded against every final score."
    strong = 65
    favicon_letter = "M8 23V9h3.4v5.4h9.2V9H24v14h-3.4v-5.6h-9.2V23z"
    sources = "Scores and moneyline prices via ESPN."
    board_note = ("The percentage by each team is its chance to win, and the odds are our pick's moneyline. Value means "
                  "our chance beats the odds by 6 points or more. Tap a game for rest.")
    no_games = "No NHL games today."
    preseason = "The season opens in early October"
    summary_empty = "No NHL picks yet. They start on opening night."
    unit, unit_short = "goals", "goals"
    postseason = "the playoffs"
    looks_at = ""
    factor_labels = {
        "home_ice": ("Home ice", "goals for the home team"),
        "elo": ("Team rating (Elo) gap", "goals per 100 rating points"),
        "net": ("Season goal differential gap", "goals per goal of differential per game"),
        "recent": ("Last 10 games form gap", "goals per goal of differential per game"),
        "rest": ("Extra rest", "goals per extra day off vs. the opponent"),
        "b2b_home": ("Home team on a back-to-back", ""),
        "b2b_away": ("Away team on a back-to-back", ""),
    }

    def game_notes(self, p):
        notes = []
        rest = p.get("rest", {})
        b2b = [p[s] for s in ("away", "home") if rest.get(s) == 0]
        if b2b:
            notes.append(f"{' and '.join(b2b)} on a back-to-back")
        rested = [f"{p[s]} {rest[s]}{'+' if rest[s] >= 3 else ''} days off" for s in ("away", "home")
                  if rest.get(s) is not None and rest.get(s) >= 1]
        if rested and not b2b:
            notes.append(", ".join(rested).replace(" 1 days", " 1 day"))
        return "; ".join(notes)

    def game_facts(self, p):
        notes = self.game_notes(p)
        return [("Projected", f"{escape(p['pick'])} by {p['margin']:.1f} goals", "from the model's ratings"),
                ("Rest", escape(notes) or '<span class="faint">Nothing notable</span>', "")]

    def recipe_setup(self, recipe):
        k, carry, years = recipe.get("elo_k", 8), recipe.get("elo_carry", 0.7), recipe.get("years", 3)
        speed = "steady" if k <= 5 else "medium" if k <= 8 else "fast"
        return [
            ("Learns from:", f"the last {years} seasons of games"),
            ("Team ratings:", f"{speed} - a typical result moves a team's Elo rating by about {k} points"),
            ("Over the summer:", f"keeps {carry:.0%} of each team's rating; the rest resets toward average"),
        ]


if __name__ == "__main__":
    NHLSite().build()
