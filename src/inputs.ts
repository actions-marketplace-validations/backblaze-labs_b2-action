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
  const actionRaw = required('action').toLowerCase()
  if (!isActionName(actionRaw)) {
    throw new Error(
      `Invalid 'action' input: "${actionRaw}". Must be one of: ${VALID_ACTIONS.join(', ')}`,
    )
  }

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

  const compareModeRaw = (core.getInput('compare-mode') || 'modtime').toLowerCase()
  if (!isCompareMode(compareModeRaw)) {
    throw new Error(
      `Invalid 'compare-mode' input: "${compareModeRaw}". Must be one of: ${VALID_COMPARE.join(', ')}`,
    )
  }
  const keepModeRaw = (core.getInput('keep-mode') || 'no-delete').toLowerCase()
  if (!isKeepMode(keepModeRaw)) {
    throw new Error(
      `Invalid 'keep-mode' input: "${keepModeRaw}". Must be one of: ${VALID_KEEP.join(', ')}`,
    )
  }
  const syncDirectionRaw = (core.getInput('direction') || 'auto').toLowerCase()
  if (!isSyncDirection(syncDirectionRaw)) {
    throw new Error(
      `Invalid 'direction' input: "${syncDirectionRaw}". Must be one of: ${VALID_DIRECTION.join(', ')}`,
    )
  }

  const retentionModeRaw = optional('retention-mode')?.toLowerCase()
  if (retentionModeRaw !== undefined && !isRetentionMode(retentionModeRaw)) {
    throw new Error(
      `Invalid 'retention-mode' input: "${retentionModeRaw}". Must be one of: ${VALID_RETENTION_MODE.join(', ')}`,
    )
  }
  const legalHoldRaw = optional('legal-hold')?.toLowerCase()
  if (legalHoldRaw !== undefined && !isLegalHold(legalHoldRaw)) {
    throw new Error(
      `Invalid 'legal-hold' input: "${legalHoldRaw}". Must be one of: ${VALID_LEGAL_HOLD.join(', ')}`,
    )
  }

  return {
    action: actionRaw,
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
    compareMode: compareModeRaw,
    keepMode: keepModeRaw,
    syncDirection: syncDirectionRaw,
    maxResults,
    expectedSha1,
    retentionMode: retentionModeRaw,
    retentionUntil,
    legalHold: legalHoldRaw,
    bypassGovernance,
  }
}

function isCompareMode(value: string): value is CompareMode {
  return (VALID_COMPARE as readonly string[]).includes(value)
}

function isKeepMode(value: string): value is KeepMode {
  return (VALID_KEEP as readonly string[]).includes(value)
}

function isSyncDirection(value: string): value is SyncDirection {
  return (VALID_DIRECTION as readonly string[]).includes(value)
}

function isRetentionMode(value: string): value is RetentionMode {
  return (VALID_RETENTION_MODE as readonly string[]).includes(value)
}

function isLegalHold(value: string): value is LegalHold {
  return (VALID_LEGAL_HOLD as readonly string[]).includes(value)
}

function isActionName(value: string): value is ActionName {
  return (VALID_ACTIONS as readonly string[]).includes(value)
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
