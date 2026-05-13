import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface DeletedFile {
  fileName: string
  fileId: string
  skipped: boolean
}

export interface DeleteResult {
  files: DeletedFile[]
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
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'delete' action")
  }
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
  const page = await bucket.listFileNames({ prefix: fileName, maxFileCount: 1 })
  const hit = page.files.find((f) => f.fileName === fileName && f.action === 'upload')
  if (!hit) {
    throw new Error(`File not found in bucket "${bucket.name}": ${fileName}`)
  }

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
