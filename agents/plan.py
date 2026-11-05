#!/usr/bin/env python3
"""plan.py - which league agents run today.

Prints the job matrix as JSON for league-agents.yml. A league whose season is
over (shared/seasons.py idle) is skipped so it costs nothing. The Model Room
agent always runs. Set AGENTS (a comma list such as "nba,modelroom", or "all")
to pick by hand, which also runs a league that is out of season.

  python3 agents/plan.py
"""

import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# slug, label, seasons.py league name (None = always runs), prompt file
LEAGUES = [
    ("nfl", "NFL", "NFL", "nfl.md"),
    ("cfb", "College football", "CFB", "cfb.md"),
    ("mlb", "MLB", "MLB", "mlb.md"),
    ("nba", "NBA", "NBA", "nba.md"),
    ("nhl", "NHL", "NHL", "nhl.md"),
    ("cbb", "College basketball", "CBB", "cbb.md"),
    ("soccer", "Soccer", "Soccer", "soccer.md"),
    ("modelroom", "Model Room", None, "model-room.md"),
]


def idle(league):
    out = subprocess.run(
        [sys.executable, os.path.join(ROOT, "shared", "seasons.py"), "idle", league],
        capture_output=True, text=True, cwd=ROOT,
    ).stdout.strip()
    return out == "yes"


def main():
    chosen = {s.strip().lower() for s in os.environ.get("AGENTS", "all").split(",") if s.strip()}
    manual = bool(chosen) and "all" not in chosen
    include = []
    for slug, label, league, prompt in LEAGUES:
        if manual:
            if slug not in chosen:
                continue
        elif league and idle(league):
            print(f"skip {slug}: season over", file=sys.stderr)
            continue
        include.append({"slug": slug, "label": label, "prompt": prompt})
    print(json.dumps({"include": include}))


if __name__ == "__main__":
    main()
