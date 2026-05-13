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

export interface SyncResult {
  events: SyncEvent[]
  direction: 'local-to-b2' | 'b2-to-local'
  uploaded: number
  downloaded: number
  deleted: number
  skipped: number
  errors: number
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

  const config = await buildConfig(bucket, inputs, direction)

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
  inputs: ParsedInputs,
  direction: 'local-to-b2' | 'b2-to-local',
): Promise<SynchronizerUpConfig | SynchronizerDownConfig> {
  const compareMode = inputs.compareMode
  const keepMode = inputs.keepMode
  const dryRun = inputs.dryRun
  const concurrency = inputs.concurrency

  if (direction === 'local-to-b2') {
    const localPath = inputs.source
    if (localPath === undefined) throw new Error("'source' must be a local directory for sync up")
    const stats = await tryStat(localPath)
    if (!stats?.isDirectory()) {
      throw new Error(`'sync' up requires 'source' to be an existing local directory: ${localPath}`)
    }
    const prefix = (inputs.destination ?? '').replace(/^\/+|\/+$/g, '')
    return {
      source: new LocalFolder(resolve(localPath)),
      dest: new B2Folder(bucket, prefix === '' ? '' : `${prefix}/`),
      bucket,
      prefix: prefix === '' ? '' : `${prefix}/`,
      options: { compareMode, keepMode, concurrency, dryRun },
    }
  }

  const remotePrefix = (inputs.source ?? '').replace(/^\/+|\/+$/g, '')
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
