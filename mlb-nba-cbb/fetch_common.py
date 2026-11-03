"""
fetch_common.py - what the data fetchers share (the MLB hitter picks'
predict.py, teams/statsapi.py and the nba, nhl, cbb and soccer espn.py): a
JSON GET that retries with backoff, and the ESPN statuses that void a game.
"""

import time

import requests

# Games called off, never to finish on their date (the same for every ESPN
# sport). A delay isn't here: a delayed game still finishes, and sync re-checks it.
ESPN_VOID_STATUS = {"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED", "STATUS_SUSPENDED", "STATUS_FORFEIT"}


def get_json(session, api, path, params, tries=4, retry_client_errors=True):
    """GET {api}/{path} as JSON, retrying failures with 1, 2, 4... second
    waits and raising on the last try. With retry_client_errors=False a 4xx
    other than 429 is raised at once: a bad request won't get better by
    asking again."""
    for attempt in range(tries):
        try:
            r = session.get(f"{api}/{path}", params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if attempt == tries - 1 or (not retry_client_errors and code and 400 <= code < 500 and code != 429):
                raise
            print(f"  retrying {path}: {e}")
            time.sleep(2 ** attempt)
