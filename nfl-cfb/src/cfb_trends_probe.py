"""Temporary probe: which AP poll week is in force at kickoff."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import pandas as pd
import cfb_trends as T

for season, through in ((2026, "2026-10-05"), (2006, "2006-10-09")):
    polls = T._poll_ranks(season)
    print(season, "poll weeks:", [w for w, _ in polls])
    games = pd.DataFrame(T._get("/games", {"year": season, "seasonType": "regular"}))
    print(" game keys:", sorted(games.columns)[:40])
    fbs = {t.get("school") for t in T._get("/teams/fbs", {"year": season})}
    games = games[games.homeTeam.isin(fbs) & games.awayTeam.isin(fbs)].dropna(subset=["homePoints"])
    games = games[pd.to_datetime(games.startDate, utc=True) <= pd.Timestamp(through, tz="UTC")]
    for name, pick in (("A: poll week <= game week", lambda w: max([p for p in polls if p[0] <= w], key=lambda p: p[0], default=(0, {}))[1]),
                       ("B: poll week <  game week", lambda w: max([p for p in polls if p[0] < w], key=lambda p: p[0], default=(0, {}))[1])):
        W = L = 0; ups = []
        for g in games.itertuples():
            r = pick(int(g.week)); hr, ar = r.get(g.homeTeam), r.get(g.awayTeam)
            m = g.homePoints - g.awayPoints
            if hr and not ar:
                W += m > 0; L += m < 0
                if m < 0: ups.append(f"{g.awayTeam} over #{hr} {g.homeTeam} wk{g.week}")
            if ar and not hr:
                W += m < 0; L += m > 0
                if m > 0: ups.append(f"{g.homeTeam} over #{ar} {g.awayTeam} wk{g.week}")
        print(f" {name}: {W}-{L}", ups)
