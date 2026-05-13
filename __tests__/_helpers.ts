import { writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client, type Bucket } from '@backblaze/b2-sdk'
import { B2Simulator } from '@backblaze/b2-sdk/simulator'
import { uploadCommand } from '../src/commands/upload.ts'
import type { ActionName, ParsedInputs } from '../src/inputs.ts'

/**
 * Shared base inputs for command tests. Two call shapes:
 *
 *   makeInputs('upload', { source: '...' })
 *   makeInputs('upload', fx, { source: '...' })  // picks bucket from fx
 *
 * The fx-bound form removes the duplication of writing the bucket name once
 * at fixture creation and again in every `makeInputs` call.
 *
 * Keeping the defaults table in one place means adding a new input to
 * `ParsedInputs` only requires updating it here, not every test file.
 */
export function makeInputs(action: ActionName, override?: Partial<ParsedInputs>): ParsedInputs
export function makeInputs(
  action: ActionName,
  fx: TestFixture,
  override?: Partial<ParsedInputs>,
): ParsedInputs
export function makeInputs(
  action: ActionName,
  fxOrOverride: TestFixture | Partial<ParsedInputs> = {},
  maybeOverride: Partial<ParsedInputs> = {},
): ParsedInputs {
  const isFx = 'workDir' in fxOrOverride && 'bucket' in fxOrOverride && 'client' in fxOrOverride
  const fx = isFx ? (fxOrOverride as TestFixture) : undefined
  const override = isFx ? maybeOverride : (fxOrOverride as Partial<ParsedInputs>)
  return {
    action,
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-key',
    bucket: fx?.bucket.name ?? 'gh-action-test',
    sourceBucket: undefined,
    source: undefined,
    destination: undefined,
    include: [],
    exclude: [],
    concurrency: 2,
    partSize: undefined,
    resume: true,
    contentType: undefined,
    dryRun: false,
    presignTtlSeconds: 3600,
    endpoint: undefined,
    failOnEmpty: true,
    sse: undefined,
    encryption: undefined,
    compareMode: 'modtime',
    keepMode: 'no-delete',
    syncDirection: 'auto',
    maxResults: 1000,
    expectedSha1: undefined,
    retentionMode: undefined,
    retentionUntil: undefined,
    legalHold: undefined,
    bypassGovernance: false,
    ...override,
  }
}

/** The standard fixture every command test sets up. */
export interface TestFixture {
  workDir: string
  bucket: Bucket
  client: B2Client
}

/**
 * Build a fresh simulator-backed B2Client + bucket + temp workspace dir.
 * Every command test uses this; centralizing it here means changing the
 * simulator setup is one file, not 9.
 *
 * Pass a `bucketName` to disambiguate parallel tests so they don't collide
 * on the simulator's globally-unique bucket-name space. Defaults to
 * `gh-action-test`.
 *
 * The caller is responsible for `rm`-ing `workDir` in their `afterEach`.
 */
export async function makeFixture(bucketName = 'gh-action-test'): Promise<TestFixture> {
  const sim = new B2Simulator()
  const client = new B2Client({
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-key',
    transport: sim.transport(),
  })
  await client.authorize()
  const bucket = await client.createBucket({ bucketName, bucketType: 'allPrivate' })
  const workDir = await mkdtemp(join(tmpdir(), 'b2-test-'))
  return { workDir, bucket, client }
}

/**
 * Snapshot of `process.env` taken once at module load, before any test runs.
 * Used by {@link resetInputEnv} to put env back to a clean baseline between
 * tests so `parseInputs()` reads from a known-empty slate.
 */
const ORIGINAL_ENV = { ...process.env }

/** Set an `INPUT_*` env var the way `@actions/core` reads it. */
export function setInput(name: string, value: string): void {
  process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value
}

/**
 * Clear every `INPUT_*` env var and restore `process.env` to the snapshot
 * taken at module load. Call from `beforeEach` and `afterEach` whenever a
 * test mutates env vars (e.g. `setInput`, `B2_APPLICATION_KEY_ID`).
 */
export function resetInputEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('INPUT_')) Reflect.deleteProperty(process.env, k)
  }
  process.env = { ...ORIGINAL_ENV }
}

/**
 * Seed one file into the fixture's bucket. Writes `body` to a local temp file
 * under `fx.workDir`, then uploads it to `key` in `fx.bucket`. The local file
 * is left behind (cleaned up when the test's `afterEach` removes `workDir`).
 *
 * Replaces the 3-line `writeFile + uploadCommand` boilerplate that otherwise
 * appears at the start of nearly every command test.
 */
export async function seedFile(fx: TestFixture, key: string, body: string): Promise<void> {
  const local = join(fx.workDir, key.split('/').pop() ?? key)
  await writeFile(local, body)
  await uploadCommand(fx.bucket, makeInputs('upload', fx, { source: local, destination: key }))
}

/** Seed multiple files in one call. Iterates `entries` in declaration order. */
export async function seedFiles(fx: TestFixture, entries: Record<string, string>): Promise<void> {
  for (const [key, body] of Object.entries(entries)) {
    await seedFile(fx, key, body)
  }
}
