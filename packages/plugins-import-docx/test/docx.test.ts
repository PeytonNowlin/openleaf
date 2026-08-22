import { File } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { clearFileConverters, convertFile, registerFileConverter } from '@openleaf-editor/plugins-import'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocxConverter, type DocxImage, type DocxMammoth, type DocxOptions } from '../src/converter.js'
import {
  assertImportableDocx,
  declaredUncompressedBytes,
  isDocxType,
  looksLikeZip,
} from '../src/guards.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const fixtureBytes = (): Buffer => readFileSync(join(HERE, 'fixtures', 'quarterly-review.docx'))

function docxFile(name = 'quarterly-review.docx', type = DOCX_TYPE): globalThis.File {
  return new File([new Uint8Array(fixtureBytes())], name, { type }) as unknown as globalThis.File
}

const through = (html: string): string => serializeHtml(parseHtml(html))

/**
 * mammoth's Node build, wearing the shape the shipped converter is given.
 *
 * The bundle passes `mammoth/mammoth.browser.js`, which cannot run under Node.
 * Passing mammoth in rather than importing it is what lets this suite exercise
 * the converter that actually ships -- the previous version of this file
 * hand-copied the converter instead, and the copy went on working while the
 * real one emitted a broken-image placeholder for every chart in the document.
 *
 * The only difference is the input: the Node build unzips from a Buffer, the
 * browser build from an ArrayBuffer.
 */
async function nodeMammoth(): Promise<DocxMammoth> {
  const mammoth = (await import('mammoth')).default
  return {
    convertToHtml: ((input: { arrayBuffer: ArrayBuffer }, options: unknown) =>
      mammoth.convertToHtml(
        { buffer: Buffer.from(input.arrayBuffer) },
        options as Parameters<typeof mammoth.convertToHtml>[1],
      )) as unknown as DocxMammoth['convertToHtml'],
    images: mammoth.images as unknown as DocxMammoth['images'],
  }
}

/** Register the real converter through the real seam. */
async function installForTest(options: DocxOptions = {}): Promise<() => void> {
  return registerFileConverter(createDocxConverter(await nodeMammoth(), options))
}

afterEach(() => {
  clearFileConverters()
})

describe('converting a Word document', () => {
  it('produces real structure, not a run of paragraphs', async () => {
    await installForTest()
    const stored = through((await convertFile(docxFile(), document))!.html)

    expect(stored).toContain('Quarterly Review')
    expect(stored).toContain('Summary')
    expect(stored).toContain('<ul>')
    expect(stored).toContain('<table')
  })

  it('nests a second-level bullet inside the first', async () => {
    await installForTest()
    const stored = through((await convertFile(docxFile(), document))!.html)
    expect(stored).toMatch(/<li><p>North region led the quarter<\/p><ul><li>/)
  })

  it('keeps bold and italic', async () => {
    await installForTest()
    const stored = through((await convertFile(docxFile(), document))!.html)
    expect(stored).toMatch(/<strong>up 12%<\/strong>/)
    expect(stored).toMatch(/<em>churn<\/em>/)
  })

  it("maps Word's Title and Quote styles to real structure", async () => {
    // Without the mapping, a document's title arrives as an unstyled paragraph
    // and reads as though the import lost something -- which, to an author, it did.
    await installForTest()
    const stored = through((await convertFile(docxFile(), document))!.html)
    expect(stored).toContain('<h1>Quarterly Review</h1>')
    expect(stored).toContain('<blockquote>')
  })

  it('carries no Word styling into the document', async () => {
    await installForTest()
    const stored = through((await convertFile(docxFile(), document))!.html)
    expect(stored).not.toMatch(/mso-|style=|Calibri/i)
  })

  it('declines files that are not .docx, leaving them to the built-ins', async () => {
    await installForTest()
    const html = new File(['<p>plain</p>'], 'page.html', { type: 'text/html' }) as unknown as globalThis.File
    expect((await convertFile(html, document))?.html).toBe('<p>plain</p>')
  })
})

/**
 * A mammoth that converts nothing and reports what the image policy did with
 * each image it was handed. The fixture has no images in it, and building a
 * Word document around a chart to assert a counter would test Word.
 */
function stubMammoth(contentTypes: string[]): {
  mammoth: DocxMammoth
  emitted: unknown[][]
} {
  const emitted: unknown[][] = []
  const mammoth: DocxMammoth = {
    convertToHtml: (async (_input: unknown, options: { convertImage?: unknown }) => {
      const convert = options.convertImage as unknown as (
        image: DocxImage,
        messages: unknown[],
      ) => Promise<unknown[]>
      for (const contentType of contentTypes) {
        emitted.push(await convert({ contentType, read: async () => 'bytes' }, []))
      }
      return { value: '<p>body</p>', messages: [] }
    }) as unknown as DocxMammoth['convertToHtml'],
    images: {
      // What mammoth's own imgElement does: run the caller's function and build
      // an <img> from what it returns.
      imgElement: ((convert: (image: DocxImage) => Promise<{ src: string }>) =>
        (async (image: DocxImage) => [{ tag: 'img', attributes: await convert(image) }]) as never) as never,
    },
  }
  return { mammoth, emitted }
}

describe('what happens to the images in a .docx', () => {
  it('emits nothing at all for an image it drops, and counts it', async () => {
    /*
     * The old converter returned `{ src: '' }`, and `img[src]` matches, so a
     * report with eight charts produced a polite warning AND eight broken-image
     * placeholders. Counted is not the same as dropped.
     */
    const { mammoth, emitted } = stubMammoth(['image/png', 'image/png'])
    const convert = createDocxConverter(mammoth)
    const result = await convert(docxFile())

    expect(emitted).toEqual([[], []])
    expect(result!.html).not.toContain('img')
    expect(result!.warnings?.join(' ')).toMatch(/2 images could not be imported/)
  })

  it('refuses an SVG even when the site handles images', async () => {
    // The content type comes out of the .docx, so it is exactly as trustworthy
    // as a dropped file's type -- and gets the same answer the drop handler gives.
    const seen: string[] = []
    const { mammoth, emitted } = stubMammoth(['image/svg+xml'])
    const convert = createDocxConverter(mammoth, {
      convertImage: async (image) => {
        seen.push(image.contentType)
        return { src: 'https://cdn.example/uploaded.svg' }
      },
    })
    const result = await convert(docxFile())

    expect(seen).toEqual([])
    expect(emitted).toEqual([[]])
    expect(result!.warnings?.join(' ')).toMatch(/will not embed an SVG/)
  })

  it('hands an ordinary bitmap to the site\'s handler', async () => {
    const seen: string[] = []
    const { mammoth, emitted } = stubMammoth(['image/png'])
    const convert = createDocxConverter(mammoth, {
      convertImage: async (image) => {
        seen.push(image.contentType)
        return { src: 'https://cdn.example/chart.png' }
      },
    })
    const result = await convert(docxFile())

    expect(seen).toEqual(['image/png'])
    expect(emitted[0]).toHaveLength(1)
    expect(result!.warnings).toEqual([])
  })
})

describe('what a .docx has to be before mammoth reads it', () => {
  it('knows a ZIP from whatever else was named .docx', () => {
    expect(looksLikeZip(new Uint8Array(fixtureBytes()).buffer as ArrayBuffer)).toBe(true)
    expect(looksLikeZip(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer as ArrayBuffer)).toBe(false)
  })

  it('accepts the media types a browser really reports for a .docx', () => {
    expect(isDocxType(DOCX_TYPE)).toBe(true)
    // A drop from a file manager, or a machine with no Office install.
    expect(isDocxType('')).toBe(true)
    expect(isDocxType('application/zip')).toBe(true)
    expect(isDocxType('text/html')).toBe(false)
  })

  it('reads the expanded size out of the archive without expanding it', () => {
    // The ZIP central directory records every entry's uncompressed size, so a
    // decompression bomb declares itself before a byte is inflated.
    const declared = declaredUncompressedBytes(new Uint8Array(fixtureBytes()).buffer as ArrayBuffer)
    expect(declared).toBe(3969)
  })

  it('refuses a file that expands past the limit', async () => {
    await expect(
      assertImportableDocx(docxFile(), { maxBytes: 25 * 1024 * 1024, maxUncompressedBytes: 1024 }),
    ).rejects.toThrow(/expands to/)
  })

  it('refuses a file over the byte ceiling before reading it', async () => {
    await expect(
      assertImportableDocx(docxFile(), { maxBytes: 512, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(/over the .* limit for a Word document/)
  })

  it('refuses something that is not a ZIP at all', async () => {
    const notDocx = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'invoice.docx', {
      type: DOCX_TYPE,
    }) as unknown as globalThis.File
    await expect(assertImportableDocx(notDocx)).rejects.toThrow(/does not begin like one/)
  })

  it('lets an ordinary document straight through, returning the bytes it checked', async () => {
    // Returned rather than re-read, so what was checked is what gets converted.
    const bytes = await assertImportableDocx(docxFile())
    expect(bytes.byteLength).toBe(fixtureBytes().byteLength)
  })

  it('reports the refusal to the author rather than throwing at the console', async () => {
    await installForTest({ limits: { maxUncompressedBytes: 1024 } })
    await expect(convertFile(docxFile(), document)).rejects.toThrow(/expands to/)
  })

  it('refuses an honest archive that declares more than the expansion ceiling', async () => {
    const file = zipAsDocx(oversizedZip())
    await expect(
      assertImportableDocx(file, { maxBytes: 25 * 1024 * 1024, maxUncompressedBytes: 1024 }),
    ).rejects.toThrow(/expands to/)
  })

  it('refuses a forged ZIP64 entry-count sentinel without a locator', async () => {
    // Two bytes in the EOCD used to make declaredUncompressedBytes return null,
    // which the caller treated as allowed. The archive is still a readable ZIP.
    const bytes = oversizedZip({ entries: 0xffff })
    const file = zipAsDocx(bytes)
    expect(declaredUncompressedBytes(new Uint8Array(bytes).buffer as ArrayBuffer)).toBeNull()
    await expect(
      assertImportableDocx(file, { maxBytes: 25 * 1024 * 1024, maxUncompressedBytes: 1024 }),
    ).rejects.toThrow(/directory could not be read/)
  })

  it('refuses a forged ZIP64 directory-offset sentinel without a locator', async () => {
    const bytes = oversizedZip({ directoryAt: 0xffffffff })
    const file = zipAsDocx(bytes)
    expect(declaredUncompressedBytes(new Uint8Array(bytes).buffer as ArrayBuffer)).toBeNull()
    await expect(
      assertImportableDocx(file, { maxBytes: 25 * 1024 * 1024, maxUncompressedBytes: 1024 }),
    ).rejects.toThrow(/directory could not be read/)
  })
})

/**
 * Minimal ZIP of two deflated entries, built in memory so the regression never
 * checks in a bomb. `word/document.xml` is 8 KB of spaces -- past the 1 KB
 * ceiling the tests use, nowhere near a real expansion bomb.
 *
 * `entries` / `directoryAt` overwrite the EOCD fields a ZIP64 writer would set
 * to sentinels. The central directory itself is left honest, which is the
 * forgery: a tolerant reader still inflates the payload.
 */
function oversizedZip(patch: { entries?: number; directoryAt?: number } = {}): Buffer {
  const types = Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  )
  const document = Buffer.alloc(8 * 1024, 0x20)
  return buildZip(
    [
      { name: '[Content_Types].xml', data: types },
      { name: 'word/document.xml', data: document },
    ],
    patch,
  )
}

function zipAsDocx(bytes: Buffer): globalThis.File {
  return new File([new Uint8Array(bytes)], 'report.docx', { type: DOCX_TYPE }) as unknown as globalThis.File
}

function crc32(data: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]!
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ~crc >>> 0
}

function buildZip(
  files: { name: string; data: Buffer }[],
  patch: { entries?: number; directoryAt?: number },
): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const compressed = deflateRawSync(file.data)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(Buffer.concat([local, name, compressed]))

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    offset += 30 + name.length + compressed.length
  }

  const localPart = Buffer.concat(locals)
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  const entries = patch.entries ?? files.length
  eocd.writeUInt16LE(entries, 8)
  eocd.writeUInt16LE(entries, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(patch.directoryAt ?? localPart.length, 16)
  return Buffer.concat([localPart, directory, eocd])
}
