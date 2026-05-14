/**
 * Format a byte count with KB/MB/GB suffixes.
 *
 * Single source of truth so the workflow log (progress.ts) and the step
 * summary table (summary.ts) never drift on thresholds or rounding.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Normalize a B2-returned content SHA-1 string. Real B2 returns the literal
 * string `'none'` for files completed via `b2_finish_large_file` (multipart),
 * because the protocol stores per-part SHA-1s but not a whole-file SHA-1.
 * The action treats that as "no SHA-1 available" and surfaces `null` to its
 * outputs and step-summary rows.
 */
export function normalizeSha1(s: string | null | undefined): string | null {
  if (s === null || s === undefined || s === 'none') return null
  return s
}
