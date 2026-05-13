#!/usr/bin/env bash
# Runs actionlint against the repo. If the binary isn't installed, downloads
# it into node_modules/.cache/ on first run (cached thereafter).
#
# Usage:
#   pnpm actionlint
#   bash scripts/actionlint.sh
#
# CI uses the same `download-actionlint.bash` upstream script to avoid the
# `npm install` issue that the JS-wrapper actionlint Actions trip on (our
# `link:` SDK dep breaks npm).

set -euo pipefail

ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.12}"

# 1. If actionlint is on PATH (brew install actionlint, etc.), use it.
BIN="$(command -v actionlint 2>/dev/null || true)"

# 2. Otherwise, download to a local cache and use that.
if [ -z "$BIN" ]; then
  CACHE_DIR="$PWD/node_modules/.cache/actionlint"
  mkdir -p "$CACHE_DIR"
  BIN="$CACHE_DIR/actionlint"

  if [ ! -x "$BIN" ] || [ "$("$BIN" -version 2>/dev/null | head -n1 || true)" != "$ACTIONLINT_VERSION" ]; then
    echo "→ downloading actionlint v${ACTIONLINT_VERSION} to ${CACHE_DIR}"
    cd "$CACHE_DIR"
    bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash) \
      "$ACTIONLINT_VERSION" >/dev/null
    cd - >/dev/null
  fi
fi

"$BIN" -color "$@"
