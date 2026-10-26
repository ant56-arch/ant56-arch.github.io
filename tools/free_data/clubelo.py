"""ClubElo rating history only (see pull.py)."""
import os
import pull

os.makedirs(pull.OUT, exist_ok=True)
pull.clubelo()
