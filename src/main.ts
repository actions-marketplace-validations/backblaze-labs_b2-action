import * as core from '@actions/core'
import { buildClient, getBucket } from './client.ts'
import { copyCommand } from './commands/copy.ts'
import { deleteCommand } from './commands/delete.ts'
import { downloadCommand } from './commands/download.ts'
import { headCommand } from './commands/head.ts'
import { hideCommand } from './commands/hide.ts'
import { listCommand } from './commands/list.ts'
import { presignCommand } from './commands/presign.ts'
import { purgeCommand } from './commands/purge.ts'
import { retentionCommand } from './commands/retention.ts'
import { syncCommand } from './commands/sync.ts'
import { unhideCommand } from './commands/unhide.ts'
import { uploadCommand } from './commands/upload.ts'
import { verifyCommand } from './commands/verify.ts'
import { parseInputs } from './inputs.ts'
import { writeStepSummary } from './summary.ts'

/**
 * Action entrypoint. Parses inputs, builds an authorized B2Client, dispatches
 * to the requested subcommand, and writes structured outputs back via
 * `core.setOutput`. Any thrown error is reported through `core.setFailed`
 * so the workflow step surfaces with a clear message and a non-zero exit.
 *
 * Each command path also publishes a `$GITHUB_STEP_SUMMARY` markdown block so
 * the run's summary page shows a per-file table without scrolling through the
 * live log.
 */
export async function run(): Promise<void> {
  try {
    const inputs = parseInputs()

    const authorized = await buildClient({
      applicationKeyId: inputs.applicationKeyId,
      applicationKey: inputs.applicationKey,
      bucket: inputs.bucket,
      ...(inputs.endpoint !== undefined ? { endpoint: inputs.endpoint } : {}),
    })
    const bucket = await getBucket(authorized)

    switch (inputs.action) {
      case 'upload': {
        const result = await uploadCommand(bucket, inputs)
        const first = result.files[0]
        if (first !== undefined) {
          core.setOutput('file-id', first.fileId)
          core.setOutput('file-name', first.fileName)
          if (first.contentSha1 !== null) core.setOutput('content-sha1', first.contentSha1)
        }
        core.setOutput('files-uploaded', String(result.files.length))
        core.setOutput('bytes-transferred', String(result.bytesTransferred))
        core.setOutput('summary-json', JSON.stringify(result.files))
        core.info(`uploaded ${result.files.length} file(s), ${result.bytesTransferred} bytes`)
        await writeStepSummary({
          title: 'Backblaze B2: upload',
          totals: { files: result.files.length, bytes: result.bytesTransferred },
          rows: result.files.map((f) => ({
            fileName: f.fileName,
            size: f.size,
            fileId: f.fileId,
            sha1: f.contentSha1,
            status: 'uploaded',
          })),
        })
        return
      }
      case 'download': {
        const result = await downloadCommand(bucket, inputs)
        const first = result.files[0]
        if (first !== undefined) {
          core.setOutput('file-name', first.fileName)
          if (first.contentSha1 !== null) core.setOutput('content-sha1', first.contentSha1)
        }
        core.setOutput('files-downloaded', String(result.files.length))
        core.setOutput('bytes-transferred', String(result.bytesTransferred))
        core.setOutput('summary-json', JSON.stringify(result.files))
        core.info(`downloaded ${result.files.length} file(s), ${result.bytesTransferred} bytes`)
        await writeStepSummary({
          title: 'Backblaze B2: download',
          totals: { files: result.files.length, bytes: result.bytesTransferred },
          rows: result.files.map((f) => ({
            fileName: f.fileName,
            size: f.size,
            sha1: f.contentSha1,
            status: 'downloaded',
          })),
        })
        return
      }
      case 'sync': {
        const result = await syncCommand(bucket, inputs)
        core.setOutput('files-uploaded', String(result.uploaded))
        core.setOutput('files-downloaded', String(result.downloaded))
        core.setOutput('files-deleted', String(result.deleted))
        core.setOutput('bytes-transferred', String(result.bytesTransferred))
        core.setOutput('summary-json', JSON.stringify(result.events))
        if (result.errors > 0) {
          throw new Error(`Sync completed with ${result.errors} error(s)`)
        }
        const syncTitlePrefix = inputs.dryRun
          ? 'Backblaze B2: sync (dry-run)'
          : 'Backblaze B2: sync'
        await writeStepSummary({
          title: `${syncTitlePrefix} [${result.direction}]`,
          totals: {
            files: result.uploaded + result.downloaded + result.deleted,
            bytes: result.bytesTransferred,
          },
          rows: [
            {
              fileName: '(uploaded)',
              size: result.direction === 'local-to-b2' ? result.bytesTransferred : 0,
              status: String(result.uploaded),
            },
            {
              fileName: '(downloaded)',
              size: result.direction === 'b2-to-local' ? result.bytesTransferred : 0,
              status: String(result.downloaded),
            },
            { fileName: '(removed)', status: String(result.deleted) },
            { fileName: '(unchanged)', status: String(result.skipped) },
          ],
        })
        return
      }
      case 'copy': {
        const result = await copyCommand(authorized.client, bucket, inputs)
        core.setOutput('file-id', result.fileId)
        core.setOutput('file-name', result.destinationFileName)
        core.setOutput('bytes-transferred', String(result.size))
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: 'Backblaze B2: copy',
          rows: [
            {
              fileName: `b2://${result.sourceBucket}/${result.sourceFileName} → b2://${result.destinationBucket}/${result.destinationFileName}`,
              size: result.size,
              fileId: result.fileId,
              status: 'copied (server-side)',
            },
          ],
        })
        return
      }
      case 'delete': {
        const result = await deleteCommand(bucket, inputs)
        const actuallyDeleted = result.files.filter((f) => !f.skipped).length
        const wouldDelete = result.files.filter((f) => f.skipped).length
        core.setOutput('files-deleted', String(actuallyDeleted))
        core.setOutput('summary-json', JSON.stringify(result.files))
        if (result.errors > 0) {
          throw new Error(`Delete completed with ${result.errors} error(s)`)
        }
        await writeStepSummary({
          title: inputs.dryRun ? 'Backblaze B2: delete (dry-run)' : 'Backblaze B2: delete',
          totals: { files: actuallyDeleted + wouldDelete, bytes: 0 },
          rows: result.files.map((f) => ({
            fileName: f.fileName,
            fileId: f.fileId,
            status: f.skipped ? 'would delete' : 'deleted',
          })),
        })
        return
      }
      case 'presign': {
        const result = await presignCommand(authorized.client, bucket, inputs)
        const first = result.files[0]
        if (first !== undefined) {
          core.setOutput('presigned-url', first.url)
          core.setOutput('file-name', first.fileName)
        }
        core.setOutput('files-listed', String(result.files.length))
        core.setOutput('summary-json', JSON.stringify(result.files))
        await writeStepSummary({
          title: `Backblaze B2: presign (${result.files.length})`,
          rows: result.files.slice(0, 50).map((f) => ({
            fileName: f.fileName,
            status: `expires at ${new Date(f.expiresAt * 1000).toISOString()}`,
          })),
        })
        return
      }
      case 'list': {
        const result = await listCommand(bucket, inputs)
        core.setOutput('files-listed', String(result.files.length))
        core.setOutput('summary-json', JSON.stringify(result.files))
        if (result.truncated) {
          core.warning(
            `list result truncated at max-results=${inputs.maxResults}; raise it to see more`,
          )
        }
        await writeStepSummary({
          title: `Backblaze B2: list (${result.files.length}${result.truncated ? '+' : ''})`,
          totals: {
            files: result.files.length,
            bytes: result.files.reduce((s, f) => s + f.size, 0),
          },
          rows: result.files.slice(0, 100).map((f) => ({
            fileName: f.fileName,
            size: f.size,
            fileId: f.fileId,
            sha1: f.contentSha1,
            status: f.contentType,
          })),
        })
        return
      }
      case 'hide': {
        const result = await hideCommand(bucket, inputs)
        core.setOutput('file-id', result.fileId)
        core.setOutput('file-name', result.fileName)
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: 'Backblaze B2: hide',
          rows: [{ fileName: result.fileName, fileId: result.fileId, status: 'hidden' }],
        })
        return
      }
      case 'unhide': {
        const result = await unhideCommand(bucket, inputs)
        core.setOutput('file-name', result.fileName)
        if (result.removedMarkerFileId !== null) {
          core.setOutput('file-id', result.removedMarkerFileId)
        }
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: 'Backblaze B2: unhide',
          rows: [
            {
              fileName: result.fileName,
              fileId: result.removedMarkerFileId ?? undefined,
              status: result.removedMarkerFileId === null ? 'no-op (not hidden)' : 'unhidden',
            },
          ],
        })
        return
      }
      case 'verify': {
        const result = await verifyCommand(bucket, inputs)
        core.setOutput('verified', String(result.verified))
        core.setOutput('file-name', result.fileName)
        if (result.remoteSha1 !== null) core.setOutput('remote-sha1', result.remoteSha1)
        if (result.localSha1 !== null) core.setOutput('local-sha1', result.localSha1)
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: result.verified ? 'Backblaze B2: verify ✓' : 'Backblaze B2: verify ✗',
          rows: [
            {
              fileName: result.fileName,
              size: result.remoteSize,
              sha1: result.remoteSha1,
              status: result.verified ? 'matches' : (result.reason ?? 'mismatch'),
            },
          ],
        })
        if (!result.verified) {
          throw new Error(result.reason ?? 'verify failed: SHA-1 mismatch')
        }
        return
      }
      case 'head': {
        const result = await headCommand(bucket, inputs)
        core.setOutput('file-id', result.fileId)
        core.setOutput('file-name', result.fileName)
        if (result.contentSha1 !== null) core.setOutput('content-sha1', result.contentSha1)
        core.setOutput('bytes-transferred', '0')
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: 'Backblaze B2: head',
          rows: [
            {
              fileName: result.fileName,
              size: result.size,
              fileId: result.fileId,
              sha1: result.contentSha1,
              status: result.contentType,
            },
          ],
        })
        return
      }
      case 'purge': {
        const result = await purgeCommand(bucket, inputs)
        const actuallyDeleted = result.files.filter((f) => !f.skipped).length
        const wouldDelete = result.files.filter((f) => f.skipped).length
        core.setOutput('files-deleted', String(actuallyDeleted))
        core.setOutput('summary-json', JSON.stringify(result.files))
        if (result.errors > 0) {
          throw new Error(`Purge completed with ${result.errors} error(s)`)
        }
        await writeStepSummary({
          title: inputs.dryRun ? 'Backblaze B2: purge (dry-run)' : 'Backblaze B2: purge',
          totals: { files: actuallyDeleted + wouldDelete, bytes: 0 },
          rows: result.files.slice(0, 100).map((f) => ({
            fileName: f.fileName,
            fileId: f.fileId,
            status: f.skipped ? 'would purge' : 'purged',
          })),
        })
        return
      }
      case 'retention': {
        const result = await retentionCommand(bucket, inputs)
        core.setOutput('file-id', result.fileId)
        core.setOutput('file-name', result.fileName)
        core.setOutput('summary-json', JSON.stringify([result]))
        await writeStepSummary({
          title: 'Backblaze B2: retention',
          rows: [
            {
              fileName: result.fileName,
              fileId: result.fileId,
              status: retentionStatusLine(result),
            },
          ],
        })
        return
      }
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err))
  }
}

function retentionStatusLine(result: {
  appliedMode: 'compliance' | 'governance' | 'none' | undefined
  retainUntilTimestamp: number | null | undefined
  appliedLegalHold: 'on' | 'off' | undefined
}): string {
  const parts: string[] = [`mode=${result.appliedMode ?? '-'}`]
  if (result.retainUntilTimestamp != null) {
    parts.push(`until=${new Date(result.retainUntilTimestamp).toISOString()}`)
  }
  if (result.appliedLegalHold !== undefined) {
    parts.push(`legal-hold=${result.appliedLegalHold}`)
  }
  return parts.join(' ')
}

run()
