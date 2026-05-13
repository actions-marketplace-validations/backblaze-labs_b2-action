import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface UnhideResult {
  fileName: string
  /** File ID of the removed hide marker, or null if there was nothing hidden. */
  removedMarkerFileId: string | null
}

/**
 * Restore visibility of a file previously hidden by the `hide` command.
 *
 * Wraps the SDK's {@link Bucket.unhide}, which finds the most recent hide
 * marker for the file name and deletes it. If the file is already visible
 * (or never existed), no-ops and reports `removedMarkerFileId: null`.
 *
 * B2 has no native `b2_unhide_file` endpoint; the SDK implements unhide as
 * "list versions → delete the top hide marker", which is the canonical
 * recipe. We expose it here so workflow authors don't have to know that.
 */
export async function unhideCommand(bucket: Bucket, inputs: ParsedInputs): Promise<UnhideResult> {
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'unhide' action (the B2 file name)")
  }

  core.startGroup(`unhide b2://${bucket.name}/${source}`)
  try {
    const marker = await bucket.unhide(source)
    if (marker === null) {
      core.info(`  no hide marker found for ${source} (already visible or non-existent)`)
      return { fileName: source, removedMarkerFileId: null }
    }
    core.info(`  removed hide marker fileId=${marker.fileId}, ${source} is now visible`)
    return { fileName: source, removedMarkerFileId: marker.fileId }
  } finally {
    core.endGroup()
  }
}
