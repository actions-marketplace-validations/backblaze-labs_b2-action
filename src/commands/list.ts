import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface ListedFile {
  fileName: string
  fileId: string
  size: number
  contentSha1: string | null
  uploadTimestamp: number
  contentType: string
  fileInfo: Record<string, string>
}

export interface ListResult {
  files: ListedFile[]
  truncated: boolean
}

/**
 * List file names under a prefix.
 *
 * `source` is the prefix (use trailing `/` to list a "directory"). Empty
 * `source` lists everything the application key is allowed to see. Pagination
 * is followed transparently up to `max-results` matches.
 *
 * Useful for "decide what to do next" workflow steps:
 *   - inventory before a delete
 *   - find the most recent release artifact to promote
 *   - emit a JSON manifest as a build output
 */
export async function listCommand(bucket: Bucket, inputs: ParsedInputs): Promise<ListResult> {
  const prefix = inputs.source ?? ''
  const maxResults = inputs.maxResults
  const files: ListedFile[] = []
  let startFileName: string | undefined

  core.startGroup(`list b2://${bucket.name}/${prefix} (max ${maxResults})`)
  try {
    while (files.length < maxResults) {
      const remaining = maxResults - files.length
      const pageSize = Math.min(1000, remaining)
      const page = await bucket.listFileNames({
        prefix,
        maxFileCount: pageSize,
        ...(startFileName !== undefined ? { startFileName } : {}),
      })

      for (const f of page.files) {
        if (f.action !== 'upload') continue
        files.push({
          fileName: f.fileName,
          fileId: f.fileId,
          size: f.contentLength,
          contentSha1: f.contentSha1 ?? null,
          uploadTimestamp: f.uploadTimestamp,
          contentType: f.contentType,
          fileInfo: f.fileInfo ?? {},
        })
        if (files.length >= maxResults) break
      }

      if (!page.nextFileName) {
        return { files, truncated: false }
      }
      startFileName = page.nextFileName
    }

    return { files, truncated: true }
  } finally {
    core.info(`  ${files.length} file(s) listed`)
    core.endGroup()
  }
}
