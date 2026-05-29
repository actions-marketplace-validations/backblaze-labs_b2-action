import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client } from '@backblaze-labs/b2-sdk'
import { B2Simulator } from '@backblaze-labs/b2-sdk/simulator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyCommand } from '../../src/commands/copy.ts'
import { uploadCommand } from '../../src/commands/upload.ts'
import { makeInputs } from '../_helpers.ts'

interface Fixture {
  workDir: string
  sourceBucket: Awaited<ReturnType<B2Client['createBucket']>>
  destBucket: Awaited<ReturnType<B2Client['createBucket']>>
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
  const sourceBucket = await client.createBucket({
    bucketName: 'src-bucket',
    bucketType: 'allPrivate',
  })
  const destBucket = await client.createBucket({
    bucketName: 'dest-bucket',
    bucketType: 'allPrivate',
  })
  const workDir = await mkdtemp(join(tmpdir(), 'b2-xcopy-'))
  return { workDir, sourceBucket, destBucket, client }
}

describe('copy command (cross-bucket)', () => {
  let fx: Fixture
  beforeEach(async () => {
    fx = await makeFixture()
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('copies a file from one bucket to another', async () => {
    const local = join(fx.workDir, 'cross.txt')
    await writeFile(local, 'cross-bucket payload')
    await uploadCommand(
      fx.sourceBucket,
      makeInputs('upload', {
        bucket: 'src-bucket',
        source: local,
        destination: 'releases/v1/app.tar.gz',
      }),
    )

    const result = await copyCommand(
      fx.client,
      fx.destBucket,
      makeInputs('copy', {
        bucket: 'dest-bucket',
        sourceBucket: 'src-bucket',
        source: 'releases/v1/app.tar.gz',
        destination: 'archive/app.tar.gz',
      }),
    )

    expect(result.sourceBucket).toBe('src-bucket')
    expect(result.destinationBucket).toBe('dest-bucket')
    expect(result.fileId).toBeTruthy()

    const remoteSrc = await fx.sourceBucket.listFileNames({ prefix: 'releases/' })
    expect(remoteSrc.files.some((f) => f.fileName === 'releases/v1/app.tar.gz')).toBe(true)

    const remoteDest = await fx.destBucket.listFileNames({ prefix: 'archive/' })
    expect(remoteDest.files.some((f) => f.fileName === 'archive/app.tar.gz')).toBe(true)
  })

  it('falls back to same-bucket when source-bucket is unset', async () => {
    const local = join(fx.workDir, 'same.txt')
    await writeFile(local, 'same-bucket')
    await uploadCommand(
      fx.destBucket,
      makeInputs('upload', {
        bucket: 'dest-bucket',
        source: local,
        destination: 'same.txt',
      }),
    )

    const result = await copyCommand(
      fx.client,
      fx.destBucket,
      makeInputs('copy', {
        bucket: 'dest-bucket',
        source: 'same.txt',
        destination: 'same.copy.txt',
      }),
    )

    expect(result.sourceBucket).toBe('dest-bucket')
    expect(result.destinationBucket).toBe('dest-bucket')
  })
})
