import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B2Client, type Bucket } from '@backblaze/b2-sdk'
import { B2Simulator } from '@backblaze/b2-sdk/simulator'
import type { ActionName, ParsedInputs } from '../src/inputs.ts'

/**
 * Shared base inputs for command tests. Pass an `override` partial to
 * customize per-test. Keeping this in one place means adding a new input
 * to `ParsedInputs` only requires updating it here, not every test file.
 */
export function makeInputs(action: ActionName, override: Partial<ParsedInputs> = {}): ParsedInputs {
  return {
    action,
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-key',
    bucket: 'gh-action-test',
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
