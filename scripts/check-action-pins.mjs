#!/usr/bin/env node
/**
 * Enforce the workflow action-pinning convention for third-party actions under
 * `.github/`:
 *
 *   1. The ref must be a full 40-character commit SHA, never a mutable ref (a
 *      tag like `@v1` / `@v1.2.3`, a branch like `@main`, or a short SHA).
 *   2. The `uses:` line must carry a trailing exact-version comment (`# vX.Y.Z`)
 *      naming the release the SHA represents, so a reviewer can confirm it at a
 *      glance and Dependabot can keep both in sync.
 *
 * Why: a tag is mutable. Upstream (or anyone who can move the tag) can change
 * the code that runs in our workflows, including the `contents: write` release
 * job. A full commit SHA is immutable; the comment keeps it auditable.
 *
 * Scope and exemptions:
 *   - Scans `.github/workflows/` and `.github/actions/` for *.yml / *.yaml.
 *   - Skips local refs (`./`, `../`) and `docker://` refs.
 *   - Skips the repo's own action (referenced as `uses: ./` in workflows).
 *   - Skips `uses:` that appear inside a YAML comment.
 *
 * Run with:  pnpm lint:actions
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const OWN_ACTION = 'backblaze-labs/b2-action'
const FULL_SHA = /^[0-9a-f]{40}$/
const EXACT_VERSION = /\bv\d+\.\d+\.\d+\b/
const SCAN_DIRS = ['.github/workflows', '.github/actions']

/** Recursively collect *.yml / *.yaml files under `dir` (absolute path). */
function collectYaml(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectYaml(full))
    else if (/\.ya?ml$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Extract the action reference from a `uses:` step line, ignoring any trailing
 * `# comment` (so a pinned `@<sha> # v6.0.2` reads as just the SHA ref).
 * Returns the ref string or `null` when the line has no active `uses:` key
 * (e.g. it is fully commented out, or `uses:` only appears inside prose).
 */
function usesRefFromLine(line) {
  const code = line.split('#')[0]
  const m = code.match(/^\s*-?\s*uses:\s*['"]?([^'"\s]+)/)
  return m ? m[1] : null
}

const violations = []

for (const rel of SCAN_DIRS) {
  for (const file of collectYaml(join(REPO, rel))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const ref = usesRefFromLine(line)
        if (ref === null) return
        if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('docker://')) return
        if (!ref.includes('@')) return
        const name = ref.slice(0, ref.lastIndexOf('@'))
        const pin = ref.slice(ref.lastIndexOf('@') + 1)
        if (name === OWN_ACTION) return

        const where = `${relative(REPO, file)}:${i + 1}`
        if (!FULL_SHA.test(pin)) {
          violations.push({ where, ref, reason: `ref "${pin}" is not a full 40-char commit SHA` })
          return
        }
        // SHA-pinned: require an exact-version comment so the pin is auditable.
        const hash = line.indexOf('#')
        const comment = hash === -1 ? '' : line.slice(hash + 1)
        if (!EXACT_VERSION.test(comment)) {
          violations.push({
            where,
            ref,
            reason: 'missing exact-version comment (expected `# vX.Y.Z`)',
          })
        }
      })
  }
}

if (violations.length > 0) {
  console.error('✗ Action pinning violation(s):')
  for (const v of violations) {
    console.error(`    ${v.where}  ${v.ref}  ${v.reason}`)
  }
  console.error('')
  console.error('Each third-party action must be pinned to a full commit SHA with an')
  console.error('exact-version comment, e.g.:')
  console.error('    uses: actions/checkout@<sha> # v6.0.2')
  console.error('Resolve a tag to its SHA with:')
  console.error('    gh api repos/<owner>/<repo>/commits/<tag> -q .sha')
  process.exit(1)
}

console.log(
  '✓ All third-party actions under .github/ are SHA-pinned with an exact-version comment.',
)
