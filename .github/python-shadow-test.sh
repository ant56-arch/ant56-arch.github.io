#!/usr/bin/env bash
# Weekly Python shadow test (.github/workflows/python-shadow-test.yml): runs one
# side of the site's pipelines step by step in two copies of the repo, one on
# the Python the live workflows use ($OLD) and one on the next version ($NEW),
# then diffs everything they wrote. Nothing is committed or published.
# Odds API fetches are left out to save credits; steps that read the odds use
# the lines already in the repo. CFBD's one data pull runs once on $OLD and is
# copied across.
set -uo pipefail
GROUP="$1"   # mlb-nba-cbb or nfl-cfb
A=/tmp/a; B=/tmp/b
rm -rf $A $B; cp -r "$GITHUB_WORKSPACE" $A; cp -r "$GITHUB_WORKSPACE" $B
export PYTHONDONTWRITEBYTECODE=1
for v in "$OLD" "$NEW"; do
  python$v -m venv /tmp/v$v
  if [ "$GROUP" = nfl-cfb ]; then reqs="-r requirements.txt"; else reqs="-r requirements.txt -r research/requirements.txt"; fi
  (cd $A/$GROUP && /tmp/v$v/bin/pip install -q $reqs) || { echo "::error::pip install failed on Python $v"; exit 1; }
  echo "Python $v: $(/tmp/v$v/bin/python -V)"; /tmp/v$v/bin/pip freeze
done
FAIL=0
run() { # run <version> <dir> <cmd...>; prints the exit code
  local v=$1 dir=$2; shift 2
  (cd $dir/$GROUP && PATH=/tmp/v$v/bin:$PATH "$@") > /tmp/log-$v.txt 2>&1
  echo $?
}
both() {
  echo "::group::$*"
  ra=$(run "$OLD" $A "$@"); rb=$(run "$NEW" $B "$@")
  echo "$OLD exit=$ra  $NEW exit=$rb"; tail -5 /tmp/log-$OLD.txt; echo ---; tail -5 /tmp/log-$NEW.txt
  echo "::endgroup::"
  if [ "$ra" != "$rb" ]; then echo "::error::exit codes differ ($OLD=$ra, $NEW=$rb) for: $*"; tail -30 /tmp/log-$NEW.txt; FAIL=1; fi
}
once() {
  echo "::group::(once on $OLD, copied) $*"
  touch /tmp/marker; sleep 1
  ra=$(run "$OLD" $A "$@"); echo "exit=$ra"; tail -5 /tmp/log-$OLD.txt
  (cd $A && find . -path ./.git -prune -o -type f -newer /tmp/marker -print) | while read -r f; do
    mkdir -p "$B/$(dirname "$f")"; cp "$A/$f" "$B/$f"; echo "copied $f"; done
  echo "::endgroup::"
}

if [ "$GROUP" = mlb-nba-cbb ]; then
  export FORCE=1   # make every retrain actually train
  both python predict.py
  both python nba/predict.py
  both python nba/research/train.py
  both python teams/predict.py
  both python teams/research/train.py
  both python nhl/predict.py
  both python nhl/research/train.py
  both python cbb/predict.py
  both python cbb/research/train.py
  both python soccer/predict.py
  both python soccer/research/experiments.py
  both python soccer/research/train.py
  once python research/pull_season_data.py
  both python research/train_model.py
  both python ../model_watch.py
  both python build_site.py
  both python nba/build_pages.py
  both python cbb/build_pages.py
  both python nhl/build_pages.py
  both python soccer/build_pages.py
else
  both python src/fetch_data.py
  both python src/fetch_injuries.py
  both python src/build_features.py
  both python src/build_defense_stats.py
  both python src/models/game_predictions.py
  both python src/models/props_predictions.py
  both python src/track_td_props.py
  both python src/models/compare_to_vegas.py
  both python src/sanity_checks.py
  both python src/track_results.py
  once python src/fetch_cfb_data.py
  both python src/build_cfb_features.py
  both python src/models/cfb_game_predictions.py
  both python src/models/compare_cfb_to_vegas.py
  both python src/track_cfb_results.py
  both python src/cfb_ratings.py
  both python src/build_site.py
  FORCE=1 both python src/fit_model.py
  both python src/fit_props_model.py
  FORCE=1 both python src/fit_td_model.py
  both python src/fit_cfb_model.py   # no FORCE: skips unless games finished since Tuesday's refit
fi

python3 "$GITHUB_WORKSPACE/.github/python-shadow-compare.py" $A $B "$OLD" "$NEW" "$GROUP"
exit $FAIL
