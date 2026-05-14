import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retentionCommand } from '../../src/commands/retention.ts'
import { uploadCommand } from '../../src/commands/upload.ts'
import { type TestFixture, boundInputs, makeFixture, makeInputs, seedFile } from '../_helpers.ts'

describe('retention command', () => {
  let fx: TestFixture
  const inputs = boundInputs('retention', () => fx)

  beforeEach(async () => {
    fx = await makeFixture('gh-action-retention')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('applies governance retention with a future timestamp', async () => {
    const local = join(fx.workDir, 'locked.txt')
    await writeFile(local, 'locked content')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
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
      makeInputs('upload', fx, {
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
    await seedFile(fx, 'malformed.txt', 'bad-config')
    await expect(
      retentionCommand(fx.bucket, inputs({ source: 'malformed.txt', retentionMode: 'compliance' })),
    ).rejects.toThrow(/retention-until/)
  })

  it('requires either retention-mode or legal-hold', async () => {
    await seedFile(fx, 'none.txt', 'nothing')
    await expect(retentionCommand(fx.bucket, inputs({ source: 'none.txt' }))).rejects.toThrow(
      /retention-mode.*legal-hold/,
    )
  })
})
