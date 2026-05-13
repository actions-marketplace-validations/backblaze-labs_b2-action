import * as core from '@actions/core'
import type { B2Client, Bucket } from '@backblaze/b2-sdk'
import { presignGetObjectUrl } from '@backblaze/b2-sdk/s3'
import type { ParsedInputs } from '../inputs.ts'

export interface PresignedFile {
  fileName: string
  url: string
  expiresAt: number
}

export interface PresignResult {
  files: PresignedFile[]
}

/**
 * Generate a presigned download URL for one B2 file or every file under a
 * prefix.
 *
 * Modes:
 *   - `source` ending in `/` → prefix mode. List the prefix and emit one
 *     presigned URL per file (capped by `max-results`). All URLs share the
 *     same `b2_get_download_authorization` token because the auth scope is
 *     prefix-based; we just expand it into one URL per matched object.
 *   - Otherwise → single-file mode (the original behavior).
 *
 * Every URL is masked via `core.setSecret` so subsequent log lines redact
 * them. The first URL is also exposed as the `presigned-url` step output
 * for the most common one-file workflow.
 */
export async function presignCommand(
  client: B2Client,
  bucket: Bucket,
  inputs: ParsedInputs,
): Promise<PresignResult> {
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'presign' action (the B2 file name or prefix)")
  }

  if (source.endsWith('/')) {
    return presignPrefix(client, bucket, inputs, source)
  }

  return { files: [await presignOne(client, bucket, source, inputs.presignTtlSeconds, source)] }
}

async function presignPrefix(
  client: B2Client,
  bucket: Bucket,
  inputs: ParsedInputs,
  prefix: string,
): Promise<PresignResult> {
  const downloadUrl = client.accountInfo.getDownloadUrl()
  // One auth token covers the whole prefix (that's exactly what
  // `b2_get_download_authorization` is designed for).
  const auth = await bucket.getDownloadAuthorization(prefix, inputs.presignTtlSeconds)
  core.setSecret(auth.authorizationToken)
  const expiresAt = Math.floor(Date.now() / 1000) + inputs.presignTtlSeconds

  const files: PresignedFile[] = []
  let startFileName: string | undefined
  core.startGroup(`presign prefix b2://${bucket.name}/${prefix} (TTL ${inputs.presignTtlSeconds}s)`)
  try {
    while (files.length < inputs.maxResults) {
      const remaining = inputs.maxResults - files.length
      const page = await bucket.listFileNames({
        prefix,
        maxFileCount: Math.min(1000, remaining),
        ...(startFileName !== undefined ? { startFileName } : {}),
      })
      for (const f of page.files) {
        if (f.action !== 'upload') continue
        const url = presignGetObjectUrl(
          downloadUrl,
          bucket.name,
          f.fileName,
          auth.authorizationToken,
          inputs.presignTtlSeconds,
        )
        core.setSecret(url)
        files.push({ fileName: f.fileName, url, expiresAt })
        if (files.length >= inputs.maxResults) break
      }
      if (!page.nextFileName) break
      startFileName = page.nextFileName
    }
  } finally {
    core.info(`  generated ${files.length} presigned URL(s)`)
    core.endGroup()
  }
  return { files }
}

async function presignOne(
  client: B2Client,
  bucket: Bucket,
  fileName: string,
  ttlSeconds: number,
  authPrefix: string,
): Promise<PresignedFile> {
  const auth = await bucket.getDownloadAuthorization(authPrefix, ttlSeconds)
  const downloadUrl = client.accountInfo.getDownloadUrl()
  const url = presignGetObjectUrl(
    downloadUrl,
    bucket.name,
    fileName,
    auth.authorizationToken,
    ttlSeconds,
  )
  core.setSecret(auth.authorizationToken)
  core.setSecret(url)
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  core.info(`presigned URL for ${fileName} valid for ${ttlSeconds}s (expires at ${expiresAt})`)
  return { fileName, url, expiresAt }
}
