"""
store.py - where the MLB team model keeps final games (with starting
pitchers from the box score, see statsapi.stored): teams/data/seasons/ and
teams/data/days/, kept by the shared game_store.py without box scores, so
each file holds {"games": [...]}.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
sys.path.append(os.path.dirname(HERE))
from game_store import GameStore  # noqa: E402

_store = GameStore(HERE, box=False)
load_all = _store.load_all
save_season = _store.save_season
save_day = _store.save_day
roll_up_days = _store.roll_up_days
