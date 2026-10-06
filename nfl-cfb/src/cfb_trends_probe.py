"""Temporary probe: how many CFBD calls are left this month."""
import os
import requests
r = requests.get("https://api.collegefootballdata.com/teams/fbs", params={"year": 2026},
                 headers={"Authorization": f"Bearer {os.environ['CFBD_API_KEY']}"}, timeout=60)
print("status", r.status_code)
for k, v in r.headers.items():
    if "limit" in k.lower() or "retry" in k.lower() or "rate" in k.lower():
        print(k, v)
print(r.text[:300] if r.status_code != 200 else "ok")
