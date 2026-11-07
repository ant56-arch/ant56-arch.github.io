#!/usr/bin/env bash
# seal.sh lock|open DIR - locks or opens the agents' reports with the Model
# Room password (REPORT_KEY), so the run files GitHub keeps between jobs never
# hold a readable report (the repo is public, and so are its run files).
#   lock: each DIR/*.md becomes DIR/*.md.enc, and the readable copy is deleted.
#   open: each DIR/*.md.enc becomes DIR/*.md again.
# With no password set, lock deletes the reports (the page then says "not set
# up", as lock_page.mjs does) and open does nothing. Never fails the run.
set -uo pipefail
mode=$1
dir=$2
[ -d "$dir" ] || exit 0
opts=(-aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:REPORT_KEY)

if [ "$mode" = lock ]; then
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    if [ -n "${REPORT_KEY:-}" ]; then
      openssl enc -e -salt "${opts[@]}" -in "$f" -out "$f.enc" || rm -f "$f.enc"
    fi
    rm -f "$f"
  done
elif [ "$mode" = open ]; then
  [ -n "${REPORT_KEY:-}" ] || exit 0
  for f in "$dir"/*.md.enc; do
    [ -e "$f" ] || continue
    openssl enc -d "${opts[@]}" -in "$f" -out "${f%.enc}" || rm -f "${f%.enc}"
    rm -f "$f"
  done
fi
exit 0
