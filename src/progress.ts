import * as core from '@actions/core'
import type { ProgressEvent, ProgressListener } from '@backblaze-labs/b2-sdk'
import { formatBytes } from './format.ts'

/**
 * Build a progress listener that throttles output to one update per
 * `intervalMs` (default 1s) so a long-running upload doesn't flood the
 * workflow log with thousands of lines. The first event and the final
 * event are always emitted.
 */
export function makeProgressListener(label: string, intervalMs = 1000): ProgressListener {
  let lastEmit = 0
  let lastBytes = 0
  let lastTime = Date.now()

  return (event: ProgressEvent) => {
    const now = Date.now()
    const isFirst = lastEmit === 0
    const isFinal = event.totalBytes !== null && event.bytesTransferred >= event.totalBytes
    const due = now - lastEmit >= intervalMs

    if (!isFirst && !isFinal && !due) return

    const elapsedMs = Math.max(1, now - lastTime)
    const deltaBytes = event.bytesTransferred - lastBytes
    const mbps = (deltaBytes / 1024 / 1024) * (1000 / elapsedMs)

    const pct =
      event.totalBytes !== null && event.totalBytes > 0
        ? `${Math.round((event.bytesTransferred / event.totalBytes) * 100)}%`
        : '?%'

    const parts =
      event.totalParts !== null ? ` (${event.partsCompleted}/${event.totalParts} parts)` : ''

    const totalSuffix = event.totalBytes !== null ? ` / ${formatBytes(event.totalBytes)}` : ''
    core.info(
      `${label} ${pct}${parts} ${formatBytes(event.bytesTransferred)}${totalSuffix} @ ${mbps.toFixed(2)} MB/s`,
    )

    lastEmit = now
    lastBytes = event.bytesTransferred
    lastTime = now
  }
}
