import { File } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import {
  clearFileConverters,
  convertFile,
  extractBody,
  registerFileConverter,
  textToHtml,
} from '../src/converters.js'
import { importFileIntoView } from '../src/import.js'
import {
  acceptedExtensions,
  addAcceptedExtensions,
  removeAcceptedExtensions,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Buffer => readFileSync(join(HERE, 'fixtures', name))

/**
 * A File built from a fixture, the way a picker or a drop would supply it.
 *
 * Node's `File` rather than jsdom's: jsdom's Blob in this version implements
 * neither `text()` nor `arrayBuffer()`, which every real browser has. Using the
 * platform one keeps the test honest about what the code will actually be given.
 */
function fileFrom(name: string, type = ''): globalThis.File {
  const data = fixture(name)
  return new File([new Uint8Array(data)], name, { type }) as unknown as globalThis.File
}

function textFile(contents: string, name: string, type = ''): globalThis.File {
  return new File([contents], name, { type }) as unknown as globalThis.File
}

const through = (html: string): string => serializeHtml(parseHtml(html))

afterEach(() => {
  clearFileConverters()
})

describe('importing an HTML file', () => {
  it('takes the body of a full document, not the head', () => {
    const html = '<html><head><title>Page title</title></head><body><p>real</p></body></html>'
    const body = extractBody(html, document)
    expect(body).toContain('<p>real</p>')
    expect(body).not.toContain('Page title')
  })

  it('reconstructs the lists in a Word "Save as Web Page" export', async () => {
    /*
     * The reason importing HTML matters more than it sounds: Word's own HTML
     * export is exactly the mso-list markup the paste normalizer was written to
     * reconstruct. So "import an HTML file" already covers a real share of
     * "import a Word document", for no bytes at all.
     */
    const result = await convertFile(fileFrom('word-export.html', 'text/html'), document)
    expect(result).not.toBeNull()

    const stored = through(result!.html)
    expect(stored).toContain('<ul>')
    expect(stored).toContain('Revenue up 12%')
    expect(stored).toContain('Churn down to 3.1%')
    // No bullet glyphs left as literal text, and no vendor styling imported.
    expect(stored).not.toContain('·')
    expect(stored).not.toMatch(/mso-|Mso|o:p|Calibri/i)
  })

  it('keeps the emphasis Word expressed as markup', async () => {
    const result = await convertFile(fileFrom('word-export.html', 'text/html'), document)
    expect(through(result!.html)).toMatch(/<(strong|b)>Northwind<\/(strong|b)>/)
  })

  it('drops executable content from an imported file', async () => {
    // An imported file is untrusted input. It goes through the same rules as
    // everything else, which is the point of routing it through parseHtml.
    const file = textFile(
      '<body><p>ok</p><script>alert(1)</script><div onclick="x()">t</div></body>',
      'evil.html',
      'text/html',
    )
    const result = await convertFile(file, document)
    const stored = through(result!.html)
    expect(stored).toContain('ok')
    expect(stored).not.toContain('script')
    expect(stored).not.toMatch(/onclick/i)
  })
})

describe('importing plain text', () => {
  it('makes a paragraph per blank-line-separated block', () => {
    expect(textToHtml('one\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })

  it('keeps single newlines as line breaks', () => {
    expect(textToHtml('one\ntwo')).toBe('<p>one<br>two</p>')
  })

  it('escapes markup so text stays text', () => {
    // Importing a .txt file containing "<script>" must not import a script.
    expect(textToHtml('<script>alert(1)</script>')).toContain('&lt;script&gt;')
  })

  it('is reachable through convertFile', async () => {
    const file = textFile('hello\n\nworld', 'notes.txt', 'text/plain')
    const result = await convertFile(file, document)
    expect(result?.html).toBe('<p>hello</p><p>world</p>')
  })
})

describe('formats with no converter', () => {
  it('declines rather than guessing', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sheet.xlsx') as unknown as globalThis.File
    expect(await convertFile(file, document)).toBeNull()
  })
})

describe('the converter seam, driven by mammoth against a real .docx', () => {
  /*
   * An extension point nobody has run is an extension point that does not work.
   * mammoth is a devDependency here for exactly this test -- the shipped bundle
   * does not include it, because at 122 KB gzipped it is larger than the entire
   * editor and forcing it on someone importing an HTML file would be the wrong
   * trade.
   */
  async function withMammoth<T>(run: () => Promise<T>): Promise<T> {
    const mammoth = (await import('mammoth')).default
    const dispose = registerFileConverter(async (file) => {
      if (!file.name.toLowerCase().endsWith('.docx')) return null
      const { value, messages } = await mammoth.convertToHtml({
        buffer: Buffer.from(await file.arrayBuffer()),
      })
      return {
        html: value,
        warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message),
      }
    })
    try {
      return await run()
    } finally {
      dispose()
    }
  }

  it('converts a .docx into real structure', async () => {
    await withMammoth(async () => {
      const result = await convertFile(fileFrom('report.docx'), document)
      expect(result).not.toBeNull()

      const stored = through(result!.html)
      expect(stored).toContain('Quarterly Review')
      expect(stored).toContain('up 12%')
      expect(stored).toContain('North region led')
      // Heading and list structure, not a run of paragraphs.
      expect(stored).toMatch(/<h1>|<h2>/)
      expect(stored).toContain('<ul>')
    })
  })

  it('keeps bold from the .docx', async () => {
    await withMammoth(async () => {
      const result = await convertFile(fileFrom('report.docx'), document)
      expect(through(result!.html)).toMatch(/<strong>up 12%<\/strong>/)
    })
  })

  it('runs converter output through the same normalizer as everything else', async () => {
    await withMammoth(async () => {
      const result = await convertFile(fileFrom('report.docx'), document)
      // One pipeline, not two. A second path that normalizes the same thing
      // differently is how one of them rots.
      expect(result!.html).not.toContain('style=')
    })
  })

  it('leaves other formats to the built-ins when it declines', async () => {
    await withMammoth(async () => {
      const result = await convertFile(fileFrom('word-export.html', 'text/html'), document)
      expect(result!.html).toContain('<ul>')
    })
  })

  it('surfaces converter warnings rather than swallowing them', async () => {
    const dispose = registerFileConverter(async () => ({
      html: '<p>partial</p>',
      warnings: ['3 images could not be imported'],
    }))
    try {
      const result = await convertFile(textFile('', 'x.docx'), document)
      expect(result?.warnings).toEqual(['3 images could not be imported'])
    } finally {
      dispose()
    }
  })
})

describe('the picker accept list', () => {
  const extra = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  afterEach(() => {
    removeAcceptedExtensions(extra)
    removeAcceptedExtensions('.docx')
  })

  it('grows when a converter registers a format, and shrinks when it is removed', () => {
    const before = acceptedExtensions()
    expect(before).not.toContain('.docx')

    addAcceptedExtensions(extra)
    expect(acceptedExtensions()).toContain('.docx')
    expect(acceptedExtensions()).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    removeAcceptedExtensions(extra)
    expect(acceptedExtensions()).toBe(before)
  })

  it('does not duplicate an extension added twice', () => {
    addAcceptedExtensions('.docx')
    const once = acceptedExtensions()
    addAcceptedExtensions('.docx')
    expect(acceptedExtensions()).toBe(once)
  })
})

describe('inserting at the cursor that started the import', () => {
  function mount(html: string): EditorView {
    const place = document.createElement('div')
    document.body.appendChild(place)
    return new EditorView(place, {
      state: EditorState.create({ doc: parseHtml(html) }),
    })
  }

  function posAfter(view: EditorView, text: string): number {
    let found = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) {
        found = pos + node.nodeSize
        return false
      }
      return true
    })
    return found
  }

  it('inserts at the original caret after a delayed conversion', async () => {
    let release!: () => void
    const hang = new Promise<void>((resolve) => {
      release = resolve
    })
    const dispose = registerFileConverter(async (file) => {
      if (file.name !== 'slow.html') return null
      await hang
      return { html: '<p>IMPORTED</p>' }
    })

    const view = mount('<p>FIRST</p><p>SECOND</p>')
    try {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, posAfter(view, 'FIRST'))),
      )

      const pending = importFileIntoView(view, textFile('<p>ignored</p>', 'slow.html', 'text/html'))

      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, posAfter(view, 'SECOND'))),
      )
      view.dispatch(view.state.tr.insertText('x', posAfter(view, 'SECOND') - 1))

      release()
      const outcome = await pending
      expect(outcome.ok).toBe(true)

      const stored = serializeHtml(view.state.doc)
      // Imported between the original paragraphs. The later edit inside SECOND
      // stayed in SECOND instead of being split around the imported block.
      expect(stored).toBe('<p>FIRST</p><p>IMPORTED</p><p>SECONxD</p>')
    } finally {
      dispose()
      view.destroy()
      view.dom.remove()
    }
  })
})
