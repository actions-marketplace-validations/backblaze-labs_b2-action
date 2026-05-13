import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface HideResult {
  fileName: string
  fileId: string
}

/**
 * Hide a file in B2 (creates a "hide marker" file version that masks the
 * previous version from `listFileNames` and downloads-by-name).
 *
 * Versioning is always on in B2, so hide is a soft-delete: the underlying
 * data and prior versions remain until lifecycle rules collect them. To
 * permanently delete, use the `delete` command.
 *
 * To unhide, run `delete` against the hide marker's `fileId` (use `list`
 * with versions if you need to discover it).
 */
export async function hideCommand(bucket: Bucket, inputs: ParsedInputs): Promise<HideResult> {
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'hide' action (the B2 file name)")
  }

  core.startGroup(`hide b2://${bucket.name}/${source}`)
  try {
    const result = await bucket.hideFile(source)
    core.info(`  hidden: ${result.fileName} (marker fileId=${result.fileId})`)
    return { fileName: result.fileName, fileId: result.fileId }
  } finally {
    core.endGroup()
  }
}
