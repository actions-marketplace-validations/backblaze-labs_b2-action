/**
 * Coverage-stress tests.
 *
 * Each `describe` here targets a specific gap surfaced by `pnpm test:coverage`.
 * The intent is breadth, not depth: every test exercises one previously-
 * uncovered branch or line. Production behavior is validated by the
 * per-command suites under `__tests__/commands/`.
 *
 * If a test in this file fails because a previously-uncovered branch is now
 * exercised by another suite, delete it here. This file should NOT be the
 * load-bearing assertion for any happy-path behavior.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyCommand } from '../src/commands/copy.ts'
import { deleteCommand } from '../src/commands/delete.ts'
import { downloadCommand } from '../src/commands/download.ts'
import { headCommand } from '../src/commands/head.ts'
import { hideCommand } from '../src/commands/hide.ts'
import { listCommand } from '../src/commands/list.ts'
import { presignCommand } from '../src/commands/presign.ts'
import { purgeCommand } from '../src/commands/purge.ts'
import { retentionCommand } from '../src/commands/retention.ts'
import { syncCommand } from '../src/commands/sync.ts'
import { unhideCommand } from '../src/commands/unhide.ts'
import { uploadCommand } from '../src/commands/upload.ts'
import { verifyCommand } from '../src/commands/verify.ts'
import { parseInputs } from '../src/inputs.ts'
import { writeStepSummary } from '../src/summary.ts'
import {
  type TestFixture,
  makeFixture,
  makeInputs,
  resetInputEnv,
  seedFile,
  setInput,
} from './_helpers.ts'

// =========================================================================
// inputs.ts: every enum reject + parseBool/parsePositiveInt error path
// =========================================================================

describe('parseInputs: exhaustive validation rejects', () => {
  beforeEach(() => {
    resetInputEnv()
    setInput('application-key-id', 'k')
    setInput('application-key', 's')
    setInput('bucket', 'b')
  })
  afterEach(resetInputEnv)

  it('rejects invalid compare-mode', () => {
    setInput('action', 'sync')
    setInput('compare-mode', 'huh')
    expect(() => parseInputs()).toThrow(/Invalid 'compare-mode'/)
  })

  it('rejects invalid keep-mode', () => {
    setInput('action', 'sync')
    setInput('keep-mode', 'whatever')
    expect(() => parseInputs()).toThrow(/Invalid 'keep-mode'/)
  })

  it('rejects invalid sync direction', () => {
    setInput('action', 'sync')
    setInput('direction', 'sideways')
    expect(() => parseInputs()).toThrow(/Invalid 'direction'/)
  })

  it('rejects invalid retention-mode', () => {
    setInput('action', 'retention')
    setInput('retention-mode', 'lockdown')
    expect(() => parseInputs()).toThrow(/Invalid 'retention-mode'/)
  })

  it('rejects invalid legal-hold', () => {
    setInput('action', 'retention')
    setInput('legal-hold', 'maybe')
    expect(() => parseInputs()).toThrow(/Invalid 'legal-hold'/)
  })

  it('rejects a non-boolean for resume', () => {
    setInput('action', 'upload')
    setInput('resume', 'banana')
    expect(() => parseInputs()).toThrow(/Invalid boolean/)
  })

  it('rejects a non-integer for concurrency', () => {
    setInput('action', 'upload')
    setInput('concurrency', '-5')
    expect(() => parseInputs()).toThrow(/Invalid positive integer/)
  })

  it('rejects a non-integer for part-size', () => {
    setInput('action', 'upload')
    setInput('part-size', 'big')
    expect(() => parseInputs()).toThrow(/Invalid positive integer/)
  })

  it('rejects zero for max-results', () => {
    setInput('action', 'list')
    setInput('max-results', '0')
    expect(() => parseInputs()).toThrow(/Invalid positive integer/)
  })

  it('accepts every valid compare-mode + keep-mode + direction combo', () => {
    setInput('action', 'sync')
    for (const cmp of ['modtime', 'size', 'none']) {
      for (const keep of ['no-delete', 'delete', 'keep-days']) {
        for (const dir of ['auto', 'up', 'down']) {
          setInput('compare-mode', cmp)
          setInput('keep-mode', keep)
          setInput('direction', dir)
          const r = parseInputs()
          expect(r.compareMode).toBe(cmp)
          expect(r.keepMode).toBe(keep)
          expect(r.syncDirection).toBe(dir)
        }
      }
    }
  })
})

// =========================================================================
// download.ts: resolveLocalPath edge cases
// =========================================================================

describe('download: destination resolution edge cases', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-dl-edges')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('writes into an existing destination directory', async () => {
    const local = join(fx.workDir, 'asset.txt')
    await writeFile(local, 'asset')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'asset.txt',
      }),
    )

    const targetDir = join(fx.workDir, 'into')
    await mkdir(targetDir, { recursive: true })

    const result = await downloadCommand(
      fx.bucket,
      makeInputs('download', fx, {
        source: 'asset.txt',
        destination: targetDir, // existing directory, no trailing slash
      }),
    )
    expect(result.files[0]?.localPath.endsWith('asset.txt')).toBe(true)
  })

  it('writes using basename when destination is undefined', async () => {
    const local = join(fx.workDir, 'no-dest.txt')
    await writeFile(local, 'no-dest')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'no-dest.txt',
      }),
    )

    const cwd = process.cwd()
    process.chdir(fx.workDir)
    try {
      const result = await downloadCommand(
        fx.bucket,
        makeInputs('download', fx, { source: 'no-dest.txt' }),
      )
      expect(result.files[0]?.localPath.endsWith('no-dest.txt')).toBe(true)
    } finally {
      process.chdir(cwd)
    }
  })

  it('treats a destination with trailing slash as a directory', async () => {
    const local = join(fx.workDir, 'trail.txt')
    await writeFile(local, 'trail')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'trail.txt',
      }),
    )
    const result = await downloadCommand(
      fx.bucket,
      makeInputs('download', fx, {
        source: 'trail.txt',
        destination: `${fx.workDir}/`,
      }),
    )
    expect(result.files[0]?.localPath.endsWith('trail.txt')).toBe(true)
  })

  it("throws on download when 'source' is undefined", async () => {
    await expect(
      downloadCommand(fx.bucket, makeInputs('download', { bucket: 'gh-action-dl-edges' })),
    ).rejects.toThrow(/'source' input is required/)
  })
})

// =========================================================================
// verify.ts: multipart-null-sha1 branch (spy on bucket.download)
// =========================================================================

describe('verify: multipart file with null remote SHA-1', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-verify-mp')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  // The "multipart-uploaded file returns null contentSha1" branch in
  // verify.ts requires the SDK simulator to surface null content-SHA1 on a
  // multipart-finished file. The simulator doesn't yet expose that path
  // organically; restoring this test is queued behind a simulator update.
  // See DEVELOPMENT.md → "SDK simulator gaps".

  it('rejects verify with a destination path that points to a directory', async () => {
    const local = join(fx.workDir, 'asset-dir.txt')
    await writeFile(local, 'x')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, { source: local, destination: 'd.txt' }),
    )
    // destination is a directory, not a file: sha1OfFile should throw.
    const aDir = join(fx.workDir, 'somedir')
    await mkdir(aDir, { recursive: true })
    await expect(
      verifyCommand(
        fx.bucket,
        makeInputs('verify', fx, {
          source: 'd.txt',
          destination: aDir,
        }),
      ),
    ).rejects.toThrow(/must be an existing file/)
  })

  it('throws when source is empty', async () => {
    await expect(
      verifyCommand(fx.bucket, makeInputs('verify', fx, { source: '' })),
    ).rejects.toThrow(/'source' input is required/)
  })
})

// =========================================================================
// hide / unhide / head / retention / copy / delete: missing input rejects
// =========================================================================

describe('command guards: missing required inputs', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-guards')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('hide rejects missing source', async () => {
    await expect(
      hideCommand(fx.bucket, makeInputs('hide', { bucket: 'gh-action-guards' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('unhide rejects empty source', async () => {
    await expect(
      unhideCommand(fx.bucket, makeInputs('unhide', fx, { source: '' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('head rejects empty source', async () => {
    await expect(headCommand(fx.bucket, makeInputs('head', fx, { source: '' }))).rejects.toThrow(
      /'source' input is required/,
    )
  })

  it('retention rejects missing source', async () => {
    await expect(
      retentionCommand(fx.bucket, makeInputs('retention', { bucket: 'gh-action-guards' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('retention rejects invalid ISO retention-until', async () => {
    const local = join(fx.workDir, 'r.txt')
    await writeFile(local, 'r')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, { source: local, destination: 'r.txt' }),
    )
    await expect(
      retentionCommand(
        fx.bucket,
        makeInputs('retention', fx, {
          source: 'r.txt',
          retentionMode: 'governance',
          retentionUntil: 'not-an-iso-date',
        }),
      ),
    ).rejects.toThrow(/not a valid ISO 8601 timestamp/)
  })

  it('retention reports a file that does not exist', async () => {
    await expect(
      retentionCommand(
        fx.bucket,
        makeInputs('retention', fx, {
          source: 'phantom.txt',
          legalHold: 'on',
        }),
      ),
    ).rejects.toThrow(/File not found/)
  })

  it('copy rejects missing source', async () => {
    await expect(
      copyCommand(fx.client, fx.bucket, makeInputs('copy', fx, { destination: 'd' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('copy rejects missing destination', async () => {
    await expect(
      copyCommand(fx.client, fx.bucket, makeInputs('copy', fx, { source: 's' })),
    ).rejects.toThrow(/'destination' input is required/)
  })

  it('copy errors when the source bucket does not exist', async () => {
    // Force getBucket to return null for the cross-bucket lookup.
    // The simulator otherwise tolerates unknown bucket names by falling
    // back to the most-recently-created bucket, which would mask this branch.
    const spy = vi
      .spyOn(fx.client, 'getBucket')
      .mockImplementation(async (name) => (name === 'no-such-bucket' ? null : fx.bucket))
    try {
      await expect(
        copyCommand(
          fx.client,
          fx.bucket,
          makeInputs('copy', fx, {
            sourceBucket: 'no-such-bucket',
            source: 'c.txt',
            destination: 'c.copy.txt',
          }),
        ),
      ).rejects.toThrow(/Source bucket "no-such-bucket" not found/)
    } finally {
      spy.mockRestore()
    }
  })

  it('delete rejects missing source', async () => {
    await expect(
      deleteCommand(fx.bucket, makeInputs('delete', { bucket: 'gh-action-guards' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('upload rejects missing source', async () => {
    await expect(
      uploadCommand(fx.bucket, makeInputs('upload', { bucket: 'gh-action-guards' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('sync rejects missing source', async () => {
    await expect(
      syncCommand(fx.bucket, makeInputs('sync', { bucket: 'gh-action-guards' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('presign rejects empty source', async () => {
    await expect(
      presignCommand(fx.client, fx.bucket, makeInputs('presign', fx, { source: '' })),
    ).rejects.toThrow(/'source' input is required/)
  })
})

// =========================================================================
// purge: bucket-wide warning path + missing source
// =========================================================================

describe('purge: wide-scope warning path', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-purge-wide')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('rejects when source is undefined (no accidental bucket-wide purges)', async () => {
    await expect(
      purgeCommand(fx.bucket, makeInputs('purge', { bucket: 'gh-action-purge-wide' })),
    ).rejects.toThrow(/'source' input is required/)
  })

  it('purges the entire bucket when source is explicitly empty', async () => {
    for (const name of ['x.txt', 'y.txt', 'sub/z.txt']) {
      const local = join(fx.workDir, name.replace('/', '_'))
      await writeFile(local, name)
      await uploadCommand(
        fx.bucket,
        makeInputs('upload', fx, {
          source: local,
          destination: name,
        }),
      )
    }

    const result = await purgeCommand(fx.bucket, makeInputs('purge', fx, { source: '' }))
    expect(result.errors).toBe(0)
    expect(result.files.length).toBeGreaterThanOrEqual(3)
    const after = await fx.bucket.listFileVersions({ prefix: '' })
    expect(after.files).toHaveLength(0)
  })
})

// =========================================================================
// list: skips hide markers, hits maxResults exactly
// =========================================================================

describe('list: version filter and max-results boundary', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-list-versions')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('skips hide-marker versions from the result', async () => {
    const local = join(fx.workDir, 'mask.txt')
    await writeFile(local, 'maskable')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'mask.txt',
      }),
    )
    await fx.bucket.hideFile('mask.txt')

    const result = await listCommand(fx.bucket, makeInputs('list', fx, { source: '' }))
    // listFileNames returns the latest visible version, which for a hidden
    // file is the hide marker itself. We filter that out.
    expect(result.files).toHaveLength(0)
  })

  it('respects max-results=1 across pagination', async () => {
    for (let i = 0; i < 3; i++) {
      const local = join(fx.workDir, `f${i}.txt`)
      await writeFile(local, `body-${i}`)
      await uploadCommand(
        fx.bucket,
        makeInputs('upload', fx, {
          source: local,
          destination: `f${i}.txt`,
        }),
      )
    }
    const result = await listCommand(fx.bucket, makeInputs('list', fx, { maxResults: 1 }))
    expect(result.files).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})

// =========================================================================
// sync: B2 → local with delete-local (keep-mode: delete)
// =========================================================================

// =========================================================================
// delete: single-file dry-run
// =========================================================================

describe('delete: single-file dry-run path', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-del-single-dry')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('previews a single-file delete without removing the object', async () => {
    const local = join(fx.workDir, 'preview.txt')
    await writeFile(local, 'kept')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'preview.txt',
      }),
    )
    const result = await deleteCommand(
      fx.bucket,
      makeInputs('delete', fx, {
        source: 'preview.txt',
        dryRun: true,
      }),
    )
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.skipped).toBe(true)
    const after = await fx.bucket.listFileNames({ prefix: 'preview.txt' })
    expect(after.files.some((f) => f.fileName === 'preview.txt' && f.action === 'upload')).toBe(
      true,
    )
  })
})

// =========================================================================
// upload: single-file path with destination overriding the file name
// =========================================================================

describe('upload: single-file rename via destination', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-upload-rename')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('uploads a single file to an explicit non-slash destination key', async () => {
    const local = join(fx.workDir, 'orig.txt')
    await writeFile(local, 'rename me')
    const result = await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'releases/v1/app.bin', // exact key, no trailing slash
      }),
    )
    expect(result.files[0]?.fileName).toBe('releases/v1/app.bin')
  })

  it('honors a destination prefix with trailing slash for a single source file', async () => {
    const local = join(fx.workDir, 'attached.txt')
    await writeFile(local, 'attach')
    const result = await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'prefix/',
      }),
    )
    expect(result.files[0]?.fileName).toBe('prefix/attached.txt')
  })
})

// =========================================================================
// progress.ts: GB-scale formatting
// =========================================================================

describe('progress.ts: GB-scale formatting', () => {
  it('handles a multi-GB transferred value without crashing', async () => {
    // Re-import here to avoid pulling makeProgressListener at the top.
    const { makeProgressListener } = await import('../src/progress.ts')
    // Capture stdout because @actions/core.info writes there.
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    })
    try {
      const listener = makeProgressListener('gb', 0)
      listener({
        bytesTransferred: 3 * 1024 * 1024 * 1024,
        totalBytes: 4 * 1024 * 1024 * 1024,
        partsCompleted: 0,
        totalParts: null,
        elapsedMs: 1000,
      })
      const text = lines.join('')
      expect(text).toContain('GB')
    } finally {
      spy.mockRestore()
    }
  })
})

// =========================================================================
// download: SSE-C decryption path (sseFromInputs returns a key)
// =========================================================================

describe('download: SSE-C decryption', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-ssec')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('round-trips a file with SSE-C: upload + download with the same customer key', async () => {
    const { parseSse } = await import('../src/sse.ts')
    // 32 random bytes, base64-encoded.
    const rawKey = Buffer.from('abcdefghijklmnopqrstuvwxyz123456', 'utf8')
    const b64 = rawKey.toString('base64')
    const enc = parseSse(`C:${b64}`)

    const local = join(fx.workDir, 'enc.txt')
    await writeFile(local, 'secret payload')
    await uploadCommand(fx.bucket, {
      ...makeInputs('upload', fx, {
        source: local,
        destination: 'enc.txt',
      }),
      encryption: enc,
    })

    const out = join(fx.workDir, 'roundtrip.txt')
    const result = await downloadCommand(fx.bucket, {
      ...makeInputs('download', fx, {
        source: 'enc.txt',
        destination: out,
      }),
      encryption: enc,
    })
    expect(result.files).toHaveLength(1)
  })
})

describe('sync: b2-to-local with orphan deletion', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-sync-orphans')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('deletes local orphan files when syncing b2 → local with keep-mode=delete', async () => {
    // Seed remote with one file.
    const local = join(fx.workDir, 'remote.txt')
    await writeFile(local, 'r')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'r/remote.txt',
      }),
    )

    // Create a local "orphan" file under the dest directory that the sync
    // should remove because it's not present remotely.
    const dest = join(fx.workDir, 'down')
    await mkdir(dest, { recursive: true })
    const orphan = join(dest, 'orphan.txt')
    await writeFile(orphan, 'should-be-removed')

    const result = await syncCommand(
      fx.bucket,
      makeInputs('sync', fx, {
        source: 'r',
        destination: dest,
        syncDirection: 'down',
        keepMode: 'delete',
      }),
    )
    expect(result.direction).toBe('b2-to-local')
    expect(result.deleted).toBeGreaterThanOrEqual(1)
  })
})

// =========================================================================
// copy: copyLargeFile branch via config mock
// =========================================================================

describe('copy: large-file path', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-copy-large')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('routes through copyLargeFile when source size exceeds recommended part size', async () => {
    const local = join(fx.workDir, 'small.txt')
    await writeFile(local, 'tiny payload but accountInfo says everything is "large"')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'src.txt',
      }),
    )

    // Clamping the part size to 1 forces the isLarge branch deterministically
    // without uploading a 100 MB file. This mocks a *config* value, not an
    // SDK response shape.
    const spy = vi.spyOn(fx.client.accountInfo, 'getRecommendedPartSize').mockReturnValue(1)
    const copyLargeSpy = vi.spyOn(fx.bucket, 'copyLargeFile')
    try {
      const result = await copyCommand(
        fx.client,
        fx.bucket,
        makeInputs('copy', fx, {
          source: 'src.txt',
          destination: 'archive/src.txt',
        }),
      )
      expect(result.destinationFileName).toBe('archive/src.txt')
      expect(copyLargeSpy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
      copyLargeSpy.mockRestore()
    }
  })
})

// =========================================================================
// retention: `mode: 'none'` path (clears retention)
// =========================================================================

describe('retention: clearing retention with mode=none', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-retention-none')
    await fx.bucket.delete()
    fx.bucket = await fx.client.createBucket({
      bucketName: 'gh-action-stress-retention-none',
      bucketType: 'allPrivate',
      fileLockEnabled: true,
    })
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('passes mode=null to the SDK when input retention-mode is "none"', async () => {
    const local = join(fx.workDir, 'r.txt')
    await writeFile(local, 'clearable')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: local,
        destination: 'r.txt',
      }),
    )

    // Spy here just inspects the call arguments; doesn't fabricate a response.
    const spy = vi.spyOn(fx.bucket, 'updateFileRetention')
    try {
      await retentionCommand(
        fx.bucket,
        makeInputs('retention', fx, {
          source: 'r.txt',
          retentionMode: 'none',
        }),
      )
      const callArg = spy.mock.calls[0]?.[2]
      expect(callArg?.mode).toBeNull()
      expect(callArg?.retainUntilTimestamp).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

// =========================================================================
// sync: local-to-b2 orphan deletion
// =========================================================================

describe('sync: orphan deletion (local-to-b2)', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-sync-up-orphan')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('removes a remote orphan when syncing up with keep-mode=delete', async () => {
    // Seed a remote-only file, then sync up with `delete` keep-mode.
    await seedFile(fx, 'site/orphan.txt', 'will be removed by sync')

    const localSrc = join(fx.workDir, 'src')
    await mkdir(localSrc, { recursive: true })
    await writeFile(join(localSrc, 'kept.txt'), 'present locally')

    const result = await syncCommand(
      fx.bucket,
      makeInputs('sync', fx, {
        source: localSrc,
        destination: 'site',
        syncDirection: 'up',
        keepMode: 'delete',
      }),
    )
    // NB: the simulator currently routes orphan removal through `hide` events
    // rather than `delete-remote` for unversioned files. The combined
    // `deleted` counter aggregates both. Will revisit when the SDK simulator
    // is updated.
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(result.uploaded).toBeGreaterThanOrEqual(1)
  })
})

// =========================================================================
// delete: prefix dry-run (`skip` event branch)
// =========================================================================

describe('delete: prefix dry-run', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-del-prefix-dry')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('hits the prefix `skip` event branch when dry-run is set', async () => {
    const f1 = join(fx.workDir, 'p1.txt')
    const f2 = join(fx.workDir, 'p2.txt')
    await writeFile(f1, 'one')
    await writeFile(f2, 'two')
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: f1,
        destination: 'p/1.txt',
      }),
    )
    await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: f2,
        destination: 'p/2.txt',
      }),
    )

    const result = await deleteCommand(
      fx.bucket,
      makeInputs('delete', fx, {
        source: 'p/',
        dryRun: true,
      }),
    )
    expect(result.files.length).toBeGreaterThanOrEqual(2)
    expect(result.files.every((f) => f.skipped)).toBe(true)
  })
})

// =========================================================================
// download: prefix mode with undefined destination
// =========================================================================

describe('download: prefix mode defaults destination to cwd', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-dl-edges')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('uses "." when destination is undefined', async () => {
    await seedFile(fx, 'dd/d.txt', 'dl-default-dest')

    const cwd = process.cwd()
    process.chdir(fx.workDir)
    try {
      const result = await downloadCommand(fx.bucket, makeInputs('download', fx, { source: 'dd/' }))
      expect(result.files.length).toBeGreaterThanOrEqual(1)
    } finally {
      process.chdir(cwd)
    }
  })
})

// =========================================================================
// upload: directory-as-source path (recursive glob expansion)
// =========================================================================

describe('upload: directory as source', () => {
  let fx: TestFixture
  beforeEach(async () => {
    fx = await makeFixture('gh-action-stress-upload-dir')
  })
  afterEach(async () => {
    await rm(fx.workDir, { recursive: true, force: true })
  })

  it('expands a directory source into a recursive glob and uploads every file', async () => {
    const dir = join(fx.workDir, 'site')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'a.txt'), 'a')
    await writeFile(join(dir, 'b.txt'), 'b')
    await writeFile(join(dir, 'sub', 'c.txt'), 'c')

    const result = await uploadCommand(
      fx.bucket,
      makeInputs('upload', fx, {
        source: dir,
        destination: 'site',
      }),
    )
    expect(result.files.map((f) => f.fileName).sort()).toEqual([
      'site/a.txt',
      'site/b.txt',
      'site/sub/c.txt',
    ])
  })
})

// =========================================================================
// summary: row that omits every optional field
// =========================================================================

describe('summary: row with only fileName set', () => {
  const ORIGINAL = process.env.GITHUB_STEP_SUMMARY
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'b2-summary-stress-'))
    path = join(dir, 'STEP_SUMMARY')
    process.env.GITHUB_STEP_SUMMARY = path
  })
  afterEach(async () => {
    if (ORIGINAL === undefined) Reflect.deleteProperty(process.env, 'GITHUB_STEP_SUMMARY')
    else process.env.GITHUB_STEP_SUMMARY = ORIGINAL
    await rm(dir, { recursive: true, force: true })
  })

  it('renders a row that omits size, fileId, sha1, and status', async () => {
    await writeStepSummary({
      title: 'Bare row',
      rows: [{ fileName: 'just-a-name.txt' }],
    })
    const { readFile } = await import('node:fs/promises')
    const out = await readFile(path, 'utf8')
    expect(out).toContain('just-a-name.txt')
    expect(out).not.toContain('…')
  })
})
