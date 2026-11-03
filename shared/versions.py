"""
versions.py - the name of the model version making today's picks, for the
game pages. Every version is named for the day it was added, MMDDYYYY
(Anthony, 2026-11-02), with -2, -3 ... for a second or third added the same
day; model_room/versions.json holds them (model_room/number_versions.py).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _key(recipe):
    out = {}
    for k, v in (recipe or {}).items():
        if v is None or v is False or v == []:
            continue
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        out[k] = v
    return json.dumps(out, sort_keys=True)


def names(added):
    seen, out = {}, []
    for day in added:
        parts = (day or "").split("-")
        code = f"{parts[1]}{parts[2]}{parts[0]}" if len(parts) == 3 else "new"
        seen[code] = seen.get(code, 0) + 1
        out.append(code if seen[code] == 1 else f"{code}-{seen[code]}")
    return out


def live_name(model_id, weights_path):
    """The live version's name for a model (a versions.json id), from the
    recipe saved in its weights file; None if either is missing."""
    try:
        with open(os.path.join(ROOT, "model_room", "versions.json")) as f:
            reg = json.load(f).get(model_id) or {}
        with open(weights_path) as f:
            recipe = json.load(f).get("recipe")
    except (OSError, ValueError):
        return None
    keys = [_key(r) for r in reg.get("versions", [])]
    k = _key(recipe)
    if not recipe or k not in keys or len(reg.get("added", [])) < len(keys):
        return None
    return names(reg["added"])[keys.index(k)]
