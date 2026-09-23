# Sports Edge home page

The home page at https://ant56-arch.github.io/, linking every Edge site:

- NFL Edge and CFB Edge: https://ant56-arch.github.io/nfl-edge/ (repo `ant56-arch/nfl-edge`)
- MLB Edge: https://ant56-arch.github.io/mlb-hit-predictor/ (repo `ant56-arch/mlb-hit-predictor`)
- NBA Edge: https://ant56-arch.github.io/mlb-hit-predictor/nba/ (built in the same repo, under `nba/`)

Each card fills in from that site's `summary.json`, which its own build
publishes next to its pages (`/nfl-edge/nfl/summary.json`,
`/nfl-edge/cfb/summary.json`, `/mlb-hit-predictor/summary.json`,
`/mlb-hit-predictor/nba/summary.json`). This repo is
plain static files with no build step; GitHub Pages serves it from `main`.
