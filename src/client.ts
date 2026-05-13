import * as core from '@actions/core'
import { B2Client, type Bucket, type HttpTransport } from '@backblaze/b2-sdk'
import type { FileVersion } from '@backblaze/b2-sdk'
import { VERSION } from './version.ts'

export interface AuthorizedClient {
  client: B2Client
  bucketName: string
}

export interface BuildClientOptions {
  applicationKeyId: string
  applicationKey: string
  bucket: string
  endpoint?: string | undefined
  transport?: HttpTransport | undefined
}

/**
 * Build an authorized B2Client.
 *
 * Steps:
 *   1. Construct the client with `userAgent: 'b2-github-action/<version>'`. The
 *      SDK preserves its own `b2-sdk-ts/` and `@backblaze/b2-sdk` tokens before
 *      ours so Backblaze server-side logs see both attribution layers.
 *   2. `await client.authorize()`.
 *   3. Mask the resulting authorization token via `core.setSecret` so any later
 *      log line that happens to include it (errors, debug traces) is redacted.
 *
 * The `transport` parameter is only used by tests (the SDK's B2Simulator
 * provides one). Production callers leave it undefined to use the SDK's
 * default FetchTransport with its built-in SSRF guard.
 */
export async function buildClient(options: BuildClientOptions): Promise<AuthorizedClient> {
  const userAgent = `b2-github-action/${VERSION}`

  const client = new B2Client({
    applicationKeyId: options.applicationKeyId,
    applicationKey: options.applicationKey,
    userAgent,
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    ...(options.endpoint !== undefined ? { realm: options.endpoint } : {}),
  })

  await client.authorize()

  const token = client.accountInfo.getAuthToken()
  if (token) core.setSecret(token)

  return { client, bucketName: options.bucket }
}

/**
 * Resolve a bucket by name. Throws a clear error rather than the SDK's
 * `undefined` return so the workflow log surfaces the misconfiguration.
 */
export async function getBucket(authorized: AuthorizedClient) {
  const bucket = await authorized.client.getBucket(authorized.bucketName)
  if (!bucket) {
    throw new Error(
      `Bucket "${authorized.bucketName}" not found, or the application key lacks listBuckets capability for it.`,
    )
  }
  return bucket
}

/**
 * Look up the most-recent visible (`action: 'upload'`) version of a file by
 * its exact name. Throws if no upload version exists (hidden / deleted /
 * never existed). Used by `copy`, `delete`, and `retention` to resolve a
 * file name to a `fileId` before operating on it.
 *
 * @param bucket - The bucket to search.
 * @param fileName - Exact file name (path) to look up.
 * @param bucketDisplayName - Optional label for the error message; defaults
 *   to `bucket.name`. Used when looking up in a source bucket distinct from
 *   the action's destination bucket (cross-bucket copy).
 */
export async function findFileByName(
  bucket: Bucket,
  fileName: string,
  bucketDisplayName?: string,
): Promise<FileVersion> {
  const page = await bucket.listFileNames({ prefix: fileName, maxFileCount: 1 })
  const hit = page.files.find((f) => f.fileName === fileName && f.action === 'upload')
  if (!hit) {
    throw new Error(`File not found in bucket "${bucketDisplayName ?? bucket.name}": ${fileName}`)
  }
  return hit
}
