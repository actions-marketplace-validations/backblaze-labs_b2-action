import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface PurgedFile {
  fileName: string
  fileId: string
  action: 'upload' | 'hide' | 'skip'
  skipped: boolean
}

export interface PurgeResult {
  files: PurgedFile[]
  errors: number
}

/**
 * Permanently delete every file version (including hide markers and historic
 * uploads) under a prefix. Differs from `delete` in that `delete`'s
 * implementation streams over `listFileVersions` and removes all versions,
 * but `purge` makes the wipe-the-prefix intent explicit and warns loudly.
 *
 * If `source` is empty or `/`, this purges the **entire bucket**, and
 * we require `dry-run: false` to be set _intentionally_ to do so. (Default
 * behavior is to refuse a bucket-wide purge unless `source` is explicitly
 * an empty string in inputs, not undefined.)
 *
 * Supports `dry-run` to preview what would be deleted.
 */
export async function purgeCommand(bucket: Bucket, inputs: ParsedInputs): Promise<PurgeResult> {
  // Normalize: treat undefined source as "missing" to avoid accidental bucket-wide purges.
  if (inputs.source === undefined) {
    throw new Error(
      "'source' input is required for 'purge' (use empty string explicitly for whole-bucket purge)",
    )
  }
  const prefix =
    inputs.source.endsWith('/') || inputs.source === '' ? inputs.source : `${inputs.source}/`
  const dryRun = inputs.dryRun

  if (prefix === '' && !dryRun) {
    core.warning(
      `purge will permanently delete EVERY version in bucket "${bucket.name}". Continuing because dry-run is false.`,
    )
  }

  const files: PurgedFile[] = []
  let errors = 0

  core.startGroup(`${dryRun ? 'dry-run' : 'purge'} b2://${bucket.name}/${prefix} (all versions)`)
  try {
    const opts = {
      ...(prefix !== '' ? { prefix } : {}),
      dryRun,
    }
    for await (const event of bucket.deleteAll(opts)) {
      if (event.type === 'delete') {
        files.push({
          fileName: event.fileName,
          fileId: event.fileId,
          action: 'upload',
          skipped: false,
        })
        core.info(`  purged ${event.fileName} (${event.fileId})`)
      } else if (event.type === 'skip') {
        files.push({
          fileName: event.fileName,
          fileId: event.fileId,
          action: 'skip',
          skipped: true,
        })
        core.info(`  would purge ${event.fileName} (${event.fileId})`)
      } else {
        errors++
        core.warning(`  failed to purge ${event.fileName}: ${event.message}`)
      }
    }
  } finally {
    core.endGroup()
  }

  return { files, errors }
}
