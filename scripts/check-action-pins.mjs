#!/usr/bin/env node
/**
 * Fail if any third-party GitHub Action referenced under `.github/` is pinned
 * to a mutable ref (a tag like `@v1` / `@v1.2.3`, a branch like `@main`, or a
 * short SHA) instead of a full 40-character commit SHA.
 *
 * Why: a tag is mutable. Upstream (or anyone who can move the tag) can change
 * the code that runs in our workflows, including the `contents: write` release
 * job. A full commit SHA is immutable, so the referenced code cannot change
 * underneath us. Dependabot keeps the SHA pins (and their `# vN` comments)
 * up to date, so pinning costs nothing in maintenance.
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
 * `# comment` (so a pinned `@<sha> # v6` reads as just the SHA ref). Returns
 * the ref string or `null` when the line has no active `uses:` key (e.g. it is
 * fully commented out, or `uses:` only appears inside prose).
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
        if (name === OWN_ACTION || FULL_SHA.test(pin)) return
        violations.push({ where: `${relative(REPO, file)}:${i + 1}`, ref, pin })
      })
  }
}

if (violations.length > 0) {
  console.error('✗ Unpinned third-party action(s) (must use a full 40-char commit SHA):')
  for (const v of violations) {
    console.error(`    ${v.where}  ${v.ref}  (ref "${v.pin}" is not a commit SHA)`)
  }
  console.error('')
  console.error('Pin each to a commit SHA with a trailing version comment, e.g.:')
  console.error('    uses: actions/checkout@<sha> # v6')
  console.error('Resolve a tag to its SHA with:')
  console.error('    gh api repos/<owner>/<repo>/commits/<tag> -q .sha')
  process.exit(1)
}

console.log('✓ All third-party actions under .github/ are pinned to a full commit SHA.')
