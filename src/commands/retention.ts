import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import { findFileByName } from '../client.ts'
import { type ParsedInputs, requireSource } from '../inputs.ts'

export interface RetentionResult {
  fileName: string
  fileId: string
  appliedMode: 'compliance' | 'governance' | 'none' | undefined
  retainUntilTimestamp: number | null | undefined
  appliedLegalHold: 'on' | 'off' | undefined
}

/**
 * Apply Object Lock retention settings and/or a legal hold to a specific
 * file version.
 *
 * The bucket must have Object Lock enabled. Three inputs drive this command:
 *   - `retention-mode`: `compliance` | `governance` | `none`. Required if
 *     `retention-until` is set.
 *   - `retention-until`: ISO 8601 timestamp (e.g. `2027-01-01T00:00:00Z`).
 *     Required if `retention-mode` is `compliance` or `governance`.
 *   - `legal-hold`: `on` | `off`. Independent of retention; can be set on
 *     its own or alongside retention.
 *   - `bypass-governance` (bool): allows shortening a governance retention.
 *
 * At least one of `retention-mode` / `legal-hold` must be supplied.
 *
 * The target file version is resolved by name (latest visible version).
 */
export async function retentionCommand(
  bucket: Bucket,
  inputs: ParsedInputs,
): Promise<RetentionResult> {
  const source = requireSource(inputs.source, 'retention', 'the B2 file name')

  const mode = inputs.retentionMode
  const until = inputs.retentionUntil
  const legalHold = inputs.legalHold

  if (mode === undefined && legalHold === undefined) {
    throw new Error("retention requires at least one of 'retention-mode' or 'legal-hold' to be set")
  }

  if (mode === 'compliance' || mode === 'governance') {
    if (until === undefined) {
      throw new Error(
        `'retention-until' (ISO 8601 timestamp) is required when 'retention-mode' is '${mode}'`,
      )
    }
  }

  // Resolve the file version we're operating on.
  const hit = await findFileByName(bucket, source)

  let appliedMode: RetentionResult['appliedMode']
  let retainUntilTimestamp: number | null | undefined
  let appliedLegalHold: RetentionResult['appliedLegalHold']

  core.startGroup(`retention b2://${bucket.name}/${source}`)
  try {
    if (mode !== undefined) {
      const retainUntilMillis =
        mode === 'none' ? null : until !== undefined ? Date.parse(until) : null
      if (mode !== 'none' && (retainUntilMillis === null || Number.isNaN(retainUntilMillis))) {
        throw new Error(`'retention-until' is not a valid ISO 8601 timestamp: "${until}"`)
      }
      const result = await bucket.updateFileRetention(source, hit.fileId, {
        mode: mode === 'none' ? null : mode,
        retainUntilTimestamp: retainUntilMillis,
      })
      appliedMode = mode
      retainUntilTimestamp = result.fileRetention.retainUntilTimestamp
      core.info(`  retention: mode=${mode} retainUntil=${retainUntilMillis}`)
    }

    if (legalHold !== undefined) {
      const result = await bucket.updateFileLegalHold(source, hit.fileId, legalHold)
      appliedLegalHold = result.legalHold
      core.info(`  legal-hold: ${result.legalHold}`)
    }

    return {
      fileName: source,
      fileId: hit.fileId,
      appliedMode,
      retainUntilTimestamp,
      appliedLegalHold,
    }
  } finally {
    core.endGroup()
  }
}
