"""Kickoff weather for outdoor NFL games since 2013 that nflverse's schedule
has no temp/wind for, from Open-Meteo's historical archive (free, no key). Writes out/weather/nfl_weather.csv:
game_id, temp_f, wind_mph, precip_mm (the kickoff hour at the home stadium)."""
import csv, io, json, os, sys, time, urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "nfl-cfb", "src"))
from weather import stadium_for  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (sports-edge research)"}
GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"


def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception as e:
            print("retry", e); time.sleep(5 * (i + 1))
    raise RuntimeError(url)


def main():
    games = list(csv.DictReader(io.StringIO(get(GAMES).decode())))
    todo = defaultdict(list)  # (lat, lon, season) -> games
    for g in games:
        if int(g["season"]) < 2013 or g["roof"] not in ("outdoors", "open", "") or not g["home_score"]:
            continue
        if g["temp"] and g["wind"]:
            continue
        spot = stadium_for(g["home_team"], int(g["season"]), g["location"])
        if spot:
            todo[(spot, g["season"])].append(g)
    os.makedirs("out/weather", exist_ok=True)
    with open("out/weather/nfl_weather.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["game_id", "temp_f", "wind_mph", "precip_mm"])
        for n, (((lat, lon), season), gs) in enumerate(sorted(todo.items())):
            print(n, len(todo), season, len(gs), flush=True)
            days = sorted(g["gameday"] for g in gs)
            url = ("https://archive-api.open-meteo.com/v1/archive?"
                   f"latitude={lat}&longitude={lon}&start_date={days[0]}&end_date={days[-1]}"
                   "&hourly=temperature_2m,wind_speed_10m,precipitation&wind_speed_unit=mph"
                   "&temperature_unit=fahrenheit&timezone=America%2FNew_York")
            try:
                h = json.loads(get(url))["hourly"]
            except Exception as e:
                print("skip", e, flush=True); continue
            at = {t: i for i, t in enumerate(h["time"])}
            for g in gs:
                hour = (g["gametime"] or "13:00")[:2]
                i = at.get(f"{g['gameday']}T{hour}:00")
                if i is None:
                    continue
                w.writerow([g["game_id"], h["temperature_2m"][i], h["wind_speed_10m"][i], h["precipitation"][i]])
            time.sleep(0.3)
    print("done", sum(len(v) for v in todo.values()))


if __name__ == "__main__":
    main()
