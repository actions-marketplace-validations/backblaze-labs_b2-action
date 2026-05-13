import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface HeadResult {
  fileName: string
  fileId: string
  size: number
  contentType: string
  contentSha1: string | null
  uploadTimestamp: number
  fileInfo: Record<string, string>
}

/**
 * HEAD-only metadata probe. Fetches the headers of an object without
 * downloading the body. Useful for cheap "does this exist and what's its
 * size / sha1 / contentType?" checks, or to inspect custom `fileInfo`
 * metadata that the uploader attached.
 *
 * Returns all output fields as step outputs so downstream steps can branch
 * on them.
 */
export async function headCommand(bucket: Bucket, inputs: ParsedInputs): Promise<HeadResult> {
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'head' action (the B2 file name)")
  }

  core.startGroup(`head b2://${bucket.name}/${source}`)
  try {
    const result = await bucket.download(source, { method: 'HEAD' })
    // Drain any (empty) HEAD body so the underlying response can be released.
    try {
      await result.body.cancel()
      /* v8 ignore next 3 -- defensive: SDK's HEAD response body sometimes has nothing to cancel */
    } catch {
      // Ignored: HEAD responses may have no body to cancel.
    }
    const h = result.headers
    core.info(
      `  size=${h.contentLength} type=${h.contentType} sha1=${h.contentSha1 ?? 'multipart'}`,
    )
    return {
      fileName: h.fileName,
      fileId: h.fileId,
      size: h.contentLength,
      contentType: h.contentType,
      contentSha1: h.contentSha1,
      uploadTimestamp: h.uploadTimestamp,
      fileInfo: h.fileInfo,
    }
  } finally {
    core.endGroup()
  }
}
