"""Fetch a small sample from each free data source so we can see what works
from GitHub's runners. Writes out/probe/<name>.txt with status + first lines."""
import os, urllib.request, gzip, io, json, sys

OUT = "out/probe"
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (sports-edge research; github actions)"}
URLS = {
    "moneypuck_teams_season": "https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/teams.csv",
    "moneypuck_games_all": "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv",
    "moneypuck_goalies": "https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/goalies.csv",
    "nhl_schedule": "https://api-web.nhle.com/v1/schedule/2025-10-20",
    "nhl_boxscore": "https://api-web.nhle.com/v1/gamecenter/2025020100/boxscore",
    "nhl_landing": "https://api-web.nhle.com/v1/gamecenter/2025020100/landing",
    "savant_batters": "https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&min=50&selections=xba,xslg,xwoba,exit_velocity_avg,barrel_batted_rate,hard_hit_percent,k_percent&csv=true",
    "savant_expected": "https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=2025&position=&team=&min=50&csv=true",
    "savant_pitchers": "https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=2025&position=&team=&min=50&csv=true",
    "openmeteo_archive": "https://archive-api.open-meteo.com/v1/archive?latitude=39.05&longitude=-94.48&start_date=2025-09-07&end_date=2025-09-07&hourly=temperature_2m,wind_speed_10m,precipitation&wind_speed_unit=mph&temperature_unit=fahrenheit",
    "openmeteo_forecast": "https://api.open-meteo.com/v1/forecast?latitude=39.05&longitude=-94.48&hourly=temperature_2m,wind_speed_10m,precipitation&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=2",
    "clubelo_date": "http://api.clubelo.com/2025-09-01",
    "clubelo_club": "http://api.clubelo.com/Arsenal",
    "nflverse_pbp": "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz",
    "nflverse_snaps": "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2025.csv",
    "mlb_lineup": "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2025-09-10&hydrate=lineups,officials,weather",
}
for name, url in URLS.items():
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            code = r.status
        if url.endswith(".gz"):
            raw = gzip.decompress(raw)
        text = raw.decode("utf-8", "replace")
        head = "\n".join(text.splitlines()[:6])[:4000]
        msg = f"OK {code} bytes={len(raw)} lines={text.count(chr(10))}\n{head}\n"
    except Exception as e:
        msg = f"FAIL {e!r}\n"
    open(f"{OUT}/{name}.txt", "w").write(msg)
    print(name, msg.splitlines()[0])
