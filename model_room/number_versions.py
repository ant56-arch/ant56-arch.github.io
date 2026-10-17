"""
number_versions.py - gives every tryout version of every model a permanent
number (#1, #2, ...), so the Model Room can say "#14 took over" and a new
version is easy to spot. Numbers never change and are never reused: old
versions keep theirs, and a new recipe gets the next free number.

Writes model_room/versions.json:
  {model id: {"versions": [recipe, ...],   # recipe i is version #i+1
              "current": [numbers the retrain tries now]}}

Run it after changing any RECIPES list (it needs each model's own Python
packages, so run it where the models run):
  python3 model_room/number_versions.py .
"""

import json
import os
import subprocess
import sys

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else "."
OUT = os.path.join(ROOT, "model_room", "versions.json")

# model id -> (file holding RECIPES, retrain log, sport filter in that log)
MODELS = {
    "nfl-games": ("nfl-cfb/src/fit_model.py", "nfl-cfb/data/tracking/model_history.json", "nfl"),
    "cfb-games": ("nfl-cfb/src/fit_cfb_model.py", "nfl-cfb/data/tracking/model_history.json", "cfb"),
    "mlb-hitters": ("mlb-nba-cbb/research/train_model.py", "mlb-nba-cbb/model_history.json", None),
    "mlb-games": ("mlb-nba-cbb/teams/research/train.py", "mlb-nba-cbb/teams/model_history.json", None),
    "nhl": ("mlb-nba-cbb/nhl/research/train.py", "mlb-nba-cbb/nhl/model_history.json", None),
    "nba": ("mlb-nba-cbb/nba/research/train.py", "mlb-nba-cbb/nba/model_history.json", None),
    "cbb": ("mlb-nba-cbb/cbb/research/train.py", "mlb-nba-cbb/cbb/model_history.json", None),
    "soccer": ("mlb-nba-cbb/soccer/research/train.py", "mlb-nba-cbb/soccer/model_history.json", None),
}

READ_RECIPES = """
import importlib.util, json, os, sys
p = sys.argv[1]
sys.path.insert(0, os.path.dirname(p))
spec = importlib.util.spec_from_file_location("recipes_src", p)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps(mod.RECIPES))
"""


def key(recipe):
    """Same settings -> same key. Settings that are off (None, empty, False)
    are dropped and whole-number floats written as ints, so an older log
    entry and today's RECIPES line up."""
    out = {}
    for k, v in recipe.items():
        if v is None or v is False or v == []:
            continue
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        out[k] = v
    return json.dumps(out, sort_keys=True)


def main():
    old = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f)
    out = {}
    for mid, (src, log, sport) in MODELS.items():
        versions = list(old.get(mid, {}).get("versions", []))
        keys = [key(r) for r in versions]

        def add(r):
            if key(r) not in keys:
                versions.append(r)
                keys.append(key(r))

        log_path = os.path.join(ROOT, log)
        runs = json.load(open(log_path)).get("runs", []) if os.path.exists(log_path) else []
        for run in runs:
            if sport is None or run.get("sport") == sport:
                for c in run.get("candidates", []):
                    add(c["recipe"])
        res = subprocess.run([sys.executable, "-c", READ_RECIPES, os.path.join(ROOT, src)],
                             capture_output=True, text=True, cwd=os.path.dirname(os.path.join(ROOT, src)))
        if res.returncode != 0:
            sys.exit(f"Couldn't read RECIPES from {src}:\n{res.stderr[-2000:]}")
        current = json.loads(res.stdout.strip().splitlines()[-1])
        for r in current:
            add(r)
        out[mid] = {"versions": versions, "current": [keys.index(key(r)) + 1 for r in current]}
        print(f"{mid:10} {len(versions):3} numbered, trying #{', #'.join(map(str, out[mid]['current']))}")
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
