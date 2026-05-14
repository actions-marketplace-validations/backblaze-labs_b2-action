import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import { IncrementalSha1 } from '@backblaze/b2-sdk/streams'
import { type ParsedInputs, requireSource } from '../inputs.ts'

/** Result of {@link verifyCommand}. */
export interface VerifyResult {
  /** B2 file name that was checked. */
  fileName: string
  /** Server-reported byte size of the remote object. */
  remoteSize: number
  /** Remote whole-file SHA-1, or `null` if the file was multipart-uploaded. */
  remoteSha1: string | null
  /** Locally-computed SHA-1, or `null` if no local file was provided. */
  localSha1: string | null
  /** True when remote SHA-1 matches the expected value. */
  verified: boolean
  /** Human-readable failure reason; `undefined` on success. */
  reason: string | undefined
}

/**
 * Verify that a B2 object matches a local file (or an expected SHA-1) without
 * transferring the body.
 *
 * Three modes, in priority order:
 *   1. `expected-sha1` input set → compare the remote object's SHA-1 to that
 *      literal value. No local read.
 *   2. `destination` input is an existing local file → compute that file's
 *      SHA-1 locally and compare to the remote.
 *   3. Neither → fail.
 *
 * In all modes, the remote SHA-1 is fetched via a HEAD request (header
 * `x-bz-content-sha1`). Large files uploaded via multipart return `null` from
 * B2 here because B2 stores the per-part SHA-1s but not a whole-file SHA-1;
 * the verify will fail with a clear message in that case (you should instead
 * compare a known-good `expected-sha1` from your release manifest).
 */
export async function verifyCommand(bucket: Bucket, inputs: ParsedInputs): Promise<VerifyResult> {
  const source = requireSource(inputs.source, 'verify', 'the B2 file name')

  core.startGroup(`verify b2://${bucket.name}/${source}`)
  try {
    // `bucket.head` returns only the parsed response headers; no body to
    // drain. The SDK normalizes multipart `'none'` to `null` at the boundary.
    const { headers } = await bucket.head(source)
    const remoteSize = headers.contentLength
    const remoteSha1 = headers.contentSha1

    let localSha1: string | null = null
    let expected: string | null = inputs.expectedSha1 ?? null

    if (expected === null && inputs.destination !== undefined && inputs.destination !== '') {
      localSha1 = await sha1OfFile(inputs.destination)
      expected = localSha1
    }

    if (expected === null) {
      throw new Error(
        "verify needs either 'expected-sha1' (literal) or 'destination' (local file path) to compare against",
      )
    }

    if (remoteSha1 === null) {
      const reason =
        'remote SHA-1 is unavailable (multipart-uploaded file; supply a known-good expected-sha1 from your release manifest instead)'
      core.warning(`  ${reason}`)
      return {
        fileName: source,
        remoteSize,
        remoteSha1: null,
        localSha1,
        verified: false,
        reason,
      }
    }

    const verified = remoteSha1.toLowerCase() === expected.toLowerCase()
    const reason = verified
      ? undefined
      : `SHA-1 mismatch: remote=${remoteSha1} expected=${expected}`
    if (verified) {
      core.info(`  ✓ SHA-1 matches (${remoteSha1}), size=${remoteSize}B`)
    } else {
      core.warning(`  ${reason}`)
    }

    return { fileName: source, remoteSize, remoteSha1, localSha1, verified, reason }
  } finally {
    core.endGroup()
  }
}

async function sha1OfFile(path: string): Promise<string> {
  const fileStat = await stat(path)
  if (!fileStat.isFile()) {
    throw new Error(`verify: 'destination' must be an existing file, got: ${path}`)
  }
  const hasher = new IncrementalSha1()
  const stream = createReadStream(path)
  for await (const chunk of stream) {
    await hasher.update(chunk as Uint8Array)
  }
  return hasher.digest()
}
