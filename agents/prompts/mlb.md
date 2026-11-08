League: MLB (hitter picks and game picks). Tab: MLB Edge (https://ant56-arch.github.io/mlb/).

Read:
- mlb-nba-cbb/web/, build_site.py, team_pages.py: how the tab is built
- mlb-nba-cbb/predict.py, features.py, train_common.py, model_weights.json, model_history.json, picks_history.json: the hitter model and its results
- mlb-nba-cbb/teams/ (model.py, predict.py, model_history.json, picks_history.json, pick_moves.json): the game model
- mlb-nba-cbb/statcast/ and research/: inputs and training
- model_watch.json (keys mlb_hits, mlb_games), shared/seasons.json
If MLB's season is over, say so in one line and review only whether the tab's end-of-season state and archive/mlb-*.json look right.
