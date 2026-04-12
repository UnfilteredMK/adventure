#!/bin/sh
# Installs from monorepo root (package-lock.json). Safe on Vercel (no bash required).
set -eu
if ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
  cd "$ROOT"
else
  d="$PWD"
  while [ ! -f "$d/package-lock.json" ] && [ "$d" != "/" ]; do
    d=$(dirname "$d")
  done
  cd "$d"
fi
if [ ! -f package-lock.json ]; then
  echo "vercel-npm-ci: no package-lock.json in $(pwd)" >&2
  exit 1
fi
if ! npm ci --no-audit --no-fund; then
  echo "vercel-npm-ci: npm ci failed; running npm install" >&2
  npm install --no-audit --no-fund
fi
