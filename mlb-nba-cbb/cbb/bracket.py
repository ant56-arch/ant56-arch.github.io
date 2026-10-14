"""
bracket.py - the NCAA tournament (March Madness) bracket for CBB Edge's
Bracket tab, imported from ESPN with no hand entry.

ESPN tags every tournament game with a note like "NCAA Men's Basketball
Championship - East Region - 1st Round" and gives each team its seed, so the
whole bracket follows from the games themselves: a team's seed and region fix
its first-round spot, and the standard seed order (1-16, 8-9, 5-12, ...) fixes
who it can meet after that. The field shows up on ESPN's scoreboard the night
of Selection Sunday, so the first daily run after it fills the bracket in.

For every team this works out its chance to reach each round, by playing every
possible matchup through the model (all neutral court). "Our bracket" picks the
model's favorite in every game. Both are frozen once the First Four tips off,
so the bracket is graded the way a pool would grade it: 10, 20, 40, 80, 160
and 320 points for a right pick in rounds 1 to 6. The live chances keep moving
with every result.

Writes cbb/brackets/<season>.json (2027 = the 2026-27 season). Before this
season's field is out, the Bracket tab shows last season's bracket as if we
had filled it in on Selection Sunday. CBB_TODAY=YYYY-MM-DD overrides today's
date; `python cbb/bracket.py 2026` rebuilds a past season from stored games.
"""

import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import espn  # noqa: E402
import model as M  # noqa: E402
import store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "brackets")
MODEL_FILE = os.path.join(HERE, "model_weights.json")

TOURNAMENT = "NCAA Men's Basketball Championship"
ROUNDS = {"First Four": 0, "1st Round": 1, "2nd Round": 2, "Sweet 16": 3, "Elite 8": 4,
          "Final Four": 5, "National Championship": 6}
ROUND_NAMES = ["First Four", "Round of 64", "Round of 32", "Sweet 16", "Elite 8", "Final Four", "Championship"]
POINTS = {1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320}
# First-round spots in a region, top to bottom: game i is SEED_ORDER[2i] vs SEED_ORDER[2i+1].
SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]


def today():
    return os.environ.get("CBB_TODAY") or datetime.now(espn.ET).date().isoformat()


def season_of(day):
    d = date.fromisoformat(day)
    return d.year + 1 if d.month >= 7 else d.year


def parse_note(note):
    """'NCAA Men's Basketball Championship - East Region - 1st Round' -> ('East', 1)."""
    if TOURNAMENT not in (note or ""):
        return None, None
    region = re.search(r"(\w[\w ]*?) Region", note)
    rnd = next((n for k, n in ROUNDS.items() if note.rstrip().endswith(k)), None)
    return (region.group(1).strip() if region else None), rnd


# ── Gathering the field ──────────────────────────────────────────────────────
def entries_from_games(games):
    """Stored (final) games -> tournament entries: one dict per game."""
    out = []
    for g in games:
        region, rnd = parse_note(g.get("note"))
        if rnd is None:
            continue
        teams = [{"id": g[s], "abbr": g[f"{s}_abbr"], "name": g[f"{s}_name"], "seed": g[f"{s}_rank"]}
                 for s in ("home", "away")]
        winner = None
        if g.get("final") and g.get("home_pts") is not None and g["home_pts"] != g["away_pts"]:
            winner = g["home"] if g["home_pts"] > g["away_pts"] else g["away"]
        out.append({"id": g["id"], "date": g["date"], "start": g.get("start"), "region": region, "round": rnd,
                    "teams": teams, "winner": winner, "state": "post" if winner else g.get("state", ""),
                    "score": {g["home"]: g.get("home_pts"), g["away"]: g.get("away_pts")} if winner else None})
    return out


def entries_from_espn(day):
    """One scoreboard day's tournament games straight from ESPN, keeping
    games where one side is still TBD (a First Four winner, say), since the
    known side still tells us its seed and region."""
    data = espn.get("scoreboard", dates=day.replace("-", ""), groups=espn.DIVISION_I, limit=500)
    out = []
    for ev in data.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        note = next((n.get("headline") for n in comp.get("notes") or [] if n.get("headline")), "")
        region, rnd = parse_note(note)
        if rnd is None:
            continue
        teams, winner, score = [], None, {}
        stype = ((comp.get("status") or ev.get("status") or {}).get("type") or {})
        for c in comp.get("competitors", []):
            t = c.get("team") or {}
            tid = str(t.get("id") or "")
            if not tid or tid == "-1" or not (t.get("location") or t.get("displayName")):
                continue  # TBD
            seed = (c.get("curatedRank") or {}).get("current")
            try:
                seed = int(c.get("seed") or seed)
            except (TypeError, ValueError):
                seed = None
            teams.append({"id": tid, "abbr": t.get("abbreviation") or "", "seed": seed if seed and seed <= 16 else None,
                          "name": t.get("location") or t.get("shortDisplayName") or t.get("displayName")})
            try:
                score[tid] = int(float(c.get("score")))
            except (TypeError, ValueError):
                pass
            if stype.get("completed") and c.get("winner"):
                winner = tid
        start = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(espn.ET).isoformat()
        out.append({"id": str(ev["id"]), "date": day, "start": start, "region": region, "round": rnd,
                    "teams": teams, "winner": winner, "state": stype.get("state", ""),
                    "score": score if winner else None})
    return out


def collect(season, games, fetch=True):
    """Every tournament entry for a season: stored finals, plus (while the
    tournament is on) the coming days straight from ESPN."""
    entries = {e["id"]: e for e in entries_from_games(g for g in games if g["season"] == season)}
    day = date.fromisoformat(today())
    if fetch and season == season_of(today()) and (day.month == 3 or (day.month == 4 and day.day <= 10)):
        for k in range(-1, 6):
            d = (day + timedelta(days=k)).isoformat()
            try:
                for e in entries_from_espn(d):
                    old = entries.get(e["id"])
                    if not (old and old["winner"]):  # a stored final stays as stored
                        entries[e["id"]] = e
            except Exception as ex:  # one day failing costs only that day
                print(f"  bracket: scoreboard {d} failed: {ex}")
    return sorted(entries.values(), key=lambda e: (e["start"] or e["date"], e["id"]))


# ── The bracket ──────────────────────────────────────────────────────────────
class Bracket:
    """Games are keyed (round, region, index): rounds 1-4 inside a region
    (index 0-7, 0-3, 0-1, 0), 5 is a national semifinal (region None, index
    0-1) and 6 the title game. A First Four game is (0, region, seed)."""

    def __init__(self, entries):
        self.entries = entries
        self.teams = {}
        for e in entries:
            for t in e["teams"]:
                cur = self.teams.setdefault(t["id"], {"id": t["id"], "abbr": t["abbr"], "name": t["name"],
                                                      "seed": None, "region": None})
                if t.get("seed") and e["round"] <= 4:
                    cur["seed"] = t["seed"]
                if e["region"] and not cur["region"]:
                    cur["region"] = e["region"]
        self.teams = {k: v for k, v in self.teams.items() if v["seed"] and v["region"]}
        self.regions = sorted({t["region"] for t in self.teams.values()})
        self.slots = {}  # (region, seed) -> team ids (two for a First Four pair)
        for t in self.teams.values():
            self.slots.setdefault((t["region"], t["seed"]), []).append(t["id"])
        self.results = {}  # frozenset of two team ids -> entry, for games played or scheduled
        for e in entries:
            if len(e["teams"]) == 2:
                self.results[frozenset(t["id"] for t in e["teams"])] = e
        self.semis, self.semis_known = self._semis()

    @property
    def complete(self):
        """The full field: four regions with all 16 seeds."""
        return len(self.regions) == 4 and all((r, s) in self.slots for r in self.regions for s in range(1, 17))

    def _semis(self):
        """Which regions meet in the Final Four: from ESPN's national semifinals
        when they're on the schedule, else from the first round's game order
        on ESPN (the bracket's top-to-bottom order) - set below in order_regions."""
        pairs = []
        for e in self.entries:
            if e["round"] == 5:
                regs = [self.teams[t["id"]]["region"] for t in e["teams"] if t["id"] in self.teams]
                if regs and regs not in pairs:
                    pairs.append(regs)
        full = [p for p in pairs if len(p) == 2]
        if len(full) == 2:
            return full, True
        return None, False

    def order_regions(self, strength):
        """Final Four pairs when ESPN hasn't scheduled the semifinals yet: the
        committee pairs the overall No. 1 seed's region with the fourth-best
        No. 1 seed's, so we pair them by our own ratings of the No. 1 seeds."""
        if self.semis:
            return
        ones = sorted(self.regions, key=lambda r: -max(strength(t) for t in self.slots.get((r, 1), [None]) if t))
        if len(ones) == 4:
            self.semis = [[ones[0], ones[3]], [ones[1], ones[2]]]

    def result(self, a, b):
        return self.results.get(frozenset((a, b)))

    # A game's two feeders: each is a team-slot leaf ('slot', region, seed) or another game key.
    def feeders(self, key):
        rnd, region, i = key
        if rnd == 1:
            return [("slot", region, SEED_ORDER[2 * i]), ("slot", region, SEED_ORDER[2 * i + 1])]
        if rnd <= 4:
            return [(rnd - 1, region, 2 * i), (rnd - 1, region, 2 * i + 1)]
        if rnd == 5:
            return [(4, r, 0) for r in self.semis[i]]
        return [(5, None, 0), (5, None, 1)]

    def game_keys(self):
        keys = [(rnd, r, i) for r in self.regions for rnd in (1, 2, 3, 4) for i in range(8 >> (rnd - 1))]
        if self.semis:
            keys += [(5, None, 0), (5, None, 1), (6, None, 0)]
        return keys

    def first_four(self):
        return [(0, r, s) for (r, s), ids in sorted(self.slots.items()) if len(ids) == 2]

    # ── who actually got where ──
    def actual(self, key):
        """The team that won this spot so far, or None."""
        if key[0] == "slot" or key[0] == 0:
            ids = self.slots.get((key[1], key[2]), [])
            if len(ids) == 1:
                return ids[0]
            if len(ids) == 2:
                e = self.result(*ids)
                return e["winner"] if e else None
            return None
        a, b = (self.actual(f) for f in self.feeders(key))
        if not a or not b:
            return None
        e = self.result(a, b)
        return e["winner"] if e else None

    def participants(self, key):
        if key[0] == 0:
            return list(self.slots[(key[1], key[2])])
        return [self.actual(f) for f in self.feeders(key)]

    # ── chances ──
    def distributions(self, prob, decided=True):
        """{key: {team: chance of winning that game}}. prob(a, b) is a's chance
        to beat b. With decided, games already played count as played."""
        memo = {}

        def dist(key):
            if key in memo:
                return memo[key]
            if key[0] == "slot":
                ids = self.slots.get((key[1], key[2]), [])
                if len(ids) == 2:
                    d = dist((0, key[1], key[2]))
                else:
                    d = {ids[0]: 1.0} if ids else {}
            else:
                if key[0] == 0:
                    a, b = self.slots[(key[1], key[2])]
                    left, right = {a: 1.0}, {b: 1.0}
                else:
                    left, right = (dist(f) for f in self.feeders(key))
                won = self.actual(key) if decided else None
                if won:
                    d = {won: 1.0}
                else:
                    d = {}
                    for side, other in ((left, right), (right, left)):
                        for t, pt in side.items():
                            d[t] = pt * sum(po * prob(t, u) for u, po in other.items())
            memo[key] = d
            return d

        for k in self.first_four() + self.game_keys():
            dist(k)
        return memo

    def advance_odds(self, dists):
        """{team: [chance to win in round 1..6]} = chance to reach the next round."""
        out = {t: [0.0] * 6 for t in self.teams}
        for key, d in dists.items():
            if key[0] in ("slot", 0):
                continue
            for t, p in d.items():
                out[t][key[0] - 1] += p
        return out

    def our_picks(self, prob):
        """The model's favorite in every game, each round built on its own picks."""
        picks = {}

        def pick(key):
            if key in picks:
                return picks[key][0]
            if key[0] == "slot":
                ids = self.slots.get((key[1], key[2]), [])
                if len(ids) == 2:
                    return pick((0, key[1], key[2]))
                return ids[0] if ids else None
            if key[0] == 0:
                a, b = self.slots[(key[1], key[2])]
            else:
                a, b = (pick(f) for f in self.feeders(key))
            if not a or not b:
                return None
            p = prob(a, b)
            picks[key] = (a, p) if p >= 0.5 else (b, 1 - p)
            return picks[key][0]

        for k in self.first_four() + self.game_keys():
            pick(k)
        return picks


# ── The model ────────────────────────────────────────────────────────────────
def league_as_of(games, box, weights, day, season):
    league = M.League((weights or {}).get("league"), M.division_one(games))
    for g in games:
        if g["date"] < day and g["home_pts"] != g["away_pts"]:
            league.update(g, box.get(g["id"]))
    league._check_season(season)
    return league


def prob_fn(league, weights, day, season):
    """a's chance to beat b on a neutral court, on `day`."""
    cache = {}

    def one(a, b):
        feats = league.features({"home": a, "away": b, "neutral": True, "season": season, "date": day})
        return M.win_prob(weights, feats)[0]

    def prob(a, b):
        if (a, b) not in cache:
            p = (one(a, b) + 1 - one(b, a)) / 2  # the same either way round
            cache[(a, b)], cache[(b, a)] = p, 1 - p
        return cache[(a, b)]
    return prob


def strength_fn(league, day):
    r = league.ratings(day)

    def strength(team):
        return league.team_rating(r, team)[2]
    return strength


# ── Output ───────────────────────────────────────────────────────────────────
def key_str(key):
    rnd, region, i = key
    return f"{rnd}-{region or 'FF'}-{i}"


def build(season, games, box, weights, saved=None, fetch=True):
    entries = collect(season, games, fetch)
    br = Bracket(entries)
    if not br.complete:
        return None
    first_day = min(e["date"] for e in entries)
    day = today()
    started = any(e["winner"] for e in entries) or day > first_day

    pre_league = league_as_of(games, box, weights, first_day, season)
    pre_prob = prob_fn(pre_league, weights, first_day, season)
    br.order_regions(strength_fn(pre_league, first_day))
    if not br.semis:
        return None

    frozen = saved if (saved and saved.get("season") == season and started and saved.get("picks")) else None
    if frozen:
        picks = {k: tuple(v) for k, v in frozen["picks"].items()}
        pre_odds = frozen["pre_odds"]
    else:
        picks = {key_str(k): v for k, v in br.our_picks(pre_prob).items()}
        pre_odds = {t: [round(p, 4) for p in v]
                    for t, v in br.advance_odds(br.distributions(pre_prob, decided=False)).items()}

    champion = br.actual((6, None, 0))
    if champion:
        live_odds = None
    else:
        live_day = max(day, first_day)
        live_league = league_as_of(games, box, weights, live_day, season)
        live_odds = {t: [round(p, 4) for p in v] for t, v in
                     br.advance_odds(br.distributions(prob_fn(live_league, weights, live_day, season))).items()}

    out_games = []
    score = possible = 0
    rounds = {r: {"right": 0, "wrong": 0} for r in range(1, 7)}
    eliminated = set()
    for k in br.first_four() + br.game_keys():
        a, b = br.participants(k)
        won = br.actual(k)
        if won:
            eliminated.add(b if won == a else a)
    for k in br.first_four() + br.game_keys():
        a, b = br.participants(k)
        e = br.result(a, b) if a and b else None
        won = br.actual(k)
        pk = picks.get(key_str(k))
        row = {"key": key_str(k), "round": k[0], "region": k[1], "teams": [a, b], "winner": won,
               "pick": pk[0] if pk else None, "pick_prob": round(100 * pk[1], 1) if pk else None,
               "game_id": e["id"] if e else None, "start": e["start"] if e else None,
               "state": e["state"] if e else "", "score": e["score"] if e else None}
        if k[0] >= 1 and pk:
            if won:
                right = won == pk[0]
                row["correct"] = right
                rounds[k[0]]["right" if right else "wrong"] += 1
                score += POINTS[k[0]] if right else 0
            elif pk[0] not in eliminated:
                possible += POINTS[k[0]]
        out_games.append(row)

    status = "final" if champion else ("live" if started else "pre")
    return {
        "season": season, "status": status, "first_day": first_day,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "picked_at": (frozen or {}).get("picked_at") or first_day,
        "model": (frozen or {}).get("model") or weights.get("trained_at"),
        "regions": [r for pair in br.semis for r in pair], "semis": br.semis, "semis_known": br.semis_known,
        "teams": br.teams, "games": out_games, "champion": champion,
        "picks": {k: list(v) for k, v in picks.items()},
        "pre_odds": pre_odds, "live_odds": live_odds,
        "score": {"points": score, "max": score + possible, "rounds": rounds},
    }


def load(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def run(season=None, fetch=True):
    weights = load(MODEL_FILE)
    if not weights:
        return
    games, box = store.load_all()
    seasons = [season] if season else [season_of(today()), season_of(today()) - 1]
    for s in seasons:
        path = os.path.join(OUT_DIR, f"{s}.json")
        saved = load(path)
        if saved and saved.get("status") == "final" and not season:
            break  # nothing left to change; last season's stays as it ended
        b = build(s, games, box, weights, saved, fetch)
        if b:
            os.makedirs(OUT_DIR, exist_ok=True)
            with open(path, "w") as f:
                json.dump(b, f, indent=1)
            sc = b["score"]
            print(f"Bracket {s}: {b['status']}, {len(b['teams'])} teams, our bracket {sc['points']} points "
                  f"(max {sc['max']})")
            break
        print(f"Bracket {s}: no full field yet")


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else None)
