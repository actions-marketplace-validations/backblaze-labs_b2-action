import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import { B2Folder, LocalFolder, synchronize } from '@backblaze/b2-sdk/sync'
import type {
  CompareMode,
  KeepMode,
  SyncEvent,
  SynchronizerDownConfig,
  SynchronizerUpConfig,
} from '@backblaze/b2-sdk/sync'
import { type ParsedInputs, requireSource } from '../inputs.ts'

/** Result of {@link syncCommand}: per-event log plus aggregate counters. */
export interface SyncResult {
  /** Per-file events emitted by the SDK's `synchronize()` (upload-done, download-done, skip, delete-*, hide, error). */
  events: SyncEvent[]
  /** Resolved direction of this sync (after `auto` resolution). */
  direction: 'local-to-b2' | 'b2-to-local'
  /** Count of files uploaded. */
  uploaded: number
  /** Count of files downloaded. */
  downloaded: number
  /** Count of files deleted/hidden across both sides. */
  deleted: number
  /** Count of files left unchanged (already in sync). */
  skipped: number
  /** Count of per-file errors. */
  errors: number
  /** Total bytes transferred across both directions. */
  bytesTransferred: number
}

/**
 * Sync a local directory to / from a B2 bucket prefix.
 *
 * Direction is determined by the `direction` input (`up` = local → B2,
 * `down` = B2 → local). With `direction: auto` (the default) we infer:
 *   - if `source` is an existing local directory → `up`
 *   - otherwise → `down` (source is a B2 prefix, destination is local)
 *
 * The SDK's {@link synchronize} returns an `AsyncGenerator<SyncEvent>` which we
 * relay to the workflow log (per-file) and aggregate into a typed result.
 */
export async function syncCommand(bucket: Bucket, inputs: ParsedInputs): Promise<SyncResult> {
  const source = requireSource(inputs.source, 'sync')

  const direction = await resolveDirection(inputs.syncDirection, source)
  const compareMode = inputs.compareMode
  const keepMode = inputs.keepMode
  const dryRun = inputs.dryRun

  const config = await buildConfig(bucket, source, inputs, direction)

  core.startGroup(
    `sync ${direction === 'local-to-b2' ? source : `b2://${bucket.name}/${source}`} ` +
      `→ ${direction === 'local-to-b2' ? `b2://${bucket.name}/${inputs.destination ?? ''}` : (inputs.destination ?? '.')} ` +
      `(compare=${compareMode}, keep=${keepMode}${dryRun ? ', dry-run' : ''})`,
  )

  const events: SyncEvent[] = []
  let uploaded = 0
  let downloaded = 0
  let deleted = 0
  let skipped = 0
  let errors = 0
  let bytesTransferred = 0

  try {
    for await (const event of synchronize(config)) {
      events.push(event)
      switch (event.type) {
        case 'upload-done':
          uploaded++
          bytesTransferred += event.size
          core.info(`  ↑ ${event.path} (${event.size}B)`)
          break
        case 'download-done':
          downloaded++
          bytesTransferred += event.size
          core.info(`  ↓ ${event.path} (${event.size}B)`)
          break
        /* v8 ignore next 4 -- pending SDK request: emit `delete-remote` (not `hide`) for orphan removal on unversioned/no-file-lock buckets. Today the engine emits `hide` regardless, so this case is unreachable. Forward-compat, not defensive. */
        case 'delete-remote':
          deleted++
          core.info(`  − ${event.path}`)
          break
        case 'delete-local':
          deleted++
          core.info(`  − (local) ${event.path}`)
          break
        case 'hide':
          deleted++
          core.info(`  ⌀ ${event.path} (hidden)`)
          break
        case 'skip':
          skipped++
          break
        case 'error':
          errors++
          /* v8 ignore next 1 -- pending SDK request: narrow `SyncEvent` so `message: string` is required on error events. The engine always populates it; the `??` is only here to satisfy the loose type. */
          core.warning(`  ! ${event.path}: ${event.message ?? 'unknown error'}`)
          break
        case 'upload-start':
        case 'compare':
        case 'download-start':
        case 'copy-start':
        case 'copy-done':
          break
      }
    }
  } finally {
    core.endGroup()
  }

  core.info(
    `sync done [${direction}]: ${uploaded} uploaded, ${downloaded} downloaded, ${deleted} removed, ${skipped} unchanged, ${errors} errors`,
  )

  return {
    events,
    direction,
    uploaded,
    downloaded,
    deleted,
    skipped,
    errors,
    bytesTransferred,
  }
}

async function resolveDirection(
  requested: 'up' | 'down' | 'auto',
  source: string,
): Promise<'local-to-b2' | 'b2-to-local'> {
  if (requested === 'up') return 'local-to-b2'
  if (requested === 'down') return 'b2-to-local'
  const localStat = await tryStat(source)
  return localStat?.isDirectory() ? 'local-to-b2' : 'b2-to-local'
}

async function buildConfig(
  bucket: Bucket,
  source: string,
  inputs: ParsedInputs,
  direction: 'local-to-b2' | 'b2-to-local',
): Promise<SynchronizerUpConfig | SynchronizerDownConfig> {
  const compareMode = inputs.compareMode
  const keepMode = inputs.keepMode
  const dryRun = inputs.dryRun
  const concurrency = inputs.concurrency

  if (direction === 'local-to-b2') {
    const stats = await tryStat(source)
    if (!stats?.isDirectory()) {
      throw new Error(`'sync' up requires 'source' to be an existing local directory: ${source}`)
    }
    const prefix = (inputs.destination ?? '').replace(/^\/+|\/+$/g, '')
    return {
      source: new LocalFolder(resolve(source)),
      dest: new B2Folder(bucket, prefix === '' ? '' : `${prefix}/`),
      bucket,
      prefix: prefix === '' ? '' : `${prefix}/`,
      options: { compareMode, keepMode, concurrency, dryRun },
    }
  }

  const remotePrefix = source.replace(/^\/+|\/+$/g, '')
  const localDest = inputs.destination ?? '.'
  await mkdir(resolve(localDest), { recursive: true })
  return {
    source: new B2Folder(bucket, remotePrefix === '' ? '' : `${remotePrefix}/`),
    dest: new LocalFolder(resolve(localDest)),
    bucket,
    options: { compareMode, keepMode, concurrency, dryRun },
  }
}

async function tryStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

export type { CompareMode, KeepMode }
