import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { TableMap } from 'prosemirror-tables'
import { describe, expect, it } from 'vitest'
import {
  addColumnAfter,
  addRowAfter,
  addRowBefore,
  colgroupSyncPlugin,
  deleteColumn,
  deleteRow,
  insertTable,
  setCellVerticalAlign,
  setTableCaption,
  setTableColgroup,
  toggleHeaderRow,
} from '../src/index.js'

function stateIn(html: string, text: string): EditorState {
  const doc = parseHtml(html)
  let pos = 1
  doc.descendants((node, nodePos) => {
    if (node.isText && node.text === text) {
      pos = nodePos
      return false
    }
    return true
  })
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos),
  })
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state
  const ok = command(state, (tr: Transaction) => {
    next = state.apply(tr)
  })
  expect(ok).toBe(true)
  return next
}

function tableSectionCounts(state: EditorState): { headerRows: number; footerRows: number } {
  let headerRows = 0
  let footerRows = 0
  state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    headerRows = (node.attrs['headerRows'] as number) || 0
    footerRows = (node.attrs['footerRows'] as number) || 0
    return false
  })
  return { headerRows, footerRows }
}

describe('header cell scope', () => {
  it('gives a new row-opening header scope="row", not scope="col"', () => {
    // The new <th> heads its row, so "col" would tell a screen reader the
    // opposite of the truth.
    const start = stateIn(
      '<table><tbody><tr><th scope="row">North</th><td>412</td></tr></tbody></table>',
      'North',
    )
    const html = serializeHtml(apply(start, addRowAfter).doc)
    expect(html).toContain('<th scope="row"></th>')
    expect(html).not.toContain('<th scope="col">')
  })

  it('keeps scope="col" for a header added to the top row', () => {
    const start = stateIn(
      '<table><tbody><tr><th scope="col">Region</th></tr><tr><td>North</td></tr></tbody></table>',
      'Region',
    )
    expect(serializeHtml(apply(start, addColumnAfter).doc)).toContain(
      '<th scope="col">Region</th><th scope="col">',
    )
  })

  it('drops scope when a header row becomes body cells', () => {
    const start = stateIn(
      '<table><tbody><tr><th scope="col">Region</th><th scope="col">Total</th></tr><tr><td>North</td><td>412</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, toggleHeaderRow).doc)
    expect(html).not.toContain('<th')
    expect(html).not.toMatch(/<td[^>]*scope/)
    expect(html).toContain('<td>Region</td>')
  })

  it('restores scope="col" when a body row becomes a header', () => {
    const start = stateIn(
      '<table><tbody><tr><td>Region</td><td>Total</td></tr><tr><td>North</td><td>412</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, toggleHeaderRow).doc)
    expect(html).toMatch(/<th scope="col">Region<\/th>/)
    expect(html).toMatch(/<th scope="col">Total<\/th>/)
  })

  it('gives a new header cell the same scope insertTable uses', () => {
    const start = stateIn(
      '<table><tbody><tr><th scope="col">Region</th></tr><tr><td>North</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, addColumnAfter).doc)
    expect(html.match(/<th scope="col">/g)?.length).toBe(2)
    expect(html).not.toMatch(/<th>/)
  })
})

describe('caption, alignment and nested tables', () => {
  it('writes a caption onto a table that had none', () => {
    const start = stateIn('<table><tbody><tr><td>A</td></tr></tbody></table>', 'A')
    const html = serializeHtml(apply(start, setTableCaption('Q1 results')).doc)
    expect(html).toContain('<caption>Q1 results</caption>')
  })

  it('sets cell vertical alignment', () => {
    const start = stateIn('<table><tbody><tr><td>A</td></tr></tbody></table>', 'A')
    const html = serializeHtml(apply(start, setCellVerticalAlign('middle')).doc)
    expect(html).toContain('valign="middle"')
  })

  it('writes a colgroup from column widths', () => {
    const start = stateIn(
      '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
      'A',
    )
    const html = serializeHtml(apply(start, setTableColgroup(['120', '80'])).doc)
    expect(html).toContain('<colgroup>')
    expect(html).toContain('width="120"')
    expect(html).toContain('width="80"')
  })

  it('inserts a nested table inside a cell', () => {
    const start = stateIn('<table><tbody><tr><td>A</td></tr></tbody></table>', 'A')
    const html = serializeHtml(apply(start, insertTable(2, 2)).doc)
    expect(html.match(/<table/g)?.length).toBe(2)
    expect(html).toContain('<th scope="col">')
  })
})

const THREE_COL =
  '<table><colgroup><col width="100" class="c1"><col width="200" class="c2"><col width="300" class="c3"></colgroup>' +
  '<tr><td>a</td><td>b</td><td>c</td></tr></table>'

/** Columns the stored colgroup claims to describe, honouring `span`. */
function colgroupCoverage(html: string): number {
  const group = html.match(/<colgroup[\s\S]*?<\/colgroup>/)?.[0] ?? ''
  let columns = 0
  for (const match of group.matchAll(/<col\b([^>]*)>/g)) {
    const span = /span="(\d+)"/.exec(match[1] ?? '')
    columns += span ? Number(span[1]) : 1
  }
  return columns
}

function tableWidth(doc: ReturnType<typeof parseHtml>): number {
  let width = 0
  doc.descendants((node) => {
    if (node.type.spec['tableRole'] === 'table') {
      width = TableMap.get(node).width
      return false
    }
    return true
  })
  return width
}

function expectColgroupMatchesTable(doc: ReturnType<typeof parseHtml>): void {
  expect(colgroupCoverage(serializeHtml(doc))).toBe(tableWidth(doc))
}

describe('colgroup tracks column insert and delete', () => {
  it('drops the middle <col> so the last column keeps class c3', () => {
    const next = apply(stateIn(THREE_COL, 'b'), deleteColumn)
    const html = serializeHtml(next.doc)
    expect(html).toContain('class="c1"')
    expect(html).toContain('class="c3"')
    expect(html).not.toContain('class="c2"')
    expect(html).toContain('width="100"')
    expect(html).toContain('width="300"')
    expect(html).not.toContain('width="200"')
    expectColgroupMatchesTable(next.doc)
  })

  it('inserts a bare <col> so later columns keep their own widths', () => {
    const next = apply(stateIn(THREE_COL, 'a'), addColumnAfter)
    const html = serializeHtml(next.doc)
    expect(html).toContain('class="c1"')
    expect(html).toContain('class="c2"')
    expect(html).toContain('class="c3"')
    expect(html).toMatch(/<colgroup>.*<col>.*class="c2"/)
    expectColgroupMatchesTable(next.doc)
  })

  it('drops the last <col> without shifting the ones that remain', () => {
    const next = apply(stateIn(THREE_COL, 'c'), deleteColumn)
    const html = serializeHtml(next.doc)
    expect(html).toContain('class="c1"')
    expect(html).toContain('class="c2"')
    expect(html).not.toContain('class="c3"')
    expectColgroupMatchesTable(next.doc)
  })

  it('decrements span when the deleted column sits inside a spanned <col>', () => {
    const start = stateIn(
      '<table><colgroup><col span="2" width="100" class="wide"><col width="80" class="narrow"></colgroup>' +
        '<tr><td>a</td><td>b</td><td>c</td></tr></table>',
      'a',
    )
    const next = apply(start, deleteColumn)
    const html = serializeHtml(next.doc)
    expect(html).toContain('class="wide"')
    expect(html).not.toContain('span=')
    expect(html).toContain('class="narrow"')
    expectColgroupMatchesTable(next.doc)
  })

  it('splits a spanned <col> around an insert so later columns keep their width', () => {
    const start = stateIn(
      '<table><colgroup><col span="2" width="100" class="wide"><col width="80"></colgroup>' +
        '<tr><td>a</td><td>b</td><td>c</td></tr></table>',
      'a',
    )
    const next = apply(start, addColumnAfter)
    const html = serializeHtml(next.doc)
    expect(html).toMatch(/class="wide".*<col>.*class="wide"/)
    expect(html).toContain('width="80"')
    expectColgroupMatchesTable(next.doc)
  })

  it('still patches widths from a resize after a delete, without restoring the dropped <col>', () => {
    const afterDelete = apply(stateIn(THREE_COL, 'b'), deleteColumn)
    let state = EditorState.create({
      doc: afterDelete.doc,
      selection: TextSelection.create(afterDelete.doc, 1),
      plugins: [colgroupSyncPlugin()],
    })
    let tr = state.tr
    let index = 0
    state.doc.descendants((node, pos) => {
      if (node.type.spec['tableRole'] !== 'cell' && node.type.spec['tableRole'] !== 'header_cell') {
        return true
      }
      if (index === 0) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [140] })
      if (index === 1) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [60] })
      index += 1
      return false
    })
    state = state.apply(tr)
    const html = serializeHtml(state.doc)
    expect(html).toContain('class="c1"')
    expect(html).toContain('class="c3"')
    expect(html).not.toContain('class="c2"')
    expect(html).toContain('width="140"')
    expect(html).toContain('width="60"')
    expectColgroupMatchesTable(state.doc)
  })
})

describe('table section row counts', () => {
  // headerRows/footerRows are how serialize rebuilds thead/tfoot. The row
  // commands have to keep those counts attached to the rows that are still
  // in those sections; otherwise a data row is promoted into thead (issue #132).

  it('drops headerRows when the header row is deleted, instead of promoting the next row', () => {
    const start = stateIn(
      '<table><thead><tr><th>Region</th><th>Total</th></tr></thead>' +
        '<tbody><tr><td>North</td><td>412</td></tr><tr><td>South</td><td>77</td></tr></tbody></table>',
      'Region',
    )
    expect(tableSectionCounts(start)).toEqual({ headerRows: 1, footerRows: 0 })
    const next = apply(start, deleteRow)
    expect(tableSectionCounts(next)).toEqual({ headerRows: 0, footerRows: 0 })
    const html = serializeHtml(next.doc)
    expect(html).not.toContain('<thead>')
    expect(html).toContain('<td>North</td>')
    expect(html).toContain('<td>South</td>')
  })

  it('inserts addRowBefore of a header row into the body, not into thead', () => {
    const start = stateIn(
      '<table><thead><tr><th>Region</th><th>Total</th></tr></thead>' +
        '<tbody><tr><td>North</td><td>412</td></tr><tr><td>South</td><td>77</td></tr></tbody></table>',
      'Region',
    )
    const next = apply(start, addRowBefore)
    expect(tableSectionCounts(next)).toEqual({ headerRows: 1, footerRows: 0 })
    const html = serializeHtml(next.doc)
    expect(html).toMatch(/<thead>[\s\S]*Region[\s\S]*<\/thead>/)
    expect(html).not.toMatch(/<thead>[\s\S]*<td><\/td>[\s\S]*<\/thead>/)
    expect(html).toContain('<td></td><td></td>')
    expect(html).toContain('<td>North</td>')
  })

  it('drops footerRows when the footer row is deleted, instead of promoting the last body row', () => {
    const start = stateIn(
      '<table><thead><tr><th>h1</th><th>h2</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody>' +
        '<tfoot><tr><td>c</td><td>d</td></tr></tfoot></table>',
      'c',
    )
    expect(tableSectionCounts(start)).toEqual({ headerRows: 1, footerRows: 1 })
    const next = apply(start, deleteRow)
    expect(tableSectionCounts(next)).toEqual({ headerRows: 1, footerRows: 0 })
    const html = serializeHtml(next.doc)
    expect(html).not.toContain('<tfoot>')
    expect(html).toMatch(/<thead>[\s\S]*h1[\s\S]*<\/thead>/)
    expect(html).toContain('<td>a</td>')
    expect(html).not.toContain('<td>c</td>')
  })
})
