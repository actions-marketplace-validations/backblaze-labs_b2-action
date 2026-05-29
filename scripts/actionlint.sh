#!/usr/bin/env bash
# Runs actionlint against the repo. If the binary isn't installed, downloads
# it into node_modules/.cache/ on first run (cached thereafter).
#
# Usage:
#   pnpm actionlint
#   bash scripts/actionlint.sh
#
# CI runs this same script (see .github/workflows/ci.yml), so the pinned
# downloader commit and the actionlint version live in one place. We fetch the
# binary rather than use a JS-wrapper Action to keep the actionlint job
# dependency-free.

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
    # Bootstrap downloader pinned to the commit behind the actionlint v1.7.12
    # tag (not `main`) so CI never executes code from a mutable upstream ref.
    # The downloader verifies the release asset's SHA-256 before extracting.
    # Bump this SHA together with ACTIONLINT_VERSION above.
    DL_SHA="914e7df21a07ef503a81201c76d2b11c789d3fca" # actionlint v1.7.12
    bash <(curl -fsSL "https://raw.githubusercontent.com/rhysd/actionlint/${DL_SHA}/scripts/download-actionlint.bash") \
      "$ACTIONLINT_VERSION" >/dev/null
    cd - >/dev/null
  fi
fi

"$BIN" -color "$@"
