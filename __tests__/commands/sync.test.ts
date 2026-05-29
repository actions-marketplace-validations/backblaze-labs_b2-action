import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncEvent } from '@backblaze-labs/b2-sdk/sync'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { summarizeSyncErrors, syncCommand } from '../../src/commands/sync.ts'
import type { ParsedInputs } from '../../src/inputs.ts'
import { makeFixture, makeInputs, type TestFixture } from '../_helpers.ts'

function baseInputs(): ParsedInputs {
  return makeInputs('sync', { bucket: 'gh-action-sync' })
}

describe('sync command (local → B2)', () => {
  let fx: TestFixture

  beforeEach(async () => {
    fx = await makeFixture('gh-action-sync')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('uploads all files from a local directory', async () => {
    const src = join(fx.workDir, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'a.txt'), 'one')
    await writeFile(join(src, 'b.txt'), 'two')
    await mkdir(join(src, 'sub'), { recursive: true })
    await writeFile(join(src, 'sub', 'c.txt'), 'three')

    const result = await syncCommand(fx.bucket, {
      ...baseInputs(),
      source: src,
      destination: 'site',
    })

    expect(result.uploaded).toBe(3)
    expect(result.errors).toBe(0)

    const page = await fx.bucket.listFileNames({ prefix: 'site/' })
    const names = page.files.map((f) => f.fileName).sort()
    expect(names).toEqual(['site/a.txt', 'site/b.txt', 'site/sub/c.txt'])
  })

  it('second run is a no-op when files have not changed (compare-mode=size)', async () => {
    const src = join(fx.workDir, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'same.txt'), 'unchanged')

    await syncCommand(fx.bucket, {
      ...baseInputs(),
      source: src,
      destination: 'noop',
      compareMode: 'size',
    })

    const second = await syncCommand(fx.bucket, {
      ...baseInputs(),
      source: src,
      destination: 'noop',
      compareMode: 'size',
    })

    expect(second.uploaded).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
  })

  it('dry-run does not upload anything', async () => {
    const src = join(fx.workDir, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'preview.txt'), 'preview-only')

    const result = await syncCommand(fx.bucket, {
      ...baseInputs(),
      source: src,
      destination: 'preview',
      dryRun: true,
    })

    expect(result.errors).toBe(0)
    const page = await fx.bucket.listFileNames({ prefix: 'preview/' })
    expect(page.files).toHaveLength(0)
  })

  it('rejects a missing source directory when direction=up is requested explicitly', async () => {
    await expect(
      syncCommand(fx.bucket, {
        ...baseInputs(),
        source: join(fx.workDir, 'does-not-exist'),
        syncDirection: 'up',
      }),
    ).rejects.toThrow(/existing local directory/)
  })
})

describe('summarizeSyncErrors', () => {
  it('returns an empty string when no events are errors', () => {
    const events: SyncEvent[] = [
      { type: 'upload-done', path: 'a.txt', size: 1 },
      { type: 'skip', path: 'b.txt', size: 0, message: 'identical' },
    ]
    expect(summarizeSyncErrors(events)).toBe('')
  })

  it('samples the first N error events with path and message', () => {
    const events: SyncEvent[] = [
      { type: 'error', path: 'one.txt', message: 'permission denied', size: 0 },
      { type: 'error', path: 'two.txt', message: 'EACCES', size: 0 },
    ]
    expect(summarizeSyncErrors(events)).toBe('one.txt: permission denied; two.txt: EACCES')
  })

  it('elides extra errors past the limit with a "+N more" suffix', () => {
    const events: SyncEvent[] = [
      { type: 'error', path: 'a', message: 'm1', size: 0 },
      { type: 'error', path: 'b', message: 'm2', size: 0 },
      { type: 'error', path: 'c', message: 'm3', size: 0 },
      { type: 'error', path: 'd', message: 'm4', size: 0 },
      { type: 'error', path: 'e', message: 'm5', size: 0 },
    ]
    expect(summarizeSyncErrors(events, 2)).toBe('a: m1; b: m2; +3 more')
  })
})
