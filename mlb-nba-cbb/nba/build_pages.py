"""
build_pages.py - generates the NBA Edge pages into dist/nba/.

Everything is built by team_pages.TeamSite, whose defaults are NBA Edge's; see
that file for the pages it writes.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from team_pages import TeamSite  # noqa: E402


class NBASite(TeamSite):
    pass


if __name__ == "__main__":
    NBASite().build()
