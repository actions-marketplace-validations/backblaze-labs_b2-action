import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client } from '@backblaze/b2-sdk'
import { B2Simulator } from '@backblaze/b2-sdk/simulator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retentionCommand } from '../../src/commands/retention.ts'
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
    bucketName: 'gh-action-retention',
    bucketType: 'allPrivate',
    fileLockEnabled: true,
  })
  const workDir = await mkdtemp(join(tmpdir(), 'b2-retention-'))
  return { workDir, bucket }
}

function inputs(over: Record<string, unknown> = {}) {
  return makeInputs('retention', { bucket: 'gh-action-retention', ...over })
}

describe('retention command', () => {
  let fx: Fixture
  beforeEach(async () => {
    fx = await makeFixture()
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('applies governance retention with a future timestamp', async () => {
    const local = join(fx.workDir, 'locked.txt')
    await writeFile(local, 'locked content')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', {
        bucket: 'gh-action-retention',
        source: local,
        destination: 'locked.txt',
      }),
    )

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const result = await retentionCommand(
      fx.bucket,
      inputs({
        source: 'locked.txt',
        retentionMode: 'governance',
        retentionUntil: tomorrow,
      }),
    )

    expect(result.appliedMode).toBe('governance')
    expect(result.retainUntilTimestamp).toBe(Date.parse(tomorrow))
  })

  it('applies a legal hold without retention', async () => {
    const local = join(fx.workDir, 'hold.txt')
    await writeFile(local, 'held')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', {
        bucket: 'gh-action-retention',
        source: local,
        destination: 'hold.txt',
      }),
    )

    const result = await retentionCommand(
      fx.bucket,
      inputs({ source: 'hold.txt', legalHold: 'on' }),
    )
    expect(result.appliedLegalHold).toBe('on')
  })

  it('rejects retention-mode without retention-until', async () => {
    const local = join(fx.workDir, 'malformed.txt')
    await writeFile(local, 'bad-config')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', {
        bucket: 'gh-action-retention',
        source: local,
        destination: 'malformed.txt',
      }),
    )
    await expect(
      retentionCommand(fx.bucket, inputs({ source: 'malformed.txt', retentionMode: 'compliance' })),
    ).rejects.toThrow(/retention-until/)
  })

  it('requires either retention-mode or legal-hold', async () => {
    const local = join(fx.workDir, 'none.txt')
    await writeFile(local, 'nothing')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', {
        bucket: 'gh-action-retention',
        source: local,
        destination: 'none.txt',
      }),
    )
    await expect(retentionCommand(fx.bucket, inputs({ source: 'none.txt' }))).rejects.toThrow(
      /retention-mode.*legal-hold/,
    )
  })
})
