import { randomBytes } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadCommand } from '../../src/commands/download.ts'
import { uploadCommand } from '../../src/commands/upload.ts'
import type { ParsedInputs } from '../../src/inputs.ts'
import { makeFixture, makeInputs, type TestFixture } from '../_helpers.ts'

function baseInputs(): ParsedInputs {
  return makeInputs('upload')
}

describe('upload + download commands (B2Simulator)', () => {
  let fx: TestFixture

  beforeEach(async () => {
    fx = await makeFixture('gh-action-test')
  })

  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('uploads a single file and reports a fileId', async () => {
    const local = join(fx.workDir, 'hello.txt')
    await writeFile(local, 'hello world')

    const result = await uploadCommand(fx.bucket, {
      ...baseInputs(),
      source: local,
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.fileName).toBe('hello.txt')
    expect(result.files[0]?.fileId).toBeTruthy()
    expect(result.bytesTransferred).toBe(11)
  })

  it('uploads to an explicit destination key', async () => {
    const local = join(fx.workDir, 'report.csv')
    await writeFile(local, 'a,b,c\n')

    const result = await uploadCommand(fx.bucket, {
      ...baseInputs(),
      source: local,
      destination: 'releases/v1/report.csv',
    })

    expect(result.files[0]?.fileName).toBe('releases/v1/report.csv')
  })

  it('round-trips bytes via upload → download', async () => {
    const local = join(fx.workDir, 'random.bin')
    const payload = randomBytes(64 * 1024)
    await writeFile(local, payload)

    await uploadCommand(fx.bucket, {
      ...baseInputs(),
      source: local,
      destination: 'random.bin',
    })

    const outPath = join(fx.workDir, 'downloaded.bin')
    const downloaded = await downloadCommand(fx.bucket, {
      ...baseInputs(),
      action: 'download',
      source: 'random.bin',
      destination: outPath,
    })

    expect(downloaded.files).toHaveLength(1)
    const got = await readFile(outPath)
    expect(got.equals(payload)).toBe(true)
  })

  it('downloads every file under a prefix', async () => {
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      const local = join(fx.workDir, name)
      await writeFile(local, `payload-${name}`)
      await uploadCommand(fx.bucket, {
        ...baseInputs(),
        source: local,
        destination: `bundle/${name}`,
      })
    }

    const destDir = join(fx.workDir, 'out')
    const result = await downloadCommand(fx.bucket, {
      ...baseInputs(),
      action: 'download',
      source: 'bundle/',
      destination: destDir,
    })

    expect(result.files).toHaveLength(3)
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      const got = await readFile(join(destDir, name), 'utf8')
      expect(got).toBe(`payload-${name}`)
    }
  })

  it('fails when an upload glob matches no files and fail-on-empty is true', async () => {
    await expect(
      uploadCommand(fx.bucket, {
        ...baseInputs(),
        source: join(fx.workDir, 'does-not-exist-*.txt'),
      }),
    ).rejects.toThrow(/No files matched/)
  })

  it('continues when fail-on-empty is false', async () => {
    const result = await uploadCommand(fx.bucket, {
      ...baseInputs(),
      source: join(fx.workDir, 'does-not-exist-*.txt'),
      failOnEmpty: false,
    })
    expect(result.files).toHaveLength(0)
    expect(result.bytesTransferred).toBe(0)
  })
})
