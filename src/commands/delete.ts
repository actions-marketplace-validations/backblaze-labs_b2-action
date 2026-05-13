import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import { findFileByName } from '../client.ts'
import { type ParsedInputs, requireSource } from '../inputs.ts'

/** One entry in {@link DeleteResult.files}. */
export interface DeletedFile {
  /** B2 file name (the key). */
  fileName: string
  /** B2 file ID. */
  fileId: string
  /** True for dry-run previews; the file was not actually deleted. */
  skipped: boolean
}

/** Result of {@link deleteCommand}. */
export interface DeleteResult {
  /** One entry per matched file version (including hide markers). */
  files: DeletedFile[]
  /** Count of individual-file delete failures (non-fatal; sums into the dispatcher's `core.setFailed`). */
  errors: number
}

/**
 * Delete files from B2.
 *
 * Modes:
 *   - If `source` ends with `/`, treat it as a prefix and delete every version
 *     matching it. Streams via {@link Bucket.deleteAll}.
 *   - Otherwise delete the single file by name. We look up the latest version
 *     via `listFileNames` to get its `fileId` and call `deleteFileVersion`.
 *
 * With `dry-run: true`, no actual deletions happen; the action reports what
 * would have been deleted.
 */
export async function deleteCommand(bucket: Bucket, inputs: ParsedInputs): Promise<DeleteResult> {
  const source = requireSource(inputs.source, 'delete')
  const isPrefix = source.endsWith('/')

  if (isPrefix) {
    return deletePrefix(bucket, source, inputs.dryRun)
  }
  return deleteOne(bucket, source, inputs.dryRun)
}

async function deletePrefix(
  bucket: Bucket,
  prefix: string,
  dryRun: boolean,
): Promise<DeleteResult> {
  const files: DeletedFile[] = []
  let errors = 0

  core.startGroup(`${dryRun ? 'dry-run' : 'delete'} prefix b2://${bucket.name}/${prefix}`)
  try {
    for await (const event of bucket.deleteAll({ prefix, dryRun })) {
      if (event.type === 'delete') {
        files.push({ fileName: event.fileName, fileId: event.fileId, skipped: false })
        core.info(`  deleted ${event.fileName} (${event.fileId})`)
      } else if (event.type === 'skip') {
        files.push({ fileName: event.fileName, fileId: event.fileId, skipped: true })
        core.info(`  would delete ${event.fileName} (${event.fileId})`)
      } else {
        errors++
        core.warning(`  failed to delete ${event.fileName}: ${event.message}`)
      }
    }
  } finally {
    core.endGroup()
  }

  return { files, errors }
}

async function deleteOne(bucket: Bucket, fileName: string, dryRun: boolean): Promise<DeleteResult> {
  const hit = await findFileByName(bucket, fileName)

  core.startGroup(`${dryRun ? 'dry-run' : 'delete'} b2://${bucket.name}/${fileName}`)
  try {
    if (dryRun) {
      core.info(`  would delete ${fileName} (${hit.fileId})`)
      return {
        files: [{ fileName, fileId: hit.fileId, skipped: true }],
        errors: 0,
      }
    }
    await bucket.deleteFileVersion(fileName, hit.fileId)
    core.info(`  deleted ${fileName} (${hit.fileId})`)
    return {
      files: [{ fileName, fileId: hit.fileId, skipped: false }],
      errors: 0,
    }
  } finally {
    core.endGroup()
  }
}
