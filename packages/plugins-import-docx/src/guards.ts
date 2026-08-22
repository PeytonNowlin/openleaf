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
 * So there are two declared-size checks and one measured one. `maxBytes` bounds
 * what is read off disk. `maxUncompressedBytes` bounds what the archive says it
 * will become, read from the ZIP central directory before a byte is inflated.
 * Those directory numbers are attacker-controlled, so the same ceiling is then
 * applied to the bytes that actually come out of inflate. A bomb that lies in
 * the directory still has to expand, and that expansion is what this refuses.
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
  /** Largest total the file may declare -- and actually inflate to. */
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
const ZIP64_EOCD = 0x06064b50
const ZIP64_EOCD_LOCATOR = 0x07064b50
const ZIP64_EXTRA = 0x0001
const FLAG_DATA_DESCRIPTOR = 0x0008

/** Does this start with a ZIP local file header -- `PK\x03\x04`? */
export function looksLikeZip(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false
  return new DataView(bytes).getUint32(0, true) === LOCAL_FILE_HEADER
}

function getUint64(view: DataView, at: number): number | null {
  if (at + 8 > view.byteLength) return null
  const lo = view.getUint32(at, true)
  const hi = view.getUint32(at + 4, true)
  if (hi > 0x1fffff) return null
  return hi * 0x100000000 + lo
}

function findEocd(view: DataView, size: number): number {
  const earliest = Math.max(0, size - (22 + 0xffff))
  for (let at = size - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at
  }
  return -1
}

/**
 * Uncompressed size from a central-directory extra field when the 32-bit field
 * is the ZIP64 sentinel. Field order in extra id 0x0001 is fixed: uncompressed,
 * then compressed, then local offset, each present only when its matching
 * 32-bit field was 0xffffffff.
 */
function zip64UncompressedFromExtra(
  view: DataView,
  extraAt: number,
  extraLen: number,
  size: number,
  uncompressedIsSentinel: boolean,
): number | null {
  if (!uncompressedIsSentinel) return null
  let at = extraAt
  const end = extraAt + extraLen
  while (at + 4 <= end && at + 4 <= size) {
    const id = view.getUint16(at, true)
    const fieldLen = view.getUint16(at + 2, true)
    at += 4
    if (at + fieldLen > end) return null
    if (id === ZIP64_EXTRA) {
      return getUint64(view, at)
    }
    at += fieldLen
  }
  return null
}

/**
 * The total the archive declares it will expand to, or null when that total
 * cannot be established.
 *
 * Null is not permission to proceed. `assertImportableDocx` refuses the file.
 * ZIP64 sentinels (`0xffff` entries, `0xffffffff` directory offset) are honoured
 * only when a ZIP64 EOCD locator (`PK\x06\x07`) sits immediately before the
 * EOCD -- a real ZIP64 archive always has one, and forging the two-byte
 * sentinel without it used to disable the ceiling.
 */
export function declaredUncompressedBytes(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes)
  const size = bytes.byteLength

  const eocd = findEocd(view, size)
  if (eocd < 0) return null

  let entries = view.getUint16(eocd + 10, true)
  let directoryAt = view.getUint32(eocd + 16, true)
  const zip64Sentinel = entries === 0xffff || directoryAt === 0xffffffff

  if (zip64Sentinel) {
    // APPNOTE: the ZIP64 EOCD locator is the 20 bytes immediately before EOCD.
    if (eocd < 20) return null
    if (view.getUint32(eocd - 20, true) !== ZIP64_EOCD_LOCATOR) return null
    const zip64At = getUint64(view, eocd - 12)
    if (zip64At === null || zip64At + 56 > size) return null
    if (view.getUint32(zip64At, true) !== ZIP64_EOCD) return null
    const zip64Entries = getUint64(view, zip64At + 32)
    const zip64DirectoryAt = getUint64(view, zip64At + 48)
    if (zip64Entries === null || zip64DirectoryAt === null) return null
    if (entries === 0xffff) entries = zip64Entries
    if (directoryAt === 0xffffffff) directoryAt = zip64DirectoryAt
  }

  if (directoryAt >= size) return null

  let total = 0
  let at = directoryAt
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > size) return null
    if (view.getUint32(at, true) !== CENTRAL_FILE_HEADER) return null
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    let uncompressed = view.getUint32(at + 24, true)
    if (uncompressed === 0xffffffff) {
      const fromExtra = zip64UncompressedFromExtra(
        view,
        at + 46 + nameLen,
        extraLen,
        size,
        true,
      )
      if (fromExtra === null) return null
      uncompressed = fromExtra
    }
    total += uncompressed
    if (total > Number.MAX_SAFE_INTEGER) return null
    at += 46 + nameLen + extraLen + commentLen
  }
  return total
}

async function inflateRawLength(payload: ArrayBuffer, remaining: number): Promise<number | null> {
  if (typeof DecompressionStream !== 'function') return null
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  // A VIEW, never the bare ArrayBuffer. Both are `BufferSource` to the type
  // checker, and the newest V8 quietly tolerates the buffer -- but Node 22,
  // which is what CI runs, accepts it, emits nothing, and never closes the
  // readable. The first `reader.read()` then waits forever. That is not a test
  // artifact: this guard runs on every `.docx` a site imports, so the import
  // hung rather than failing, with no error to report.
  const written = writer.write(new Uint8Array(payload)).then(() => writer.close(), () => undefined)

  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > remaining) {
        await reader.cancel()
        return null
      }
    }
  } catch {
    return null
  }
  await written
  return total
}

/**
 * Bytes that actually inflate, walking local file headers. Null when the walk
 * cannot establish a total -- data descriptors, unknown methods, ZIP64 sizes
 * without extra fields, an inflate that overruns the remaining budget, or
 * local records that are not packed immediately before the central directory.
 *
 * Data descriptors (general-purpose bit 3) are refused on purpose: the local
 * header then omits sizes, so this walk cannot bound the payload. Word does
 * not write that form for `.docx`.
 */
export async function inflatedUncompressedBytes(
  bytes: ArrayBuffer,
  maxUncompressedBytes: number,
): Promise<number | null> {
  const view = new DataView(bytes)
  const size = bytes.byteLength
  let at = 0
  let total = 0

  while (at + 30 <= size && view.getUint32(at, true) === LOCAL_FILE_HEADER) {
    const flags = view.getUint16(at + 6, true)
    const method = view.getUint16(at + 8, true)
    let compressed = view.getUint32(at + 18, true)
    let uncompressed = view.getUint32(at + 22, true)
    const nameLen = view.getUint16(at + 26, true)
    const extraLen = view.getUint16(at + 28, true)
    const extraAt = at + 30 + nameLen
    if (flags & FLAG_DATA_DESCRIPTOR) return null
    if (uncompressed === 0xffffffff) {
      const fromExtra = zip64UncompressedFromExtra(view, extraAt, extraLen, size, true)
      if (fromExtra === null) return null
      uncompressed = fromExtra
    }
    if (compressed === 0xffffffff) {
      const usizeSentinel = view.getUint32(at + 22, true) === 0xffffffff
      let extraPos = extraAt
      const extraEnd = extraAt + extraLen
      let resolved: number | null = null
      while (extraPos + 4 <= extraEnd) {
        const id = view.getUint16(extraPos, true)
        const fieldLen = view.getUint16(extraPos + 2, true)
        extraPos += 4
        if (id === ZIP64_EXTRA) {
          resolved = getUint64(view, extraPos + (usizeSentinel ? 8 : 0))
          break
        }
        extraPos += fieldLen
      }
      if (resolved === null) return null
      compressed = resolved
    }

    at = extraAt + extraLen
    if (at + compressed > size) return null
    if (total + uncompressed > maxUncompressedBytes) return total + uncompressed

    if (method === 0) {
      total += compressed
      at += compressed
    } else if (method === 8) {
      const got = await inflateRawLength(bytes.slice(at, at + compressed), maxUncompressedBytes - total)
      if (got === null) return null
      total += got
      at += compressed
    } else {
      return null
    }
  }

  // Local records are packed, then the central directory. Padding or a
  // second local record after junk would stop this walk while JSZip still
  // finds every entry from the directory -- fail closed rather than treat
  // a partial inflate total as the archive's size.
  if (at + 4 > size || view.getUint32(at, true) !== CENTRAL_FILE_HEADER) return null

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

  // Fail closed: an unreadable directory, a forged ZIP64 sentinel, or a
  // genuine ZIP64 archive whose locator we cannot parse, all look the same
  // from here -- the expansion cannot be established, so the file is not
  // opened. Treating that as "allowed" is what let two forged bytes disable
  // the ceiling.
  const declared = declaredUncompressedBytes(bytes)
  if (declared === null) {
    throw new Error("this file's directory could not be read.")
  }
  if (declared > limits.maxUncompressedBytes) {
    throw new Error(
      `it expands to ${describeBytes(declared)}, over the ` +
        `${describeBytes(limits.maxUncompressedBytes)} limit. A file that small ` +
        'containing that much is not a document this editor should open.',
    )
  }

  const inflated = await inflatedUncompressedBytes(bytes, limits.maxUncompressedBytes)
  if (inflated === null) {
    throw new Error("this file's directory could not be read.")
  }
  if (inflated > limits.maxUncompressedBytes) {
    throw new Error(
      `it expands to ${describeBytes(inflated)}, over the ` +
        `${describeBytes(limits.maxUncompressedBytes)} limit. A file that small ` +
        'containing that much is not a document this editor should open.',
    )
  }

  return bytes
}
