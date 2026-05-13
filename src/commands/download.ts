import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as core from '@actions/core'
import type { Bucket, SseCDownloadKey } from '@backblaze/b2-sdk'
import type { ParsedInputs } from '../inputs.ts'

export interface DownloadedFile {
  fileName: string
  localPath: string
  size: number
  contentSha1: string | null
}

export interface DownloadResult {
  files: DownloadedFile[]
  bytesTransferred: number
}

/**
 * Download from B2 to the local runner.
 *
 * Modes:
 *   - If `source` ends with `/`, treat it as a prefix and download every file
 *     under it to the local directory at `destination` (defaults to `.`).
 *   - Otherwise download a single file. If `destination` ends with `/` or
 *     resolves to an existing directory, write into that directory using the
 *     basename of `source`. Else `destination` is the exact output file path.
 *     If unset, the file's basename is used in the current working directory.
 */
export async function downloadCommand(
  bucket: Bucket,
  inputs: ParsedInputs,
): Promise<DownloadResult> {
  const source = inputs.source
  if (source === undefined) {
    throw new Error("'source' input is required for 'download' action")
  }
  const isPrefix = source.endsWith('/')

  const sseDownload = sseFromInputs(inputs)

  if (isPrefix) {
    return downloadPrefix(bucket, source, inputs.destination ?? '.', sseDownload)
  }
  const out = await downloadOne(bucket, source, inputs.destination, sseDownload)
  return { files: [out], bytesTransferred: out.size }
}

function sseFromInputs(inputs: ParsedInputs): SseCDownloadKey | undefined {
  const e = inputs.encryption
  if (e === undefined || e.mode !== 'SSE-C') return undefined
  return {
    algorithm: 'AES256',
    customerKey: e.customerKey,
    customerKeyMd5: e.customerKeyMd5,
  }
}

async function downloadPrefix(
  bucket: Bucket,
  prefix: string,
  destinationDir: string,
  sseDownload: SseCDownloadKey | undefined,
): Promise<DownloadResult> {
  const destRoot = resolve(destinationDir)
  await mkdir(destRoot, { recursive: true })

  const files: DownloadedFile[] = []
  let total = 0
  let startFileName: string | undefined = undefined

  for (;;) {
    const page = await bucket.listFileNames({
      prefix,
      maxFileCount: 1000,
      ...(startFileName !== undefined ? { startFileName } : {}),
    })
    for (const f of page.files) {
      if (f.action !== 'upload') continue
      const relName = f.fileName.startsWith(prefix) ? f.fileName.slice(prefix.length) : f.fileName
      const localPath = join(destRoot, ...relName.split(posix.sep))
      core.startGroup(`download b2://${bucket.name}/${f.fileName} → ${localPath}`)
      try {
        const r = await downloadOne(bucket, f.fileName, localPath, sseDownload)
        files.push(r)
        total += r.size
      } finally {
        core.endGroup()
      }
    }
    if (page.nextFileName === null || page.nextFileName === undefined) break
    startFileName = page.nextFileName
  }

  return { files, bytesTransferred: total }
}

async function downloadOne(
  bucket: Bucket,
  fileName: string,
  destination: string | undefined,
  sseDownload: SseCDownloadKey | undefined,
): Promise<DownloadedFile> {
  const localPath = await resolveLocalPath(fileName, destination)
  await mkdir(dirname(localPath), { recursive: true })

  const result = await bucket.download(fileName, {
    ...(sseDownload !== undefined ? { serverSideEncryption: sseDownload } : {}),
  })
  const size = result.headers.contentLength
  const sha1 = result.headers.contentSha1

  const writeStream = createWriteStream(localPath)
  await pipeline(
    Readable.fromWeb(result.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    writeStream,
  )

  core.info(`  wrote ${size} bytes to ${localPath} (sha1=${sha1 ?? 'multipart'})`)

  return { fileName, localPath, size, contentSha1: sha1 }
}

async function resolveLocalPath(
  fileName: string,
  destination: string | undefined,
): Promise<string> {
  const tail = fileName.split(posix.sep).pop() ?? fileName
  if (destination === undefined || destination === '') {
    return resolve(tail)
  }
  if (destination.endsWith('/') || destination.endsWith('\\')) {
    return resolve(destination, tail)
  }
  const s = await tryStat(destination)
  if (s?.isDirectory()) {
    return resolve(destination, tail)
  }
  return resolve(destination)
}

async function tryStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}
