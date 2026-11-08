League: NFL. Tab: NFL Edge (https://ant56-arch.github.io/nfl/).

Read:
- nfl-cfb/web/ and nfl-cfb/src/build_site.py: how the tab is built
- nfl-cfb/src/models/ and nfl-cfb/src/fit_model.py, fit_common.py, model_guard.py: the model
- nfl-cfb/data/tracking/predictions_log.csv, accuracy_summary.json, pick_moves.json, model_history.json, td_props_log.csv, td_props_summary.json: live results
- model_watch.json (key nfl), shared/seasons.json, shared/*.py as needed
The NFL model refits after every week of games, so a cold-stretch alarm is a heads-up, not a reason to retrain.
