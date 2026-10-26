"""Pull research data from free sources into out/ (stored on research-data).

nhl_xg.csv.gz    MoneyPuck team game log, all situations: expected goals for
                 and against per game since 2008-09.
savant_*.csv     Baseball Savant expected stats per season (batters, pitchers).
clubelo/*.csv    ClubElo rating history per club (top European leagues).
"""
import csv, gzip, io, os, time, urllib.request

OUT = "out"
UA = {"User-Agent": "Mozilla/5.0 (sports-edge research; github actions)"}


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:
            print("retry", url, e)
            time.sleep(5 * (i + 1))
    raise RuntimeError(url)


def nhl_xg():
    raw = get("https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv").decode()
    keep = ["season", "gameId", "playerTeam", "opposingTeam", "home_or_away", "gameDate",
            "xGoalsFor", "xGoalsAgainst", "goalsFor", "goalsAgainst", "shotsOnGoalFor", "shotsOnGoalAgainst",
            "scoreVenueAdjustedxGoalsFor", "scoreVenueAdjustedxGoalsAgainst"]
    rows = csv.DictReader(io.StringIO(raw))
    with gzip.open(f"{OUT}/nhl_xg.csv.gz", "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(keep)
        n = 0
        for r in rows:
            if r["situation"] == "all" and r["position"] == "Team Level":
                w.writerow([r[k] for k in keep]); n += 1
    print("nhl_xg rows", n)


def savant():
    os.makedirs(f"{OUT}/savant", exist_ok=True)
    for kind in ("batter", "pitcher"):
        for yr in range(2018, 2027):
            url = (f"https://baseballsavant.mlb.com/leaderboard/expected_statistics?type={kind}"
                   f"&year={yr}&position=&team=&min=1&csv=true")
            try:
                open(f"{OUT}/savant/{kind}_{yr}.csv", "wb").write(get(url))
            except Exception as e:
                print("savant fail", kind, yr, e)
            time.sleep(1)
        url = (f"https://baseballsavant.mlb.com/leaderboard/custom?type={kind}&min=1&csv=true"
               "&selections=k_percent,bb_percent,exit_velocity_avg,barrel_batted_rate,hard_hit_percent,sweet_spot_percent,whiff_percent&year=")
        for yr in range(2018, 2027):
            try:
                open(f"{OUT}/savant/{kind}_contact_{yr}.csv", "wb").write(get(url + str(yr)))
            except Exception as e:
                print("savant custom fail", kind, yr, e)
            time.sleep(1)


def clubelo():
    os.makedirs(f"{OUT}/clubelo", exist_ok=True)
    try:
        snap = get("http://api.clubelo.com/2026-10-01").decode()
    except Exception as e:
        print("clubelo down", e); return
    open(f"{OUT}/clubelo/_snapshot_2026-10-01.csv", "w").write(snap)
    clubs = [r["Club"] for r in csv.DictReader(io.StringIO(snap))
             if r["Country"] in ("ENG", "ESP") or float(r["Elo"]) >= 1650]
    for c in clubs:
        try:
            open(f"{OUT}/clubelo/{c.replace(' ', '')}.csv", "wb").write(get(f"http://api.clubelo.com/{c.replace(' ', '')}"))
        except Exception as e:
            print("club fail", c, e)
        time.sleep(0.5)
    print("clubelo clubs", len(clubs))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for fn in (nhl_xg, savant, clubelo):
        try:
            fn()
        except Exception as e:
            print("FAILED", fn.__name__, e)
