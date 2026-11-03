"""
number_versions.py - gives every tryout version of every model a permanent
number (#1, #2, ...), so the Model Room can say "#14 took over" and a new
version is easy to spot. Numbers never change and are never reused: old
versions keep theirs, and a new recipe gets the next free number.

Every version is also named for the day it was added (Anthony, 2026-11-02),
written MMDDYYYY: "11022026", with "-V2", "-V3" for a second or third version
of the same model added that day (version_names()).

Writes model_room/versions.json:
  {model id: {"versions": [recipe, ...],   # recipe i is version #i+1
              "added": [YYYY-MM-DD, ...],  # the day each was added
              "current": [numbers the retrain tries now]}}

Run it after changing any RECIPES list (it needs each model's own Python
packages, so run it where the models run):
  python3 model_room/number_versions.py .
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

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


def version_names(added):
    """MMDDYYYY for each version's added day, in order, with -V2, -V3 ... on a
    second or third version added the same day."""
    seen, out = {}, []
    for day in added:
        y, m, d = (day or "0000-00-00").split("-")
        code = f"{m}{d}{y}"
        seen[code] = seen.get(code, 0) + 1
        out.append(code if seen[code] == 1 else f"{code}-V{seen[code]}")
    return out


def main():
    old = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f)
    out = {}
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    for mid, (src, log, sport) in MODELS.items():
        versions = list(old.get(mid, {}).get("versions", []))
        added = list(old.get(mid, {}).get("added", []))
        keys = [key(r) for r in versions]
        added += [today] * (len(versions) - len(added))

        def add(r, day=None):
            if key(r) not in keys:
                versions.append(r)
                keys.append(key(r))
                added.append(day or today)

        log_path = os.path.join(ROOT, log)
        runs = json.load(open(log_path)).get("runs", []) if os.path.exists(log_path) else []
        for run in runs:
            if sport is None or run.get("sport") == sport:
                for c in run.get("candidates", []):
                    add(c["recipe"], (run.get("run_at") or "")[:10] or None)
        res = subprocess.run([sys.executable, "-c", READ_RECIPES, os.path.join(ROOT, src)],
                             capture_output=True, text=True, cwd=os.path.dirname(os.path.join(ROOT, src)))
        if res.returncode != 0:
            sys.exit(f"Couldn't read RECIPES from {src}:\n{res.stderr[-2000:]}")
        current = json.loads(res.stdout.strip().splitlines()[-1])
        for r in current:
            add(r)
        out[mid] = {"versions": versions, "added": added, "current": [keys.index(key(r)) + 1 for r in current]}
        names = version_names(added)
        print(f"{mid:10} {len(versions):3} named, trying {', '.join(names[n - 1] for n in out[mid]['current'])}")
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
