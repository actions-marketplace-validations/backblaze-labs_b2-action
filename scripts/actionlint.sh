#!/usr/bin/env bash
# Runs actionlint against the repo using a version-pinned binary whose SHA-256
# is verified before EVERY run.
#
# Resolution order:
#   1. ACTIONLINT_USE_SYSTEM=1 -> use whatever `actionlint` is on PATH, as-is.
#      This is an explicit opt-out of pinning, for local convenience only; it is
#      never set in CI or the pre-commit hook.
#   2. Otherwise -> use a repo-managed binary cached under node_modules/.cache,
#      (re)downloading the pinned release asset if the cached binary is missing
#      or its SHA-256 does not match the hard-coded expected value. The binary
#      is checksum-verified on every invocation, so a planted or stale cache, a
#      tampered download, or a mutable upstream ref cannot run unverified code.
#
# Usage:
#   pnpm actionlint
#   bash scripts/actionlint.sh
#   ACTIONLINT_USE_SYSTEM=1 pnpm actionlint   # trust the system actionlint (opt-in)
#
# CI runs this same script (see .github/workflows/ci.yml).
#
# To bump actionlint: change ACTIONLINT_VERSION and regenerate every entry in
# binary_sha_for() (download each release asset, extract, sha256 the binary):
#   for k in darwin_amd64 darwin_arm64 linux_amd64 linux_arm64; do
#     curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v<VER>/actionlint_<VER>_$k.tar.gz" \
#       | tar -xzO actionlint | shasum -a 256
#   done

set -euo pipefail

# Pinned version. Intentionally NOT overridable: the checksums below are
# specific to it, so a bump must update both together.
ACTIONLINT_VERSION="1.7.12"

# SHA-256 of the EXTRACTED actionlint binary per platform (not the archive), so
# what we verify is the executable that actually runs. Regenerate on every bump.
binary_sha_for() {
  case "$1" in
    darwin_amd64)  echo "d1f7cee75ae2873609bd9567b4600bebc5315a5e733e73202987a44fafdd53b2" ;;
    darwin_arm64)  echo "8db11704dc296f096216db4db65d86cd7f0ebfdf4c38453a1da276b137b88388" ;;
    linux_amd64)   echo "c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4" ;;
    linux_arm64)   echo "ac0323433c2853ec3fb978c611430c5b3dc5d43c58d1a1ec031b00ab572beb60" ;;
    windows_amd64) echo "54ca21be3de4c7cfa26914aa8b61bd76bf573ef3caac5f80d110558cdf241718" ;;
    *) echo "" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else echo "need sha256sum or shasum to verify actionlint" >&2; exit 1; fi
}

# 1. Explicit opt-in to a system actionlint (not pinned, not verified).
if [ "${ACTIONLINT_USE_SYSTEM:-}" = "1" ]; then
  SYS="$(command -v actionlint 2>/dev/null || true)"
  [ -n "$SYS" ] || { echo "ACTIONLINT_USE_SYSTEM=1 but no actionlint on PATH" >&2; exit 1; }
  exec "$SYS" -color "$@"
fi

# 2. Repo-managed, checksum-verified binary.
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT) os=windows ;;
  *) echo "unsupported OS '$os' (set ACTIONLINT_USE_SYSTEM=1 to use a system binary)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "unsupported arch '$arch' (set ACTIONLINT_USE_SYSTEM=1)" >&2; exit 1 ;;
esac
exe=""; [ "$os" = windows ] && exe=".exe"
key="${os}_${arch}"
want="$(binary_sha_for "$key")"
if [ -z "$want" ]; then
  echo "no pinned actionlint checksum for platform '$key'." >&2
  echo "Add one (see the bump note in this script) or set ACTIONLINT_USE_SYSTEM=1." >&2
  exit 1
fi

CACHE_DIR="$PWD/node_modules/.cache/actionlint"
BIN="$CACHE_DIR/actionlint-${ACTIONLINT_VERSION}${exe}"

# (Re)download only when the cached binary is missing or fails verification.
if [ ! -x "$BIN" ] || [ "$(sha256_of "$BIN")" != "$want" ]; then
  mkdir -p "$CACHE_DIR"
  ext="tar.gz"; [ "$os" = windows ] && ext="zip"
  url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${key}.${ext}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "→ downloading actionlint v${ACTIONLINT_VERSION} (${key})"
  curl -fsSL -o "$tmp/asset" "$url"
  if [ "$ext" = zip ]; then unzip -o -q "$tmp/asset" -d "$tmp"; else tar -xzf "$tmp/asset" -C "$tmp"; fi
  cp "$tmp/actionlint${exe}" "$BIN"
  chmod 0755 "$BIN"
fi

# Verify before every use (covers both the cached and freshly-downloaded paths).
got="$(sha256_of "$BIN")"
if [ "$got" != "$want" ]; then
  echo "actionlint binary checksum mismatch for ${key}:" >&2
  echo "  expected: $want" >&2
  echo "  actual:   $got" >&2
  exit 1
fi

"$BIN" -color "$@"
