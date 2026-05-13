import { appendFile } from 'node:fs/promises'
import * as core from '@actions/core'
import { formatBytes } from './format.ts'

/**
 * Append a markdown summary block to `$GITHUB_STEP_SUMMARY`.
 *
 * The summary file is the standard way for an Action to publish output that
 * shows up in the workflow run's summary page (rather than just the live log).
 * We use it to print a per-file table after upload / download / sync / delete
 * so users can see at-a-glance what happened without scrolling through the
 * `::group::` log lines.
 *
 * If the env var is unset (e.g. running the bundle locally for a smoke test),
 * we no-op. We deliberately do not throw: a missing summary file is never
 * a reason to fail an otherwise-successful step.
 */
export interface SummaryRow {
  fileName: string
  size?: number | undefined
  fileId?: string | undefined
  sha1?: string | null | undefined
  status?: string | undefined
}

export async function writeStepSummary(opts: {
  title: string
  rows: SummaryRow[]
  totals?: { files: number; bytes: number } | undefined
}): Promise<void> {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (path === undefined || path === '') return

  const lines: string[] = []
  lines.push(`## ${opts.title}`)
  lines.push('')

  if (opts.totals !== undefined) {
    lines.push(`**${opts.totals.files}** files, **${formatBytes(opts.totals.bytes)}** total.`)
    lines.push('')
  }

  if (opts.rows.length > 0) {
    lines.push('| File | Size | File ID | SHA-1 | Status |')
    lines.push('|------|------|---------|-------|--------|')
    for (const r of opts.rows) {
      lines.push(
        `| \`${escapePipes(r.fileName)}\` | ${r.size !== undefined ? formatBytes(r.size) : ''} | ${
          r.fileId !== undefined ? `\`${escapePipes(r.fileId)}\`` : ''
        } | ${r.sha1 !== undefined && r.sha1 !== null ? `\`${r.sha1.slice(0, 12)}…\`` : ''} | ${
          r.status ?? ''
        } |`,
      )
    }
  }

  lines.push('')

  try {
    await appendFile(path, `${lines.join('\n')}\n`)
    /* v8 ignore next 3 -- defensive: only fires if $GITHUB_STEP_SUMMARY points at an unwritable path */
  } catch (err) {
    core.warning(`Failed to write step summary: ${(err as Error).message}`)
  }
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|')
}
