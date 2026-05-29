import * as core from '@actions/core'
import type { Bucket } from '@backblaze-labs/b2-sdk'
import { type ParsedInputs, requireSource } from '../inputs.ts'

/** Result of {@link headCommand}: metadata read from a HEAD request, no body. */
export interface HeadResult {
  /** B2 file name (the key). */
  fileName: string
  /** B2 file ID. */
  fileId: string
  /** Byte size of the file (from `Content-Length`). */
  size: number
  /** Content-Type the file was uploaded with. */
  contentType: string
  /** Whole-file SHA-1, or `null` for multipart uploads. */
  contentSha1: string | null
  /** B2-side upload timestamp in milliseconds since the epoch. */
  uploadTimestamp: number
  /** Custom `X-Bz-Info-*` headers attached at upload time. */
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
  const source = requireSource(inputs.source, 'head', 'the B2 file name')

  core.startGroup(`head b2://${bucket.name}/${source}`)
  try {
    // `bucket.head` returns only the parsed response headers; no body to
    // drain. The SDK normalizes multipart `'none'` to `null` at the boundary.
    const { headers: h } = await bucket.head(source)
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
