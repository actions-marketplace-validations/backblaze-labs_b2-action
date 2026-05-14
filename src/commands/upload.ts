import { readFile, stat } from 'node:fs/promises'
import { basename, posix, relative, resolve, sep } from 'node:path'
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import type { Bucket } from '@backblaze/b2-sdk'
import { BufferSource } from '@backblaze/b2-sdk/streams'
import { normalizeSha1 } from '../format.ts'
import { type ParsedInputs, requireSource } from '../inputs.ts'
import { makeProgressListener } from '../progress.ts'

/** One entry in {@link UploadResult.files}. */
export interface UploadedFile {
  /** Absolute path on the runner that was uploaded. */
  localPath: string
  /** B2 file name (the key) the upload landed under. */
  fileName: string
  /** B2 file ID assigned by the server. */
  fileId: string
  /** Byte size of the upload. */
  size: number
  /** Whole-file SHA-1, or `null` when the file was multipart-uploaded. */
  contentSha1: string | null
}

/** Result of {@link uploadCommand}. */
export interface UploadResult {
  /** One entry per uploaded file. Single-file mode returns a one-element array. */
  files: UploadedFile[]
  /** Total bytes uploaded across all files. */
  bytesTransferred: number
}

/**
 * Upload one or more files to B2.
 *
 * Mode selection:
 *   - If `source` is a plain file path (no glob metacharacters and the path
 *     exists as a regular file), upload that single file. The B2 file name is
 *     `destination` if set; otherwise `basename(source)`.
 *   - Otherwise treat `source` (plus any `include` patterns) as glob(s). Each
 *     matched file is uploaded preserving its path relative to the glob root,
 *     prefixed by `destination` (default empty).
 *
 * Large files are streamed (StreamSource over a fs ReadStream-as-Web-Stream)
 * so we don't buffer the whole payload in RAM. The SDK's `Bucket.upload`
 * routes to multipart automatically when size exceeds the recommended part
 * size and parallelizes parts up to `concurrency`.
 */
export async function uploadCommand(bucket: Bucket, inputs: ParsedInputs): Promise<UploadResult> {
  const source = requireSource(inputs.source, 'upload')

  const files = await resolveFiles(source, inputs.include, inputs.exclude)
  if (files.length === 0) {
    if (inputs.failOnEmpty) {
      throw new Error(`No files matched: ${source}`)
    }
    core.warning(`No files matched: ${source}`)
    return { files: [], bytesTransferred: 0 }
  }

  const first = files[0]
  const isSingleExplicitFile =
    files.length === 1 && first !== undefined && first.fileName === basename(first.localPath)

  const uploaded: UploadedFile[] = []
  let totalBytes = 0

  for (const f of files) {
    const fileName = remapFileName(f, inputs.destination, isSingleExplicitFile)
    core.startGroup(`upload ${f.localPath} → b2://${bucket.name}/${fileName}`)
    try {
      const result = await uploadOne(bucket, f.localPath, fileName, inputs)
      uploaded.push(result)
      totalBytes += result.size
    } finally {
      core.endGroup()
    }
  }

  return { files: uploaded, bytesTransferred: totalBytes }
}

interface ResolvedFile {
  localPath: string
  /** Path relative to the glob root, used when computing the B2 key. */
  fileName: string
}

async function resolveFiles(
  source: string,
  include: string[],
  exclude: string[],
): Promise<ResolvedFile[]> {
  const explicitFile = await tryStat(source)
  const looksLikeGlob = /[*?[\]]/.test(source)

  if (explicitFile?.isFile() && !looksLikeGlob && include.length === 0) {
    return [{ localPath: resolve(source), fileName: basename(source) }]
  }

  const patterns: string[] = []
  if (explicitFile?.isDirectory()) {
    patterns.push(`${resolve(source)}/**`)
  } else {
    patterns.push(source)
  }
  for (const p of include) patterns.push(p)
  for (const p of exclude) patterns.push(`!${p}`)

  const globber = await glob.create(patterns.join('\n'), {
    followSymbolicLinks: false,
    matchDirectories: false,
  })
  const matches = await globber.glob()
  const root = explicitFile?.isDirectory() ? resolve(source) : process.cwd()

  const out: ResolvedFile[] = []
  for (const m of matches) {
    const s = await tryStat(m)
    // Filesystem boundary: the globber lists what's there at glob time; the
    // file may be unlinked, renamed, or become a permission error between
    // here and `stat`. Skip silently rather than crash the whole upload.
    if (!s?.isFile()) continue
    const rel = relative(root, m).split(sep).join(posix.sep)
    out.push({ localPath: m, fileName: rel })
  }
  return out
}

function remapFileName(
  file: ResolvedFile,
  destination: string | undefined,
  isSingleExplicitFile: boolean,
): string {
  if (destination === undefined || destination === '') return file.fileName
  const dest = destination.replace(/\/+$/, '')
  if (isSingleExplicitFile && !destination.endsWith('/')) return dest
  return `${dest}/${file.fileName}`
}

async function uploadOne(
  bucket: Bucket,
  localPath: string,
  fileName: string,
  inputs: ParsedInputs,
): Promise<UploadedFile> {
  const fileStat = await stat(localPath)
  const size = fileStat.size

  // Read the file into a BufferSource. The SDK's `bucket.upload` routes
  // files larger than the recommended part size through `uploadLargeFile`,
  // which slices the source into parts and uploads them in parallel. Stream
  // sources cannot be sliced (a stream is read-once-sequential), so the
  // multipart path requires a randomly-accessible source. BufferSource
  // satisfies that. The cost is holding the file in runner memory; on
  // ubuntu-latest (7 GB) that's fine up to multi-GB artifacts, which is
  // well past the practical size for anything a CI workflow uploads.
  const source = new BufferSource(await readFile(localPath))

  const onProgress = makeProgressListener(`upload[${fileName}]`)

  const result = await bucket.upload({
    fileName,
    source,
    concurrency: inputs.concurrency,
    ...(inputs.partSize !== undefined ? { partSize: inputs.partSize } : {}),
    ...(inputs.contentType !== undefined ? { contentType: inputs.contentType } : {}),
    ...(inputs.encryption !== undefined ? { serverSideEncryption: inputs.encryption } : {}),
    onProgress,
  })

  const sha1 = normalizeSha1(result.contentSha1)
  core.info(`  fileId=${result.fileId} sha1=${sha1 ?? 'multipart'}`)

  return {
    localPath,
    fileName: result.fileName,
    fileId: result.fileId,
    size,
    contentSha1: sha1,
  }
}

async function tryStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}
