#!/usr/bin/env bash
# Runs actionlint against the repo. If the binary isn't already on PATH, it
# downloads a version-pinned release archive, verifies its SHA-256 against the
# hard-coded checksum for the host platform, then extracts and caches it under
# node_modules/.cache/.
#
# Usage:
#   pnpm actionlint
#   bash scripts/actionlint.sh
#
# CI runs this same script (see .github/workflows/ci.yml), so the pinned version
# and checksums live in one place. We fetch the official release asset directly
# (no `curl | bash` bootstrap, no JS-wrapper Action) and verify it, so neither a
# mutable upstream branch nor a swapped release asset can run unverified code in
# CI or in the pre-commit hook.
#
# To bump actionlint: change ACTIONLINT_VERSION, then refresh CHECKSUMS from
#   https://github.com/rhysd/actionlint/releases/download/v<VER>/actionlint_<VER>_checksums.txt

set -euo pipefail

ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.12}"

# SHA-256 of each release archive, copied verbatim from the upstream
# checksums.txt for the pinned version. Keyed by `<os>_<arch>`.
# Refresh ALL of these on every version bump.
checksum_for() {
  case "$1" in
    darwin_amd64)  echo "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644" ;;
    darwin_arm64)  echo "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f" ;;
    linux_amd64)   echo "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" ;;
    linux_arm64)   echo "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6" ;;
    windows_amd64) echo "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9" ;;
    *) echo "" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else echo "need sha256sum or shasum to verify the actionlint download" >&2; exit 1; fi
}

# Detect platform (for the cached binary name and the release asset to fetch).
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT) os=windows ;;
  *) echo "unsupported OS for actionlint download: $os" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "unsupported arch for actionlint download: $arch" >&2; exit 1 ;;
esac
exe=""; [ "$os" = windows ] && exe=".exe"

# 1. Prefer an actionlint already on PATH (brew install actionlint, etc.).
BIN="$(command -v actionlint 2>/dev/null || true)"

# 2. Otherwise download (verified) into a local cache and use that.
if [ -z "$BIN" ]; then
  CACHE_DIR="$PWD/node_modules/.cache/actionlint"
  mkdir -p "$CACHE_DIR"
  BIN="$CACHE_DIR/actionlint${exe}"

  if [ ! -x "$BIN" ] || [ "$("$BIN" -version 2>/dev/null | head -n1 || true)" != "$ACTIONLINT_VERSION" ]; then
    key="${os}_${arch}"
    ext="tar.gz"; [ "$os" = windows ] && ext="zip"
    expected="$(checksum_for "$key")"
    if [ -z "$expected" ]; then
      echo "no pinned checksum for platform '$key'. Add it from" >&2
      echo "  https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt" >&2
      exit 1
    fi

    url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${key}.${ext}"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    echo "→ downloading actionlint v${ACTIONLINT_VERSION} (${key}) and verifying SHA-256"
    curl -fsSL -o "$tmp/asset" "$url"

    actual="$(sha256_of "$tmp/asset")"
    if [ "$actual" != "$expected" ]; then
      echo "actionlint checksum mismatch for ${key}:" >&2
      echo "  expected: $expected" >&2
      echo "  actual:   $actual" >&2
      exit 1
    fi

    if [ "$ext" = zip ]; then unzip -o -q "$tmp/asset" -d "$tmp"; else tar -xzf "$tmp/asset" -C "$tmp"; fi
    cp "$tmp/actionlint${exe}" "$BIN"
    chmod 0755 "$BIN"
  fi
fi

"$BIN" -color "$@"
