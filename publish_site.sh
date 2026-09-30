#!/usr/bin/env bash
# publish_site.sh [BUILT_DIR:SITE_DIR ...]
#
# Publishes to the `site` branch, which GitHub Pages serves at
# https://ant56-arch.github.io/. Each BUILT_DIR:SITE_DIR pair replaces that
# folder of the site with a freshly built one (dist/nfl:nfl, for example); a
# pair whose BUILT_DIR doesn't exist (its build failed) is skipped, so the
# site keeps that sport's last good pages. Every run also copies in the home
# page files from the root of this repo.
#
# Each sport's workflow publishes only its own folders, so one sport breaking
# can't take down another. The branch is kept at a single commit (the site is
# rebuilt on every run, so its history would only grow the repo), and a push
# that loses a race with another workflow's publish is retried on top of it.
set -euo pipefail

BRANCH=site
HOME_FILES=".nojekyll index.html bets.html home.js schedule.html schedule.js style.css terms.html privacy.html"

root=$(git rev-parse --show-toplevel)
git="git --git-dir=$root/.git"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for attempt in 1 2 3 4 5; do
  work="$tmp/site"
  rm -rf "$work"
  mkdir -p "$work"
  if $git fetch -q --depth=1 origin "$BRANCH" 2>/dev/null; then
    lease=$($git rev-parse FETCH_HEAD)
    $git archive FETCH_HEAD | tar -x -C "$work"
  else
    lease=""  # first publish: the branch doesn't exist yet
  fi

  for pair in "$@"; do
    src=${pair%%:*}
    dest=${pair#*:}
    if [ ! -d "$src" ]; then
      echo "Skipping $dest: $src wasn't built"
      continue
    fi
    rm -rf "${work:?}/$dest"
    mkdir -p "$work/$dest"
    cp -R "$src"/. "$work/$dest"/
    echo "Publishing $src as /$dest/"
  done
  for f in $HOME_FILES; do
    cp "$root/$f" "$work/$f"
  done

  export GIT_INDEX_FILE="$tmp/index"
  rm -f "$GIT_INDEX_FILE"
  (cd "$work" && $git --work-tree="$work" add -A -f .)
  tree=$($git write-tree)
  unset GIT_INDEX_FILE
  commit=$(git -c user.name="Sports Edge Bot" -c user.email="actions@github.com" \
    --git-dir="$root/.git" commit-tree "$tree" -m "Publish site $(TZ=America/New_York date '+%Y-%m-%d %H:%M')")

  if $git push -q --force-with-lease="refs/heads/$BRANCH:$lease" origin "$commit:refs/heads/$BRANCH"; then
    echo "Published to the $BRANCH branch"
    exit 0
  fi
  echo "Another publish landed first; retrying on top of it ($attempt)"
  sleep $((attempt * 3))
done
echo "Couldn't publish after 5 tries" >&2
exit 1
