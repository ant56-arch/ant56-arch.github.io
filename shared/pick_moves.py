"""
pick_moves.py
How each game's pick moved before kickoff (Anthony, 2026-11-01: "a way to see
how each game was picked throughout the week"). Every pick run overwrites a
game's row with the latest pick, so this keeps a small side file per sport:
one entry each time the pick, our chance (to the whole percent) or the Vegas
line changes, until the game starts and the pick locks.

  {game key: {"date": "YYYY-MM-DD", "moves": [{"t": UTC ISO, "pick", "prob"
   (percent), "vegas", "ours"}, ...]}}

NFL and CFB keep "vegas" / "ours" as the home team's points favored by (the
builder writes them as "NYJ -1.5"), their pick as the tracking log's team name,
and key games like their game pages (season-week-away-home). The other sports
key by ESPN / MLB game id and keep display text.

Run from the sport's folder after its pick steps, before the commit:
  python ../shared/pick_moves.py football     (nfl-cfb/)
  python ../shared/pick_moves.py daily        (mlb-nba-cbb/)
Backfill a file from the git history of its picks (once):
  python ../shared/pick_moves.py football --backfill 2026-09-01
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

KEEP_DAYS = 75  # games older than this drop off the file
ET = ZoneInfo("America/New_York")  # pick dates are US Eastern

FOOTBALL = {"data/tracking/predictions_log.csv": "data/tracking/pick_moves.json",
            "data/tracking/cfb_predictions_log.csv": "data/tracking/cfb_pick_moves.json"}
DAILY = {"teams/picks_history.json": "teams/pick_moves.json", "nba/picks_history.json": "nba/pick_moves.json",
         "nhl/picks_history.json": "nhl/pick_moves.json", "cbb/picks_history.json": "cbb/pick_moves.json",
         "soccer/picks_history.json": "soccer/pick_moves.json"}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(path, data):
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")


def _same(a, b):
    return (a.get("pick") == b.get("pick") and round(a.get("prob") or 0) == round(b.get("prob") or 0)
            and a.get("vegas") == b.get("vegas"))


def add(data, key, day, entry):
    """Append entry to key's moves when it differs from the last one."""
    g = data.setdefault(key, {"date": day, "moves": []})
    g["date"] = day or g.get("date")
    moves = g["moves"]
    if moves and (_same(moves[-1], entry) or entry["t"] <= moves[-1]["t"]):
        return False
    moves.append(entry)
    return True


def prune(data, today=None):
    cut = ((today or datetime.now(ET).date()) - timedelta(days=KEEP_DAYS)).isoformat()
    for k in [k for k, g in data.items() if (g.get("date") or "9999") < cut]:
        del data[k]


# ── NFL and CFB: the tracking logs ──────────────────────────────────────────
def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x != x else x


def football_key(r):
    """The game page id build_site.py gives the game (season-week-away-home)."""
    return re.sub(r"[^a-z0-9]+", "-", f"{int(float(r['season']))}-{int(float(r['week']))}-{r['away_team']}-"
                                      f"{r['home_team']}".lower()).strip("-")


def _present(v):
    """A tracking-log value that's there: not None, NaN or a blank CSV cell."""
    return v is not None and v == v and v != ""


# The posted pick for an NFL/CFB game, in one place: our moneyline pick when
# the book has a moneyline, else the model's side. A tracking-log row may be
# a csv.DictReader row (strings) or a pandas row (NaN for missing); these
# read both. Used here, by seasons.py and by nfl-cfb/src/build_site.py.

def football_has_ml(r):
    """Whether the book had a moneyline for our pick in a tracking-log row."""
    return _present(r.get("ml_pick_side")) and _num(r.get("ml_pick_price")) is not None


def football_pick(r):
    """(team, our chance) for a tracking-log row's posted pick, or None when
    there's neither a moneyline pick nor a model line."""
    if football_has_ml(r) and _num(r.get("ml_our_prob")) is not None:
        return r["ml_pick_team"], _num(r["ml_our_prob"])
    spread, hp = _num(r.get("model_spread")), _num(r.get("model_home_win_prob"))
    if spread is not None and hp is not None:
        home = spread > 0 or (spread == 0 and hp > 0.5)  # a 0.0 line goes to the side the chance favors
        return (r["home_team"], hp) if home else (r["away_team"], 1 - hp)
    return None


def football_hit(r):
    """Whether the posted pick in a graded tracking-log row won: the
    moneyline pick when the book had one (a tie is a miss; the bet itself is
    a push), else the team the model favored. None when ungraded."""
    if football_has_ml(r):
        if _num(r.get("ml_push")) == 1:
            return False
        won = _num(r.get("ml_won"))
        return None if won is None else won == 1
    c = _num(r.get("model_correct_pick"))
    return None if c is None else c == 1


def football_entry(r, t):
    """The posted pick in an ungraded tracking-log row (football_pick), as a
    pick-moves entry."""
    if r.get("actual_margin") not in (None, ""):
        return None  # graded
    picked = football_pick(r)
    if picked is None:
        return None
    pick, prob = picked
    spread = _num(r.get("model_spread"))
    return {"t": t, "pick": pick, "prob": round(prob * 100, 1), "vegas": _num(r.get("vegas_home_favored_by")),
            "ours": None if spread is None else round(spread, 1)}


def football_rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def record_football(data, rows, t):
    n = 0
    for r in rows:
        e = football_entry(r, t)
        if e:
            n += add(data, football_key(r), (r.get("gameday") or "")[:10], e)
    return n


# ── MLB, NBA, NHL, CBB and soccer: picks_history.json ───────────────────────
def daily_entry(p, t=None):
    if p.get("correct") is not None or p.get("void") or not p.get("pick"):
        return None
    ml = p.get("ml") or {}
    vegas = None
    if ml.get("price") is not None:
        team = "Draw" if ml.get("side") == "draw" else ml.get("team") or p["pick"]
        vegas = f"{team} {'+' if ml['price'] > 0 else '−'}{abs(int(round(ml['price'])))}"
    margin = p.get("margin")
    ours = f"{p['pick']} by {margin:.1f}" if isinstance(margin, (int, float)) and margin >= 0.5 else None
    return {"t": p.get("set_at") or t or now_iso(), "pick": p["pick"], "prob": p.get("prob"),
            "vegas": vegas, "ours": ours}


def record_daily(data, picks, t=None):
    n = 0
    for p in picks:
        e = daily_entry(p, t)
        if e and e["prob"] is not None:
            n += add(data, str(p["game_id"]), p.get("date") or "", e)
    return n


# ── Running it ───────────────────────────────────────────────────────────────
def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def backfill(src, dst, since, kind):
    """Walks src's git history since `since`, oldest first, into dst."""
    data = load(dst)
    shas = _git("log", "--reverse", f"--since={since}", "--format=%H %cI", "--", src).split("\n")
    n = 0
    for line in filter(None, shas):
        sha, when = line.split(" ", 1)
        t = datetime.fromisoformat(when).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            text = _git("show", f"{sha}:./{src}")
        except subprocess.CalledProcessError:
            continue
        if kind == "football":
            n += record_football(data, football_rows(text), t)
        else:
            try:
                picks = json.loads(text).get("picks", [])
            except ValueError:
                continue
            n += record_daily(data, picks, t)
    prune(data)
    save(dst, data)
    print(f"  {dst}: {n} moves from {len(list(filter(None, shas)))} versions, {len(data)} games")


def run(kind, backfill_since=None):
    files = FOOTBALL if kind == "football" else DAILY
    for src, dst in files.items():
        if not os.path.exists(src):
            continue
        if backfill_since:
            backfill(src, dst, backfill_since, kind)
            continue
        data = load(dst)
        with open(src) as f:
            if kind == "football":
                n = record_football(data, football_rows(f.read()), now_iso())
            else:
                n = record_daily(data, json.load(f).get("picks", []))
        prune(data)
        save(dst, data)
        print(f"  {dst}: {n} new moves, {len(data)} games")


if __name__ == "__main__":
    args = sys.argv[1:]
    since = args[args.index("--backfill") + 1] if "--backfill" in args else None
    run(args[0], since)
