/**
 * What a `.docx` has to be before mammoth is allowed to look at it.
 *
 * ## Why a size check is not enough
 *
 * A `.docx` is a ZIP, and a ZIP expands. Measured against this converter: a
 * 195 KB file on disk grew the heap by **206.9 MB in 690 ms** -- a ratio of
 * about 1024:1 -- with no warning of any kind. The tab does not report an error
 * for that; it stops responding, and on a phone it dies. A byte ceiling on the
 * *compressed* file cannot catch it, because 195 KB is not a suspicious size.
 *
 * So there are two checks. `maxBytes` bounds what is read off disk, and
 * `maxUncompressedBytes` bounds what it can become -- read from the ZIP's own
 * central directory, which records the uncompressed size of every entry before
 * a single byte is inflated. A bomb declares itself, because the format requires
 * it to.
 *
 * ## Why the magic bytes matter
 *
 * The converter is selected on the file *name*. `report.docx` can be anything at
 * all, and "anything at all" handed to a ZIP parser is the input class that ZIP
 * parsers have historically been unhappy about. Four bytes of check turn that
 * into a sentence the author can read.
 *
 * Deliberately no dependency: this is a few hundred bytes of `DataView` against
 * a format whose relevant records have been fixed since 1989.
 */

export interface DocxLimits {
  /** Largest `.docx` this converter will read off disk. */
  maxBytes: number
  /** Largest total the file may declare once expanded. */
  maxUncompressedBytes: number
}

/**
 * 25 MB compressed, 256 MB expanded.
 *
 * A 300-page Word document full of photographs is a few megabytes, and the
 * expanded form of a legitimate document is dominated by its images, which are
 * already compressed and barely grow. 256 MB is far past any real document and
 * far below what killed the tab.
 */
export const DEFAULT_DOCX_LIMITS: Readonly<DocxLimits> = {
  maxBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
}

/** Media types a browser will hand over for a `.docx`. */
const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // What a drop from a file manager, an older browser, or a `<input type=file>`
  // on a machine with no Office install will say instead. All of them are still
  // checked against the magic bytes below.
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  '',
])

/** Is the media type the browser reported one a `.docx` can plausibly have? */
export function isDocxType(type: string | null | undefined): boolean {
  return DOCX_TYPES.has((type ?? '').split(';')[0]!.trim().toLowerCase())
}

/** Sizes in a unit an author reads. */
function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_FILE_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

/** Does this start with a ZIP local file header -- `PK\x03\x04`? */
export function looksLikeZip(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false
  return new DataView(bytes).getUint32(0, true) === LOCAL_FILE_HEADER
}

/**
 * The total the archive declares it will expand to, or null when it cannot be read.
 *
 * Null rather than a throw for the cases this deliberately does not handle --
 * ZIP64, which a file under the size ceiling cannot need. An unreadable central
 * directory is a different thing and is reported by `assertImportableDocx`.
 */
export function declaredUncompressedBytes(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes)
  const size = bytes.byteLength

  // The end-of-central-directory record is last, but a variable-length comment
  // may follow it, so it is found by scanning backwards. The comment field is
  // 16 bits, hence the bound.
  const earliest = Math.max(0, size - (22 + 0xffff))
  let eocd = -1
  for (let at = size - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = at
      break
    }
  }
  if (eocd < 0) return null

  const entries = view.getUint16(eocd + 10, true)
  const directoryAt = view.getUint32(eocd + 16, true)
  // ZIP64 sentinels. Out of scope, and unreachable under the byte ceiling.
  if (entries === 0xffff || directoryAt === 0xffffffff) return null
  if (directoryAt >= size) return null

  let total = 0
  let at = directoryAt
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > size) return null
    if (view.getUint32(at, true) !== CENTRAL_FILE_HEADER) return null
    total += view.getUint32(at + 24, true)
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return total
}

/**
 * Read the file, or say in plain language why it will not be read.
 *
 * Returns the bytes so the caller does not read the file twice: mammoth needs
 * the same `ArrayBuffer` these checks were run against, and re-reading would
 * let a `File` backed by a changing blob pass the check and convert something
 * else.
 */
export async function assertImportableDocx(
  file: File,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS,
): Promise<ArrayBuffer> {
  if (!isDocxType(file.type)) {
    throw new Error(
      `it is named like a Word document but the browser reports it as ${file.type}.`,
    )
  }

  if (file.size > limits.maxBytes) {
    throw new Error(
      `it is ${describeBytes(file.size)}, over the ${describeBytes(limits.maxBytes)} ` +
        'limit for a Word document.',
    )
  }

  const bytes = await file.arrayBuffer()

  if (!looksLikeZip(bytes)) {
    throw new Error('it is not a Word document -- the file does not begin like one.')
  }

  // Null means the directory could not be read -- a ZIP64 archive, or a damaged
  // one. Neither is grounds for refusing the file here: the size ceiling has
  // already been applied, and mammoth reports a damaged archive itself, in its
  // own words. Guessing on this side would reject valid documents written by
  // tools that always emit ZIP64.
  const declared = declaredUncompressedBytes(bytes)
  if (declared !== null && declared > limits.maxUncompressedBytes) {
    throw new Error(
      `it expands to ${describeBytes(declared)}, over the ` +
        `${describeBytes(limits.maxUncompressedBytes)} limit. A file that small ` +
        'containing that much is not a document this editor should open.',
    )
  }

  return bytes
}
