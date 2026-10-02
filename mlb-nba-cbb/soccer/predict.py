"""
predict.py - Soccer Edge's daily run. Every run does four things, so any run
catches up on whatever an earlier one missed:

  1. sync     - stores each finished day's Premier League, La Liga and
                Champions League results from ESPN (soccer/data/days/), and
                once a day refreshes this season's league results from
                football-data.co.uk (every league the ratings learn from)
  2. grade    - settles pending picks on the regular-time result (90 minutes
                plus stoppage; extra time and penalties don't count). A
                postponed match, or one whose 90-minute score can't be told,
                is no decision
  3. ratings  - refits every club's ratings on the results before today
                (model.py, with the recipe in model_weights.json)
  4. picks    - gives every match today and tomorrow its home win, draw and
                away win chances, picks the most likely of the three (a draw
                can be the pick), and prices that pick against the three-way
                moneyline on ESPN's scoreboard. Picks refresh each run with the
                latest prices, and lock once their match kicks off.

Writes soccer/picks_history.json and soccer/ratings.json for
soccer/build_pages.py. SOCCER_TODAY=YYYY-MM-DD overrides today's date for
testing.
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import espn  # noqa: E402
import fd  # noqa: E402
import model as M  # noqa: E402
import moneyline  # noqa: E402
import names  # noqa: E402
import store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_FILE = os.path.join(HERE, "picks_history.json")
SYNC_FILE = os.path.join(HERE, "data", "sync.json")
MODEL_FILE = os.path.join(HERE, "model_weights.json")
RATINGS_FILE = os.path.join(HERE, "ratings.json")

NOW = datetime.now(espn.ET)
TODAY = os.environ.get("SOCCER_TODAY") or NOW.date().isoformat()
PICK_DAYS = 2  # today and tomorrow
SIDES = ("home", "draw", "away")


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def save(path, data, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, **kw)


# ── 1. sync ──────────────────────────────────────────────────────────────────
def sync():
    state = load(SYNC_FILE, {})
    yesterday = date.fromisoformat(TODAY) - timedelta(days=1)
    through = state.get("through") or (yesterday - timedelta(days=1)).isoformat()
    day = date.fromisoformat(through) + timedelta(days=1)
    while day <= yesterday:
        d = day.isoformat()
        games = []
        for comp in espn.COMPS:
            games += espn.scoreboard(comp, d)
        if any(not (g["final"] or g["postponed"]) for g in games):
            print(f"  {d}: not every match is final yet, will retry next run")
            break
        if games:
            store.save_day(d, games)
            print(f"  stored {d}: {sum(g['final'] for g in games)} finals, {sum(g['postponed'] for g in games)} postponed")
        through = d
        day += timedelta(days=1)
    state["through"] = through
    # This season's league results, from every league the ratings use. Once a
    # day is plenty (the site updates them a couple of times a week).
    if state.get("fd_refreshed") != TODAY:
        season = espn.season_of(TODAY)
        old = {}
        for m in store.load_fd(season):
            old.setdefault(m["comp"], []).append(m)
        rows, fresh = [], 0
        for code in fd.LEAGUES:
            got = fd.fetch(code, season)
            if got is None:
                rows += old.get(code, [])
            else:
                rows += got
                fresh += 1
        if rows:
            store.save_fd(season, rows)
        if fresh:
            state["fd_refreshed"] = TODAY
        print(f"  league results {season}-{str(season + 1)[2:]}: {len(rows)} matches ({fresh}/{len(fd.LEAGUES)} leagues refreshed)")
    save(SYNC_FILE, state, indent=1)


# ── 2. grade ─────────────────────────────────────────────────────────────────
def winner(p, g):
    o = M.outcome(g["hg"], g["ag"])
    return p["home"] if o == "home" else p["away"] if o == "away" else "Draw"


def grade(history, games_by_id):
    graded = 0
    for p in history["picks"]:
        if p.get("correct") is not None or p.get("void") or p["date"] >= TODAY:
            continue
        g = games_by_id.get(p["game_id"])
        if g and g.get("postponed") and not g.get("final"):
            p["void"] = True
            graded += 1
        elif g and g.get("final"):
            if not g.get("reg_known") or g.get("hg") is None:
                p["void"] = True  # went to extra time and the 90-minute score isn't known
                p["void_reason"] = "no 90-minute score"
            else:
                p["home_pts"], p["away_pts"] = g["hg"], g["ag"]
                if g.get("extra"):
                    p["extra"] = g["extra"]
                    p["ft"] = g.get("ft")
                p["winner"] = winner(p, g)
                p["correct"] = p["winner"] == p["pick"]
            graded += 1
        elif p["date"] < (date.fromisoformat(TODAY) - timedelta(days=3)).isoformat():
            p["void"] = True  # postponed and never played on its date
            graded += 1
    print(f"Graded {graded} picks")


def grade_moneylines(history):
    n = sum(moneyline.grade(p) for p in history["picks"])
    if n:
        print(f"Graded {n} moneyline picks")


# ── 4. picks ─────────────────────────────────────────────────────────────────
def three_way(probs, odds, pick_side):
    """The moneyline on our pick (home, draw or away): its price, the no-vig
    chance the three prices give it, and Value at a 6+ point edge."""
    if not odds or any(odds.get(s) is None for s in SIDES):
        return None
    imp = {s: moneyline.implied(odds[s]) for s in SIDES}
    total = sum(imp.values())
    book = {s: imp[s] / total for s in SIDES}
    edge = round(100 * (probs[pick_side] - book[pick_side]), 1)
    return {"side": pick_side, "price": odds[pick_side], "prob": round(100 * probs[pick_side], 1),
            "book_prob": round(100 * book[pick_side], 1), "edge": edge, "value": edge >= moneyline.VALUE_EDGE,
            "home_ml": odds["home"], "draw_ml": odds["draw"], "away_ml": odds["away"],
            "book": odds.get("book") or "ESPN", "won": None, "units": None}


def make_picks(history, ratings, weights):
    days = [(date.fromisoformat(TODAY) + timedelta(days=i)).isoformat() for i in range(PICK_DAYS)]
    slate = []
    for d in days:
        for comp in espn.COMPS:
            try:
                slate += espn.scoreboard(comp, d)
            except Exception as e:
                print(f"  {comp} {d} unavailable: {e}")
    print(f"{len(slate)} matches {days[0]} to {days[-1]}")
    existing = {p["game_id"]: p for p in history["picks"] if p["date"] in days}
    unknown = set()
    for g in slate:
        old = existing.get(g["id"])
        if g["state"] != "pre" or g["postponed"]:
            continue  # started, final or postponed: a pick already made stays as it was
        hk, ak = names.team_key(g["home_name"]), names.team_key(g["away_name"])
        unknown |= {n for n, k in ((g["home_name"], hk), (g["away_name"], ak)) if not ratings.known(k)}
        p = ratings.probs(hk, ak, g["neutral"], store.LEAGUE_OF.get(g["comp"]))
        side = M.pick_of(p)
        pick = {
            "date": g["date"], "game_id": g["id"], "start": g["start"], "comp": g["comp"], "season": g["season"],
            "home": g["home"], "away": g["away"], "home_name": g["home_name"], "away_name": g["away_name"],
            "home_logo": g["home_logo"], "away_logo": g["away_logo"],
            "home_record": g["home_record"], "away_record": g["away_record"], "neutral": g["neutral"],
            "pick": g["home"] if side == "home" else g["away"] if side == "away" else "Draw",
            "pick_side": side,
            "prob": round(100 * p[side], 1),
            "probs": {s: round(100 * p[s], 1) for s in SIDES},
            "xg": {"home": round(p["xg"][0], 2), "away": round(p["xg"][1], 2)},
            "model": weights.get("trained_at"),
            "correct": None,
            "set_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        try:  # the moneyline is extra: without odds, the pick still goes out
            odds = g.get("odds")
            if not odds and old and old.get("ml"):  # no price right now: keep the last one
                odds = {"home": old["ml"]["home_ml"], "draw": old["ml"]["draw_ml"], "away": old["ml"]["away_ml"],
                        "book": old["ml"].get("book")}
            ml = three_way({s: p[s] for s in SIDES}, odds, side)
        except Exception as e:
            print(f"  moneyline for {g['away']} @ {g['home']} failed: {e}")
            ml = None
        if ml:
            ml["team"] = pick["pick"]
            pick["ml"] = ml
        if old:
            old.clear()
            old.update(pick)
        else:
            history["picks"].append(pick)
        print(f"  {g['comp']} {g['away']} @ {g['home']}: {pick['pick']} {pick['prob']}% "
              f"(H {pick['probs']['home']} D {pick['probs']['draw']} A {pick['probs']['away']})"
              + (f"; {moneyline.price_text(ml['price'])} ({ml['book_prob']:.0f}% implied)" if ml else ""))
    if unknown:
        print(f"  No ratings yet for: {', '.join(sorted(unknown))} (rated at their league's average)")


def save_ratings(ratings):
    """The clubs' ratings this morning, for the Model tab."""
    since = date.fromisoformat(TODAY).toordinal() - 365
    rows = [{"team": t, "league": lg, "strength": round(s, 3)} for t, lg, s in ratings.table(active_since=since)]
    save(RATINGS_FILE, {"as_of": TODAY, "leagues": {k: round(v, 3) for k, v in ratings.league_strengths().items()},
                        "home": round(ratings.home, 4), "rho": ratings.rho, "teams": rows}, indent=1)


def main():
    weights = load(MODEL_FILE, None)
    history = load(HISTORY_FILE, {"picks": []})
    print(f"Soccer Edge run for {TODAY}")
    sync()
    grade(history, store.day_games())
    grade_moneylines(history)

    if weights and weights.get("recipe"):
        matches = store.load_matches()
        data = M.Data(matches) if matches else None
        ratings = M.fit(data, TODAY, weights["recipe"]) if data else None
        if ratings:
            print(f"Ratings from {ratings.n_used} matches (home edge {ratings.home:.3f}, rho {ratings.rho})")
            save_ratings(ratings)
            make_picks(history, ratings, weights)
        else:
            print("Not enough stored matches to rate the clubs; run the research pull.")
    else:
        print("No trained model yet (soccer/model_weights.json); run the Soccer research workflow.")

    history["picks"].sort(key=lambda p: (p["date"], p["start"], p["game_id"]))
    save(HISTORY_FILE, history, indent=1)


if __name__ == "__main__":
    main()
