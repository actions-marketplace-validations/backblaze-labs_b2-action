import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client } from '@backblaze/b2-sdk'
import { B2Simulator } from '@backblaze/b2-sdk/simulator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncCommand } from '../../src/commands/sync.ts'
import { uploadCommand } from '../../src/commands/upload.ts'
import { makeInputs } from '../_helpers.ts'

interface Fixture {
  workDir: string
  bucket: Awaited<ReturnType<B2Client['createBucket']>>
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
    bucketName: 'gh-action-syncdown',
    bucketType: 'allPrivate',
  })
  const workDir = await mkdtemp(join(tmpdir(), 'b2-syncdown-'))
  return { workDir, bucket }
}

function inputs(over: Record<string, unknown> = {}) {
  return makeInputs('sync', { bucket: 'gh-action-syncdown', ...over })
}

describe('sync command (B2 → local)', () => {
  let fx: Fixture
  beforeEach(async () => {
    fx = await makeFixture()
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('downloads all files from a B2 prefix when direction=down', async () => {
    // First, seed the bucket.
    for (const name of ['a.txt', 'b.txt', 'sub/c.txt']) {
      const local = join(fx.workDir, `seed-${name.replace('/', '_')}`)
      await writeFile(local, `payload-${name}`)
      await uploadCommand(
        fx.bucket,
        makeInputs('upload', {
          bucket: 'gh-action-syncdown',
          source: local,
          destination: `dl/${name}`,
        }),
      )
    }

    const dest = join(fx.workDir, 'restored')
    const result = await syncCommand(
      fx.bucket,
      inputs({
        source: 'dl',
        destination: dest,
        syncDirection: 'down',
      }),
    )

    expect(result.direction).toBe('b2-to-local')
    expect(result.downloaded).toBeGreaterThanOrEqual(3)
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('payload-a.txt')
    expect(await readFile(join(dest, 'sub', 'c.txt'), 'utf8')).toBe('payload-sub/c.txt')
  })

  it('auto-detects direction = down when source is not a local directory', async () => {
    const local = join(fx.workDir, 'auto.txt')
    await writeFile(local, 'auto-payload')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', {
        bucket: 'gh-action-syncdown',
        source: local,
        destination: 'auto/auto.txt',
      }),
    )

    const dest = join(fx.workDir, 'auto-restore')
    await mkdir(dest, { recursive: true })

    const result = await syncCommand(
      fx.bucket,
      inputs({
        source: 'auto',
        destination: dest,
        syncDirection: 'auto',
      }),
    )

    expect(result.direction).toBe('b2-to-local')
    expect(result.downloaded).toBeGreaterThanOrEqual(1)
  })
})
