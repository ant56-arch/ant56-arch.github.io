# Sports Edge

Every Sports Edge site, in one repo, published at https://ant56-arch.github.io/:

| Site | Address | Code |
| --- | --- | --- |
| Home page and Schedule | https://ant56-arch.github.io/ | the files at the root of this repo |
| NFL Edge | https://ant56-arch.github.io/nfl/ | `nfl-cfb/` |
| CFB Edge | https://ant56-arch.github.io/cfb/ | `nfl-cfb/` |
| MLB Edge | https://ant56-arch.github.io/mlb/ | `mlb-nba-cbb/` |
| NBA Edge | https://ant56-arch.github.io/nba/ | `mlb-nba-cbb/nba/` |
| CBB Edge | https://ant56-arch.github.io/cbb/ | `mlb-nba-cbb/cbb/` |

`nfl-cfb/` was the `ant56-arch/nfl-edge` repo and `mlb-nba-cbb/` was
`ant56-arch/mlb-hit-predictor`; both came in with their full history. Their
old addresses (`/nfl-edge/...` and `/mlb-hit-predictor/...`) redirect here.

## How it's published

GitHub Pages serves the `site` branch. Nobody edits that branch by hand:
`publish_site.sh` rebuilds it.

- `.github/workflows/weekly-picks.yml` runs the NFL and CFB pipelines in
  `nfl-cfb/` and publishes `/nfl/` and `/cfb/`.
- `.github/workflows/daily.yml` runs the MLB, NBA and CBB pipelines in
  `mlb-nba-cbb/` and publishes `/mlb/`, `/nba/` and `/cbb/`.
- `.github/workflows/publish-home.yml` publishes the home page files whenever
  they change on `main`. Every other publish copies them in too.

Each workflow publishes only its own sports' folders, so one sport failing
can't take another down; a sport whose build fails keeps its last pages up.

## Shared code

`shared/` holds the one copy of what every site uses: the base stylesheet
(`base.css`), the score ticker, settings and phone menu (`edge.js`), and the
Python the builders import (`games.py`, `extras.py`, `model_page.py`).
`shared/assets.py` puts each site's `style.css` and script together from those
plus the site's own part (`home-page.css`/`home-page.js` for the home page,
`web/sport.css`/`web/sport.js` in each sport folder). Change the shared files
once and every site picks it up on its next publish.

The home page is static files; `publish_site.sh` adds its `style.css` and
`home.js` from `shared/assets.py`. Each card fills in
from the `summary.json` each site publishes next to its pages
(`/nfl/summary.json`, `/cfb/summary.json`, `/mlb/summary.json`,
`/nba/summary.json`, `/cbb/summary.json`), and the scoreboard strip and
Schedule tab read each sport's `games.json`.

The workflows' secrets (`ODDS_API_KEY` for betting lines and `CFBD_API_KEY`
for college football data) are set in this repo's settings.
