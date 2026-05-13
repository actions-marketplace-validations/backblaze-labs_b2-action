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
