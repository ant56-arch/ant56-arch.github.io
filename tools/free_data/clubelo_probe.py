"""Tries ClubElo over a few URL forms to see which (if any) answers from GitHub's runners."""
import os, urllib.request
os.makedirs("out/probe", exist_ok=True)
lines = []
for url in ("http://api.clubelo.com/2026-10-01", "https://api.clubelo.com/2026-10-01",
            "http://api.clubelo.com/ManCity", "https://clubelo.com/ManCity", "http://clubelo.com/"):
    for ua in ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "curl/8.5.0"):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=30) as r:
                body = r.read(300).decode("utf-8", "replace").replace("\n", " | ")
                lines.append(f"OK {r.status} {url} [{ua[:10]}] {body}")
        except Exception as e:
            lines.append(f"FAIL {url} [{ua[:10]}] {e!r}")
open("out/probe/clubelo_variants.txt", "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
