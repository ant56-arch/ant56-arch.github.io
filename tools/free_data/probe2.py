"""Probe the new sources Anthony approved on 2026-11-05 (Natural Stat Trick,
Bart Torvik, ClubElo retry) from GitHub's runners. Writes out/probe2/<name>.txt."""
import os, urllib.request

OUT = "out/probe2"
os.makedirs(OUT, exist_ok=True)
UAS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
       "sports-edge research (github actions)"]
URLS = {
    "nst_teams": "https://www.naturalstattrick.com/teamtable.php?fromseason=20252026&thruseason=20252026&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=410&fd=&td=",
    "nst_games": "https://www.naturalstattrick.com/games.php?fromseason=20252026&thruseason=20252026&stype=2&sit=5v5&loc=B&team=All&rate=n",
    "torvik_csv": "https://barttorvik.com/2026_team_results.csv",
    "torvik_json": "https://barttorvik.com/2026_team_results.json",
    "torvik_games": "https://barttorvik.com/getgamestats.php?year=2026&csv=1",
    "torvik_trank": "https://barttorvik.com/trank.php?year=2026&csv=1",
    "clubelo_http": "http://api.clubelo.com/2026-11-01",
    "clubelo_https": "https://api.clubelo.com/2026-11-01",
    "clubelo_club": "http://api.clubelo.com/Arsenal",
}
for name, url in URLS.items():
    lines = []
    for ua in UAS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                text = raw.decode("utf-8", "replace")
                lines.append(f"OK {r.status} [{ua[:12]}] bytes={len(raw)} lines={text.count(chr(10))}\n" + "\n".join(text.splitlines()[:8])[:3000])
                break
        except Exception as e:
            lines.append(f"FAIL [{ua[:12]}] {e!r}")
    msg = "\n".join(lines) + "\n"
    open(f"{OUT}/{name}.txt", "w").write(msg)
    print(name, "|", " / ".join(l.splitlines()[0] for l in lines))
