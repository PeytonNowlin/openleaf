import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHtml } from '@openleaf-editor/core'
import { describe, expect, it } from 'vitest'
import { detectSource, normalizePastedHtml } from '../src/index.js'
import { looksLikeExcel, normalizeExcel } from '../src/excel.js'

/**
 * Excel paste tests assert on the parsed document, not on an HTML string. A
 * `<ul>` fabricated from a spreadsheet row looks fine in a string diff and is
 * exactly the failure this source exists to prevent.
 */

const PASTE_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'test',
  'fixtures',
  'paste',
)

function loadPasteFixture(name: string): string {
  return readFileSync(join(PASTE_FIXTURES, name), 'utf8').trim()
}

interface Cell {
  text: string
  colspan: number
  rowspan: number
}

function shapeOf(html: string): { rows: Cell[][]; listCount: number } {
  const doc = parseHtml(html)
  const rows: Cell[][] = []
  let listCount = 0
  doc.descendants((node) => {
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      listCount += 1
    }
    if (node.type.name === 'table_row') {
      const cells: Cell[] = []
      node.forEach((cell) => {
        cells.push({
          text: cell.textContent,
          colspan: cell.attrs['colspan'] as number,
          rowspan: cell.attrs['rowspan'] as number,
        })
      })
      rows.push(cells)
    }
    return true
  })
  return { rows, listCount }
}

const EXCEL_FIXTURE = loadPasteFixture('excel-paste.html')
const WORD_FIXTURE = loadPasteFixture('word-paste.html')
const GDOCS_FIXTURE = loadPasteFixture('gdocs-paste.html')

describe('detection', () => {
  it('recognises an Excel clipboard envelope as excel, not word', () => {
    expect(detectSource(EXCEL_FIXTURE)).toBe('excel')
    expect(looksLikeExcel(EXCEL_FIXTURE)).toBe(true)
  })

  it('recognises each envelope-level Excel signal on its own', () => {
    expect(detectSource('<meta name=ProgId content=Excel.Sheet><table><tr><td>A</td></tr></table>')).toBe(
      'excel',
    )
    expect(
      detectSource(
        '<table xmlns:x="urn:schemas-microsoft-com:office:excel"><tr><td>A</td></tr></table>',
      ),
    ).toBe('excel')
    expect(
      detectSource('<meta name=Generator content="Microsoft Excel 15"><table><tr><td>A</td></tr></table>'),
    ).toBe('excel')
    expect(detectSource('<table><tr><td x:num="1.25">1.25</td></tr></table>')).toBe('excel')
    expect(detectSource('<table><tr><td x:str>Quarter</td></tr></table>')).toBe('excel')
  })

  it('does not claim a Word table that merely has mso-number-format', () => {
    // Cell-level number format is not confident enough to divert away from
    // Word. A Word paste of a numeric table still needs list reconstruction
    // for the paragraphs around it.
    const html =
      '<p class="MsoNormal">Intro<o:p></o:p></p>' +
      '<table class="MsoTableGrid"><tr><td style="mso-number-format:0.00">1.25</td></tr></table>'
    expect(looksLikeExcel(html)).toBe(false)
    expect(detectSource(html)).toBe('word')
  })

  it('does not claim a Word document that embeds a spreadsheet object', () => {
    const html =
      '<html xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<head><meta name=ProgId content=Word.Document></head>' +
      '<body>' +
      '<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">' +
      '<!--[if !supportLists]--><span>·</span><!--[endif]-->Revenue</p>' +
      '<table><tr><td x:num="1.25">1.25</td></tr></table>' +
      '</body></html>'
    expect(looksLikeExcel(html)).toBe(false)
    expect(detectSource(html)).toBe('word')
  })

  it('keeps the Word paste fixture on the Word path', () => {
    expect(detectSource(WORD_FIXTURE)).toBe('word')
    expect(looksLikeExcel(WORD_FIXTURE)).toBe(false)
  })

  it('keeps the Google Docs paste fixture on the gdocs path', () => {
    expect(detectSource(GDOCS_FIXTURE)).toBe('gdocs')
    expect(looksLikeExcel(GDOCS_FIXTURE)).toBe(false)
  })

  it('keeps a Google Sheets paste on the gdocs path even with Excel-shaped cells', () => {
    // Ordering lock: `x:num` is an Excel cell signal, and without the gdocs
    // guard `looksLikeExcel` would claim this. Sheets must keep using the
    // gdocs path when that signal is present. The payload must not also
    // match `looksLikeWord` (`urn:schemas-microsoft-com`, `mso-`): Word still
    // beats gdocs, which is how Outlook quoting a Google Doc is classified.
    const html =
      '<google-sheets-html-origin>' +
      '<table><tbody><tr><td x:num="1">1</td></tr></tbody></table>' +
      '</google-sheets-html-origin>'
    expect(detectSource(html)).toBe('gdocs')
    expect(looksLikeExcel(html)).toBe(false)
  })
})

describe('the copied grid survives as a table', () => {
  const normalized = normalizePastedHtml(EXCEL_FIXTURE)
  const { rows, listCount } = shapeOf(normalized)

  it('is two rows: a merged header and three numeric cells', () => {
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual([
      { text: 'Quarter', colspan: 2, rowspan: 1 },
      { text: '2024', colspan: 1, rowspan: 1 },
    ])
    expect(rows[1]).toEqual([
      { text: '1.25', colspan: 1, rowspan: 1 },
      { text: '2.50', colspan: 1, rowspan: 1 },
      { text: '3.75', colspan: 1, rowspan: 1 },
    ])
  })

  it('does not fabricate a list from the spreadsheet', () => {
    expect(listCount).toBe(0)
  })

  it('strips Excel cell classes and number-format CSS', () => {
    expect(normalized).not.toMatch(/xl\d/i)
    expect(normalized).not.toMatch(/mso-/i)
    expect(normalized).not.toContain('x:num')
    expect(normalized).not.toContain('Excel.Sheet')
  })

  it('keeps table structure attributes the schema models', () => {
    expect(normalized).toContain('width="192"')
    expect(normalized).toContain('colspan="2"')
  })
})

describe('mso-list inside a spreadsheet cell is not a Word list', () => {
  /**
   * The Word path's reconstructLists reads `mso-list` off any element, cells
   * included, and replaces that element with a `<ul>`/`<ol>`. A representative
   * Excel grid without the property survives Word (the algorithm is a no-op);
   * this is the shape that does not. The Excel path must not reconstruct.
   */
  const WITH_LIST_SIGNAL =
    '<html xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta name=ProgId content=Excel.Sheet></head><body>' +
    '<table class="MsoNormalTable" border="0" cellpadding="0" cellspacing="0">' +
    '<tr><td colspan="2">Region</td></tr>' +
    '<tr><td style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">·</span>North</td>' +
    '<td>12%</td></tr>' +
    '</table></body></html>'

  it('is detected as excel', () => {
    expect(detectSource(WITH_LIST_SIGNAL)).toBe('excel')
  })

  it('keeps the grid and does not emit a list', () => {
    const { rows, listCount } = shapeOf(normalizePastedHtml(WITH_LIST_SIGNAL))
    expect(listCount).toBe(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual([{ text: 'Region', colspan: 2, rowspan: 1 }])
    const data = rows[1] ?? []
    expect(data).toHaveLength(2)
    expect(data[0]?.text).toContain('North')
    expect(data[0]?.colspan).toBe(1)
    expect(data[1]).toEqual({ text: '12%', colspan: 1, rowspan: 1 })
  })
})

describe('the Excel normalizer', () => {
  it('promotes emphasis in a cell before styles are stripped', () => {
    const html =
      '<meta name=ProgId content=Excel.Sheet>' +
      '<table><tr><td><span style="font-weight:700">Total</span></td></tr></table>'
    expect(normalizeExcel(html)).toContain('<strong>Total</strong>')
  })

  it('is idempotent', () => {
    const once = normalizePastedHtml(EXCEL_FIXTURE)
    expect(normalizePastedHtml(once)).toBe(once)
  })
})
