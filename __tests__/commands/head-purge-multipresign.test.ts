import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { headCommand } from '../../src/commands/head.ts'
import { presignCommand } from '../../src/commands/presign.ts'
import { purgeCommand } from '../../src/commands/purge.ts'
import { uploadCommand } from '../../src/commands/upload.ts'
import { type TestFixture, makeFixture, makeInputs } from '../_helpers.ts'

function inputs(action: Parameters<typeof makeInputs>[0], over: Record<string, unknown> = {}) {
  return makeInputs(action, { bucket: 'gh-action-hpx', ...over })
}

describe('head command', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-hpx')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('returns metadata without transferring the body', async () => {
    const local = join(fx.workDir, 'h.txt')
    await writeFile(local, 'head-me')
    await uploadCommand(fx.bucket, inputs('upload', { source: local, destination: 'h.txt' }))

    const result = await headCommand(fx.bucket, inputs('head', { source: 'h.txt' }))
    expect(result.fileName).toBe('h.txt')
    expect(result.size).toBe(7)
    expect(result.contentSha1).not.toBeNull()
    expect(result.fileId).toBeTruthy()
    expect(typeof result.contentType).toBe('string')
  })

  it('throws when source is missing', async () => {
    await expect(headCommand(fx.bucket, inputs('head'))).rejects.toThrow(/source.*required/)
  })
})

describe('purge command', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-hpx')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('deletes every version under a prefix including hide markers', async () => {
    for (const name of ['z/a.txt', 'z/b.txt']) {
      const local = join(fx.workDir, name.replace('/', '_'))
      await writeFile(local, name)
      await uploadCommand(fx.bucket, inputs('upload', { source: local, destination: name }))
      // Hide one of them, creating an extra "hide" version to purge.
      if (name === 'z/a.txt') {
        await fx.bucket.hideFile(name)
      }
    }

    const result = await purgeCommand(fx.bucket, inputs('purge', { source: 'z/' }))
    expect(result.errors).toBe(0)
    expect(result.files.length).toBeGreaterThanOrEqual(3) // upload-a + hide-a + upload-b

    const after = await fx.bucket.listFileVersions({ prefix: 'z/' })
    expect(after.files).toHaveLength(0)
  })

  it('dry-run reports without deleting', async () => {
    const local = join(fx.workDir, 'p.txt')
    await writeFile(local, 'preview-only')
    await uploadCommand(fx.bucket, inputs('upload', { source: local, destination: 'p/p.txt' }))

    const result = await purgeCommand(fx.bucket, inputs('purge', { source: 'p/', dryRun: true }))
    expect(result.files.every((f) => f.skipped)).toBe(true)
    const after = await fx.bucket.listFileVersions({ prefix: 'p/' })
    expect(after.files.length).toBeGreaterThan(0)
  })

  it('refuses to run without an explicit source input', async () => {
    await expect(purgeCommand(fx.bucket, inputs('purge'))).rejects.toThrow(/'source' input/)
  })
})

describe('presign command (prefix mode)', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-hpx')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('returns one URL per file in the prefix', async () => {
    for (const name of ['rel/a.bin', 'rel/b.bin', 'rel/c.bin', 'other/d.bin']) {
      const local = join(fx.workDir, name.replace('/', '_'))
      await writeFile(local, `body-${name}`)
      await uploadCommand(fx.bucket, inputs('upload', { source: local, destination: name }))
    }

    const result = await presignCommand(fx.client, fx.bucket, inputs('presign', { source: 'rel/' }))
    expect(result.files).toHaveLength(3)
    for (const f of result.files) {
      // SDK percent-encodes the fileName (so `/` becomes `%2F` in the URL).
      expect(f.url).toContain('/file/gh-action-hpx/')
      expect(f.url).toContain(encodeURIComponent(f.fileName))
      expect(f.url).toContain('Authorization=')
      expect(f.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    }
  })

  it('still supports single-file mode', async () => {
    const local = join(fx.workDir, 'single.bin')
    await writeFile(local, 'single')
    await uploadCommand(fx.bucket, inputs('upload', { source: local, destination: 'single.bin' }))

    const result = await presignCommand(
      fx.client,
      fx.bucket,
      inputs('presign', { source: 'single.bin' }),
    )
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.fileName).toBe('single.bin')
  })
})
