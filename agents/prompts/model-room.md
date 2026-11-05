Scope: the Model Room tab (the owner-only page that shows every model inside and
out), and how all the models compare.

Read:
- model_room/build_model_room.py, number_versions.py, versions.json: how the page is built and how model versions are numbered
- shared/model_page.py, accuracy_page.py, versions.py, pick_moves.py: shared pieces it uses
- Every sport's model_history.json, picks_history.json and tracking files (nfl-cfb/data/tracking/, mlb-nba-cbb/*/)
- model_watch.json and model_watch.py: the cold-stretch alarms
- .github/workflows/model-room.yml, refit-model.yml, daily.yml, weekly-picks.yml: when things run

You are the one agent that sees every sport. Check that:
- every sport that has picks appears, and its numbers match its own log
- grades (Working / Mixed / Falling short) use the sample thresholds in the builder (MIN_N, GRADE_MIN_N, SMALL_N) and say so when a sample is thin
- versions and retrain dates agree with model_history.json and model_watch.json
- a model that looks off across sports (calibration, a sport falling behind) is flagged for that sport's agent to dig into
- the page would still make sense to Anthony at a glance
Recommend adjustments to the Model Room page and to how models are compared, not to individual sport models (those are the league agents' job; name them).
