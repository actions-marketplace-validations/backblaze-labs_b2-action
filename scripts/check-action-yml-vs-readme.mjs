#!/usr/bin/env node
/**
 * Verify that every input and output declared in `action.yml` appears in
 * `README.md`'s "Inputs (full reference)" and "Outputs (full reference)"
 * tables. Catches the common "added a new input, forgot to document it"
 * drift mode.
 *
 * The action.yml parser is regex-based (no external YAML dep) because
 * the file's shape is well-known and stable:
 *
 *   inputs:
 *     <name>:
 *       description: ...
 *   outputs:
 *     <name>:
 *       description: ...
 *
 * Run with:  pnpm docs:check-action-yml
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const actionYml = readFileSync(join(REPO, 'action.yml'), 'utf8')
const readme = readFileSync(join(REPO, 'README.md'), 'utf8')

/**
 * Extract top-level keys from a section of action.yml. Looks for the
 * `^section:` header, then every `^  <name>:` line until the next
 * top-level key.
 */
function extractActionYmlKeys(section) {
  const start = actionYml.search(new RegExp(`^${section}:\\s*$`, 'm'))
  if (start === -1) return []
  const rest = actionYml.slice(start + section.length + 1)
  const end = rest.search(/^[a-z]+:\s*$/m)
  const body = end === -1 ? rest : rest.slice(0, end)
  const keys = []
  for (const line of body.split('\n')) {
    const m = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/)
    if (m) keys.push(m[1])
  }
  return keys
}

const declaredInputs = extractActionYmlKeys('inputs')
const declaredOutputs = extractActionYmlKeys('outputs')

/**
 * Extract the set of `key` names appearing in the first column of a
 * markdown table that sits under the given heading.
 */
function extractKeysFromSection(heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[()]/g, '\\$&')}.*$`, 'm')
  const start = readme.search(re)
  if (start === -1) {
    throw new Error(`Heading not found in README.md: ${heading}`)
  }
  const rest = readme.slice(start + 1)
  const end = rest.search(/^##\s+/m)
  const section = end === -1 ? rest : rest.slice(0, end)
  const keys = new Set()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|---')) continue
    const first = line.split('|')[1] ?? ''
    const match = first.match(/`([^`]+)`/)
    if (match) keys.add(match[1])
  }
  return keys
}

const readmeInputs = extractKeysFromSection('Inputs (full reference)')
const readmeOutputs = extractKeysFromSection('Outputs (full reference)')

const missingFromReadmeInputs = declaredInputs.filter((k) => !readmeInputs.has(k))
const missingFromReadmeOutputs = declaredOutputs.filter((k) => !readmeOutputs.has(k))
const orphanedInReadmeInputs = [...readmeInputs].filter((k) => !declaredInputs.includes(k))
const orphanedInReadmeOutputs = [...readmeOutputs].filter((k) => !declaredOutputs.includes(k))

let failed = false
function report(label, missing, orphaned) {
  if (missing.length > 0) {
    failed = true
    console.error(`✗ ${label}: in action.yml but missing from README:`)
    for (const k of missing) console.error(`    - ${k}`)
  }
  if (orphaned.length > 0) {
    failed = true
    console.error(`✗ ${label}: in README but not declared in action.yml:`)
    for (const k of orphaned) console.error(`    - ${k}`)
  }
}

report('Inputs', missingFromReadmeInputs, orphanedInReadmeInputs)
report('Outputs', missingFromReadmeOutputs, orphanedInReadmeOutputs)

if (failed) {
  console.error('')
  console.error('action.yml is the source of truth. Either add the missing entries to README.md,')
  console.error('or remove the orphans from README.md, then re-run `pnpm docs:check-action-yml`.')
  process.exit(1)
}

console.log(
  `✓ ${declaredInputs.length} inputs and ${declaredOutputs.length} outputs aligned across action.yml and README.md.`,
)
