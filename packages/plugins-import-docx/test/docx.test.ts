import { File } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHtml, serializeHtml } from '@openleaf/core'
import { clearFileConverters, convertFile } from '@openleaf/plugins-import'
import { afterEach, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function docxFile(): globalThis.File {
  const data = readFileSync(join(HERE, 'fixtures', 'quarterly-review.docx'))
  return new File([new Uint8Array(data)], 'quarterly-review.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }) as unknown as globalThis.File
}

const through = (html: string): string => serializeHtml(parseHtml(html))

/**
 * The Node build of mammoth, registered the way the browser bundle does.
 *
 * The shipped bundle imports `mammoth/mammoth.browser.js`, which cannot run
 * under Node -- so the test wires the Node entry through the same public seam.
 * What is under test is the conversion and the style mappings, not which file
 * mammoth was loaded from.
 */
async function installForTest(): Promise<() => void> {
  const mammoth = (await import('mammoth')).default
  const { registerFileConverter } = await import('@openleaf/plugins-import')
  const STYLE_MAP = [
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Subtitle'] => h2:fresh",
    "p[style-name='Quote'] => blockquote > p:fresh",
  ]
  return registerFileConverter(async (file) => {
    if (!/\.docx$/i.test(file.name)) return null
    let dropped = 0
    const { value, messages } = await mammoth.convertToHtml(
      { buffer: Buffer.from(await file.arrayBuffer()) },
      {
        styleMap: STYLE_MAP,
        convertImage: mammoth.images.imgElement(async () => {
          dropped += 1
          return { src: '' }
        }),
      },
    )
    const warnings = messages.filter((m) => m.type === 'warning').map((m) => m.message)
    if (dropped > 0) warnings.push(`${dropped} images could not be imported.`)
    return { html: value, warnings }
  })
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

  it('maps Word\'s Title and Quote styles to real structure', async () => {
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
