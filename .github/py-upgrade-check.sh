#!/usr/bin/env bash
# TEMPORARY (removed before merge): runs each sport's pipeline step by step in
# two copies of the repo, one on Python 3.11 and one on 3.12, then diffs them.
# Paid/quota'd fetches run once on 3.11 and their new files are copied across.
set -uo pipefail
GROUP="$1"   # mlb-nba-cbb or nfl-cfb
A=/tmp/a; B=/tmp/b
rm -rf $A $B; cp -r "$GITHUB_WORKSPACE" $A; cp -r "$GITHUB_WORKSPACE" $B
for v in 3.11 3.12; do
  python$v -m venv /tmp/v$v
  if [ "$GROUP" = nfl-cfb ]; then reqs="-r requirements.txt"; else reqs="-r requirements.txt -r research/requirements.txt"; fi
  (cd $A/$GROUP && /tmp/v$v/bin/pip install -q $reqs) || { echo "::error::pip install failed on $v"; exit 1; }
  echo "Python $v: $(/tmp/v$v/bin/python -V)"; /tmp/v$v/bin/pip freeze
done
FAIL=0
run() { # run <python> <dir> <cmd...>
  local py=$1 dir=$2; shift 2
  (cd $dir/$GROUP && PATH=/tmp/v$py/bin:$PATH "$@") > /tmp/log-$py.txt 2>&1
  echo $?
}
both() {
  echo "::group::$*"
  ra=$(run 3.11 $A "$@"); rb=$(run 3.12 $B "$@")
  echo "3.11 exit=$ra  3.12 exit=$rb"; tail -5 /tmp/log-3.11.txt; echo ---; tail -5 /tmp/log-3.12.txt
  echo "::endgroup::"
  if [ "$ra" != "$rb" ]; then echo "::error::exit codes differ for: $*"; FAIL=1; fi
}
once() {
  echo "::group::(once on 3.11, copied) $*"
  touch /tmp/marker; sleep 1
  ra=$(run 3.11 $A "$@"); echo "exit=$ra"; tail -5 /tmp/log-3.11.txt
  (cd $A && find . -path ./.git -prune -o -type f -newer /tmp/marker -print) | while read -r f; do
    mkdir -p "$B/$(dirname "$f")"; cp "$A/$f" "$B/$f"; echo "copied $f"; done
  echo "::endgroup::"
}

if [ "$GROUP" = mlb-nba-cbb ]; then
  export FORCE=1
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
  once python src/fetch_odds.py
  both python src/models/game_predictions.py
  both python src/models/props_predictions.py
  once python src/fetch_td_odds.py
  both python src/track_td_props.py
  both python src/models/compare_to_vegas.py
  both python src/sanity_checks.py
  both python src/track_results.py
  once python src/fetch_cfb_data.py
  both python src/build_cfb_features.py
  once python src/fetch_cfb_odds.py
  both python src/models/cfb_game_predictions.py
  both python src/models/compare_cfb_to_vegas.py
  both python src/track_cfb_results.py
  both python src/cfb_ratings.py
  both python src/build_site.py
  FORCE=1 both python src/fit_model.py
  both python src/fit_props_model.py
  FORCE=1 both python src/fit_td_model.py
  FORCE=1 both python src/fit_cfb_model.py
fi

echo "=== Files that differ between 3.11 and 3.12 ==="
diff -rq -x .git $A $B | tee /tmp/diffs.txt
diff -r -x .git $A $B | head -400
[ -s /tmp/diffs.txt ] && echo "::warning::$(wc -l < /tmp/diffs.txt) files differ (see log)"
exit $FAIL
