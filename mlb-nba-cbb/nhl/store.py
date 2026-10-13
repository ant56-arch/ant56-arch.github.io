"""
store.py - where NHL Edge keeps game results and box scores: nhl/data/seasons/ and
nhl/data/days/, kept by the shared game_store.py (the same for NBA, NHL and CBB).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.dirname(HERE))
from game_store import GameStore  # noqa: E402

_store = GameStore(HERE)
load_all = _store.load_all
save_season = _store.save_season
save_day = _store.save_day
roll_up_days = _store.roll_up_days
