import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client } from '@backblaze/b2-sdk'
import { B2Simulator } from '@backblaze/b2-sdk/simulator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncCommand } from '../../src/commands/sync.ts'
import type { ParsedInputs } from '../../src/inputs.ts'
import { makeInputs } from '../_helpers.ts'

interface Fixture {
  workDir: string
  bucket: Awaited<ReturnType<B2Client['createBucket']>>
  client: B2Client
}

async function makeFixture(): Promise<Fixture> {
  const sim = new B2Simulator()
  const client = new B2Client({
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-key',
    transport: sim.transport(),
  })
  await client.authorize()
  const bucket = await client.createBucket({
    bucketName: 'gh-action-sync',
    bucketType: 'allPrivate',
  })
  const workDir = await mkdtemp(join(tmpdir(), 'b2-sync-'))
  return { workDir, bucket, client }
}

function baseInputs(): ParsedInputs {
  return makeInputs('sync', { bucket: 'gh-action-sync' })
}

describe('sync command (local → B2)', () => {
  let fx: Fixture

  beforeEach(async () => {
    fx = await makeFixture()
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
