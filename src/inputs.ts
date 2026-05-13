import * as core from '@actions/core'
import type { EncryptionSetting } from '@backblaze/b2-sdk'
import { parseSse } from './sse.ts'

export type ActionName =
  | 'upload'
  | 'download'
  | 'sync'
  | 'copy'
  | 'delete'
  | 'presign'
  | 'list'
  | 'hide'
  | 'unhide'
  | 'verify'
  | 'retention'
  | 'head'
  | 'purge'

const VALID_ACTIONS: readonly ActionName[] = [
  'upload',
  'download',
  'sync',
  'copy',
  'delete',
  'presign',
  'list',
  'hide',
  'unhide',
  'verify',
  'retention',
  'head',
  'purge',
]

export type CompareMode = 'modtime' | 'size' | 'none'
export type KeepMode = 'no-delete' | 'delete' | 'keep-days'
export type SyncDirection = 'auto' | 'up' | 'down'
export type RetentionMode = 'compliance' | 'governance' | 'none'
export type LegalHold = 'on' | 'off'

const VALID_COMPARE: readonly CompareMode[] = ['modtime', 'size', 'none']
const VALID_KEEP: readonly KeepMode[] = ['no-delete', 'delete', 'keep-days']
const VALID_DIRECTION: readonly SyncDirection[] = ['auto', 'up', 'down']
const VALID_RETENTION_MODE: readonly RetentionMode[] = ['compliance', 'governance', 'none']
const VALID_LEGAL_HOLD: readonly LegalHold[] = ['on', 'off']

export interface ParsedInputs {
  action: ActionName
  applicationKeyId: string
  applicationKey: string
  bucket: string
  sourceBucket: string | undefined
  source: string | undefined
  destination: string | undefined
  include: string[]
  exclude: string[]
  concurrency: number
  partSize: number | undefined
  resume: boolean
  contentType: string | undefined
  dryRun: boolean
  presignTtlSeconds: number
  endpoint: string | undefined
  failOnEmpty: boolean
  sse: string | undefined
  encryption: EncryptionSetting | undefined
  compareMode: CompareMode
  keepMode: KeepMode
  syncDirection: SyncDirection
  maxResults: number
  expectedSha1: string | undefined
  retentionMode: RetentionMode | undefined
  retentionUntil: string | undefined
  legalHold: LegalHold | undefined
  bypassGovernance: boolean
}

/**
 * Parse and validate inputs.
 *
 * Credentials lookup order:
 *
 *   1. `application-key-id` / `application-key` action inputs
 *   2. `B2_APPLICATION_KEY_ID` / `B2_APPLICATION_KEY` env vars — the official
 *      contract used by the Backblaze b2 CLI and the @backblaze/b2-sdk.
 *
 * The credential value, once resolved, is immediately masked via `core.setSecret`
 * so any accidental echo (including from a misbehaving sub-process) is redacted
 * in workflow logs.
 */
export function parseInputs(): ParsedInputs {
  const action = parseEnum('action', required('action').toLowerCase(), VALID_ACTIONS)

  const applicationKeyId = resolveCredential('application-key-id', 'B2_APPLICATION_KEY_ID')
  const applicationKey = resolveCredential('application-key', 'B2_APPLICATION_KEY')
  core.setSecret(applicationKey)

  const bucket = required('bucket')
  const sourceBucket = optional('source-bucket')
  const source = optional('source')
  const destination = optional('destination')

  const include = splitCsv(optional('include'))
  const exclude = splitCsv(optional('exclude'))

  const concurrency = parsePositiveInt('concurrency', core.getInput('concurrency') || '4')
  const partSizeInput = optional('part-size')
  const partSize =
    partSizeInput !== undefined ? parsePositiveInt('part-size', partSizeInput) : undefined

  const resume = parseBool('resume', core.getInput('resume') || 'true')
  const dryRun = parseBool('dry-run', core.getInput('dry-run') || 'false')
  const failOnEmpty = parseBool('fail-on-empty', core.getInput('fail-on-empty') || 'true')
  const bypassGovernance = parseBool(
    'bypass-governance',
    core.getInput('bypass-governance') || 'false',
  )

  const presignTtlSeconds = parsePositiveInt('presign-ttl', core.getInput('presign-ttl') || '3600')
  const maxResults = parsePositiveInt('max-results', core.getInput('max-results') || '1000')

  const contentType = optional('content-type')
  const endpoint = optional('endpoint')
  const sse = optional('sse')
  const encryption = parseSse(sse)
  const expectedSha1 = optional('expected-sha1')
  const retentionUntil = optional('retention-until')

  const compareMode = parseEnum(
    'compare-mode',
    (core.getInput('compare-mode') || 'modtime').toLowerCase(),
    VALID_COMPARE,
  )
  const keepMode = parseEnum(
    'keep-mode',
    (core.getInput('keep-mode') || 'no-delete').toLowerCase(),
    VALID_KEEP,
  )
  const syncDirection = parseEnum(
    'direction',
    (core.getInput('direction') || 'auto').toLowerCase(),
    VALID_DIRECTION,
  )
  const retentionMode = parseOptionalEnum(
    'retention-mode',
    optional('retention-mode')?.toLowerCase(),
    VALID_RETENTION_MODE,
  )
  const legalHold = parseOptionalEnum(
    'legal-hold',
    optional('legal-hold')?.toLowerCase(),
    VALID_LEGAL_HOLD,
  )

  return {
    action,
    applicationKeyId,
    applicationKey,
    bucket,
    sourceBucket,
    source,
    destination,
    include,
    exclude,
    concurrency,
    partSize,
    resume,
    contentType,
    dryRun,
    presignTtlSeconds,
    endpoint,
    failOnEmpty,
    sse,
    encryption,
    compareMode,
    keepMode,
    syncDirection,
    maxResults,
    expectedSha1,
    retentionMode,
    retentionUntil,
    legalHold,
    bypassGovernance,
  }
}

/**
 * Validate that `inputs.source` is set and non-empty, returning the value.
 * Throws a uniform error message naming the verb so the workflow log surfaces
 * exactly what's missing. Commands that allow an empty-string source for
 * special semantics (e.g. `purge` with explicit whole-bucket scope) should
 * not use this helper.
 */
export function requireSource(
  source: string | undefined,
  verb: string,
  description?: string,
): string {
  if (source === undefined || source === '') {
    const tail = description !== undefined ? ` (${description})` : ''
    throw new Error(`'source' input is required for '${verb}' action${tail}`)
  }
  return source
}

/**
 * Validate that `raw` is one of `valid`, narrowing the return type.
 *
 * Replaces the previous pattern of one type-guard + one throw per enum:
 *
 *   const x = parseEnum('compare-mode', raw, VALID_COMPARE)
 *
 * Throws a uniform error message that lists the legal values.
 */
function parseEnum<T extends string>(name: string, raw: string, valid: readonly T[]): T {
  if ((valid as readonly string[]).includes(raw)) return raw as T
  throw new Error(`Invalid '${name}' input: "${raw}". Must be one of: ${valid.join(', ')}`)
}

/**
 * Like {@link parseEnum} but passes through `undefined`. Used for inputs that
 * are optional but, when set, must be one of a known set.
 */
function parseOptionalEnum<T extends string>(
  name: string,
  raw: string | undefined,
  valid: readonly T[],
): T | undefined {
  return raw === undefined ? undefined : parseEnum(name, raw, valid)
}

function required(name: string): string {
  const v = core.getInput(name, { required: true })
  if (!v) throw new Error(`Missing required input: ${name}`)
  return v
}

function optional(name: string): string | undefined {
  const v = core.getInput(name)
  return v === '' ? undefined : v
}

function resolveCredential(inputName: string, envName: string): string {
  const fromInput = optional(inputName)
  if (fromInput !== undefined) return fromInput

  const fromEnv = process.env[envName]
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv

  throw new Error(`Missing credential: set input '${inputName}' or env var '${envName}'`)
}

function splitCsv(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseBool(name: string, raw: string): boolean {
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  throw new Error(`Invalid boolean for '${name}': "${raw}"`)
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid positive integer for '${name}': "${raw}"`)
  }
  return n
}
