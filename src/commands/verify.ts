import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as core from '@actions/core'
import type { Bucket } from '@backblaze/b2-sdk'
import { IncrementalSha1 } from '@backblaze/b2-sdk/streams'
import type { ParsedInputs } from '../inputs.ts'

export interface VerifyResult {
  fileName: string
  remoteSize: number
  remoteSha1: string | null
  localSha1: string | null
  verified: boolean
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
  const source = inputs.source
  if (source === undefined || source === '') {
    throw new Error("'source' input is required for 'verify' action (the B2 file name)")
  }

  core.startGroup(`verify b2://${bucket.name}/${source}`)
  try {
    const head = await bucket.download(source, { method: 'HEAD' })
    const remoteSize = head.headers.contentLength
    const remoteSha1 = head.headers.contentSha1
    // Drain the (empty) HEAD body to free the underlying response.
    try {
      await head.body.cancel()
      /* v8 ignore next 3 -- defensive: SDK's HEAD response body sometimes has nothing to cancel */
    } catch {
      // Ignored: HEAD responses may have no body to cancel.
    }

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
