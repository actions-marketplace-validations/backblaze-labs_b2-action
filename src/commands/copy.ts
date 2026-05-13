import * as core from '@actions/core'
import type { B2Client, Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface CopyResult {
  sourceBucket: string
  sourceFileName: string
  destinationBucket: string
  destinationFileName: string
  fileId: string
  size: number
}

/**
 * Server-side copy of one B2 object to a new name, within the same bucket or
 * across two buckets in the same account.
 *
 * The copy is done by reference (`b2_copy_file` for small, `b2_copy_part` for
 * large): bytes never traverse the runner. This is dramatically faster and
 * cheaper than download-then-reupload for any non-trivial file.
 *
 * Cross-bucket: set `source-bucket` to the source bucket name. The action's
 * `bucket` input is the destination. The application key must have read
 * permission on the source bucket and write permission on the destination.
 */
export async function copyCommand(
  client: B2Client,
  destinationBucket: Bucket,
  inputs: ParsedInputs,
): Promise<CopyResult> {
  const source = inputs.source
  const destination = inputs.destination
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'copy' action (the source B2 file name)")
  }
  if (destination === undefined || destination === '') {
    throw new Error(
      "'destination' input is required for 'copy' action (the destination B2 file name)",
    )
  }

  const sourceBucketName = inputs.sourceBucket ?? destinationBucket.name
  const sourceBucket =
    sourceBucketName === destinationBucket.name
      ? destinationBucket
      : await client.getBucket(sourceBucketName)
  if (!sourceBucket) {
    throw new Error(`Source bucket "${sourceBucketName}" not found, or key lacks listBuckets.`)
  }

  const page = await sourceBucket.listFileNames({ prefix: source, maxFileCount: 1 })
  const hit = page.files.find((f) => f.fileName === source && f.action === 'upload')
  if (!hit) {
    throw new Error(`Source file not found in bucket "${sourceBucketName}": ${source}`)
  }

  core.startGroup(
    `copy b2://${sourceBucketName}/${source} → b2://${destinationBucket.name}/${destination}`,
  )
  try {
    const recommendedPartSize = client.accountInfo.getRecommendedPartSize()
    const isLarge = hit.contentLength > recommendedPartSize

    const result = isLarge
      ? await destinationBucket.copyLargeFile({
          sourceFileId: hit.fileId,
          fileName: destination,
        })
      : await destinationBucket.copyFile({
          sourceFileId: hit.fileId,
          fileName: destination,
          ...(sourceBucketName !== destinationBucket.name
            ? { destinationBucketId: destinationBucket.id }
            : {}),
        })

    core.info(`  copied → fileId=${result.fileId}, size=${result.contentLength}`)
    return {
      sourceBucket: sourceBucketName,
      sourceFileName: source,
      destinationBucket: destinationBucket.name,
      destinationFileName: destination,
      fileId: result.fileId,
      size: result.contentLength,
    }
  } finally {
    core.endGroup()
  }
}
