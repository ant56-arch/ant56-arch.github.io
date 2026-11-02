# When a season ends

Every league (NFL, CFB, MLB, NHL, NBA, CBB, Soccer) goes through the same steps.
The code is `shared/seasons.py`; each league's settings are in `shared/seasons.json`.

## What marks a season over

A league's season is over when all of these are true:

- its last pick was in one of the months its season can end in (`end_months`:
  MLB September to November, NBA and NHL May to July, NFL January and February, and so on),
- no pick has been made for `gap_days` days since (MLB 5, NBA/NHL/CBB 10, NFL/CFB 16,
  Soccer 21). Each is longer than any break inside that league's playoffs. A game
  already on the schedule counts as a pick, so the season isn't over while one is coming up,
- the next season's usual start (`next_start`, e.g. MLB `03-26`) hasn't come yet.

The season's name and every year come from the picks' dates (MLB `2026`, NBA `2026-27`).
Nothing needs changing from one year to the next.

Run `python shared/seasons.py` to see where every league stands.

## What gets archived, and where

The first workflow run that sees a season over writes `archive/<league>-<season>.json`
(for example `archive/mlb-2026.json`) and commits it. It holds the season's final records:
for MLB the game picks and the top hitters (with the share of all hitters who got a hit on the same days).
The file is never rewritten, so those numbers stay fixed even if old picks are re-graded.
The pick histories and the all-time records are not touched. They keep counting into next season.

`/archive.html` lists every archived season, newest first. `publish_site.sh` rebuilds it on every publish.

## What the site shows

- **Every page of that league's site** gets a "Season over" banner at the top. The
  banner has the final records, a link to the archive and when picks return
  (`chrome.page_top` adds it, so every sport gets it the same way). The MLB pages also drop
  their empty "today" sections and call the last day "the final day".
- **Home page, All tab:** a short "Season over" note above the record table. The league's
  row in the table (and the "MLB hitters" row) shows **Final** instead of a streak. Its
  league card is tagged "Season over" and says when it's back.
- **Home page, that league's tab:** the same note. Every record row shows Final, and the
  banner line says the season is archived.

The home page reads all of this from `/seasons.json`, which `publish_site.sh` writes on every publish.

## What the workflows skip

While a league is over **and** its next season is more than 10 days away, `seasons.py idle <league>` prints `yes`, and:

- `daily.yml` skips that league's pipeline, retrain (and for CBB the bracket) steps.
  The site build and publish still run every time, so the pages stay up and fresh.
- `weekly-picks.yml` skips the Vegas odds pulls (Odds API credits) for NFL or CFB.

If the season check itself fails, nothing is skipped.

## How the next season starts

Ten days before `next_start` the pipelines start running again. The first new pick is
recent, so the league is no longer over. The banner, notes and "Final" tags go away
on the next build, and the home page goes back to how it looks in season. Nothing to do by hand.

## Overriding by hand

In `shared/seasons.json`, set the league's `override`:

- `"over"` shows the season-over pages now and skips the daily work.
- `"in_season"` never treats it as over. Use this if a long break is ever mistaken for the end of the season.
- `"auto"` is the default and decides from the picks.

If a season starts earlier or later than usual, change `next_start`
(month-day, no year) and `next_label` (the words the site shows).
Commit to `main`. The next workflow run picks it up.
