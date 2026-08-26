import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import type { Node } from 'prosemirror-model'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { CellSelection, TableMap, mergeCells as mergeCellsRaw } from 'prosemirror-tables'
import { describe, expect, it } from 'vitest'
import {
  addColumnAfter,
  addRowAfter,
  addRowBefore,
  colgroupSyncPlugin,
  deleteColumn,
  deleteRow,
  insertTable,
  mergeCells,
  setCellVerticalAlign,
  setTableCaption,
  setTableColgroup,
  splitCell,
  toggleHeaderRow,
} from '../src/commands.js'

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

function cellsIn(doc: Node): { pos: number; node: Node; text: string }[] {
  const cells: { pos: number; node: Node; text: string }[] = []
  doc.descendants((node, pos) => {
    const role = node.type.spec['tableRole']
    if (role !== 'cell' && role !== 'header_cell') return true
    cells.push({ pos, node, text: node.textContent })
    return false
  })
  return cells
}

function cellMatching(doc: Node, text: string): { pos: number; node: Node; text: string } {
  const found = cellsIn(doc).find((cell) => cell.text === text)
  if (!found) throw new Error(`no cell with text ${JSON.stringify(text)}`)
  return found
}

function selectCells(state: EditorState, fromText: string, toText: string): EditorState {
  const from = cellMatching(state.doc, fromText)
  const to = cellMatching(state.doc, toText)
  return state.apply(state.tr.setSelection(CellSelection.create(state.doc, from.pos, to.pos)))
}

function tableNode(doc: Node): Node {
  let found: Node | null = null
  doc.descendants((node) => {
    if (node.type.spec['tableRole'] !== 'table') return true
    found = node
    return false
  })
  if (!found) throw new Error('no table')
  return found
}

function rowCells(doc: Node, rowIndex: number): Node[] {
  const rows: Node[] = []
  tableNode(doc).forEach((row) => rows.push(row))
  const row = rows[rowIndex]
  if (!row) throw new Error(`no row ${rowIndex}`)
  const cells: Node[] = []
  row.forEach((cell) => cells.push(cell))
  return cells
}

function withColgroupSync(state: EditorState): EditorState {
  return EditorState.create({
    doc: state.doc,
    selection: state.selection,
    plugins: [colgroupSyncPlugin()],
  })
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

const TWO_BY_TWO_SIZED =
  '<table><colgroup><col width="100"><col width="200"></colgroup><tbody>' +
  '<tr><th scope="col" data-colwidth="100">A</th><th scope="col" data-colwidth="200">B</th></tr>' +
  '<tr><td data-colwidth="100">C</td><td data-colwidth="200">D</td></tr>' +
  '</tbody></table>'

describe('merge and split keep colwidth and scope', () => {
  it('concatenates the merged columns’ colwidth onto the surviving cell', () => {
    const next = apply(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'), mergeCells)
    const merged = cellsIn(next.doc).find((cell) => (cell.node.attrs['colspan'] as number) === 2)
    expect(merged?.node.attrs['colwidth']).toEqual([100, 200])
    expect(merged?.node.attrs['colspan']).toBe(2)
  })

  it('partitions colwidth back onto the cells a split produces', () => {
    const merged = apply(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'), mergeCells)
    const next = apply(merged, splitCell)
    const headers = cellsIn(next.doc).filter((cell) => cell.node.type.name === 'table_header')
    expect(headers).toHaveLength(2)
    expect(headers[0]?.node.attrs['colwidth']).toEqual([100])
    expect(headers[1]?.node.attrs['colwidth']).toEqual([200])
    expect(headers[0]?.node.attrs['colspan']).toBe(1)
    expect(headers[1]?.node.attrs['colspan']).toBe(1)
  })

  it('keeps per-column integers on an odd split rather than averaging them', () => {
    const html =
      '<table><tbody>' +
      '<tr><th scope="col" data-colwidth="100">A</th><th scope="col" data-colwidth="101">B</th></tr>' +
      '</tbody></table>'
    const merged = apply(selectCells(stateIn(html, 'A'), 'A', 'B'), mergeCells)
    expect(cellsIn(merged.doc)[0]?.node.attrs['colwidth']).toEqual([100, 101])
    const next = apply(merged, splitCell)
    const headers = cellsIn(next.doc)
    expect(headers[0]?.node.attrs['colwidth']).toEqual([100])
    expect(headers[1]?.node.attrs['colwidth']).toEqual([101])
  })

  it('fills a missing cell colwidth from the stored colgroup on merge', () => {
    const html =
      '<table><colgroup><col width="100"><col width="200"></colgroup><tbody>' +
      '<tr><th scope="col" data-colwidth="100">A</th><th scope="col">B</th></tr>' +
      '</tbody></table>'
    const next = apply(selectCells(stateIn(html, 'A'), 'A', 'B'), mergeCells)
    expect(cellsIn(next.doc)[0]?.node.attrs['colwidth']).toEqual([100, 200])
  })

  it('copies colgroup-only widths onto a merge that spanned them', () => {
    const html =
      '<table><colgroup><col width="100"><col width="200"></colgroup><tbody>' +
      '<tr><th scope="col">A</th><th scope="col">B</th></tr>' +
      '</tbody></table>'
    const next = apply(selectCells(stateIn(html, 'A'), 'A', 'B'), mergeCells)
    expect(cellsIn(next.doc)[0]?.node.attrs['colwidth']).toEqual([100, 200])
  })

  it('leaves colwidth unset when neither the cells nor the colgroup know a width', () => {
    const html =
      '<table><tbody>' +
      '<tr><th scope="col">A</th><th scope="col">B</th></tr>' +
      '</tbody></table>'
    const next = apply(selectCells(stateIn(html, 'A'), 'A', 'B'), mergeCells)
    expect(cellsIn(next.doc)[0]?.node.attrs['colwidth']).toBeNull()
  })

  it('gives a two-column header scope="colgroup", not scope="col"', () => {
    const next = apply(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'), mergeCells)
    const merged = cellsIn(next.doc).find((cell) => (cell.node.attrs['colspan'] as number) === 2)
    expect(merged?.node.type.name).toBe('table_header')
    expect(merged?.node.attrs['scope']).toBe('colgroup')
  })

  it('restores scope="col" on each header after splitting a colgroup header', () => {
    const merged = apply(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'), mergeCells)
    const next = apply(merged, splitCell)
    const headers = cellsIn(next.doc).filter((cell) => cell.node.type.name === 'table_header')
    expect(headers[0]?.node.attrs['scope']).toBe('col')
    expect(headers[1]?.node.attrs['scope']).toBe('col')
  })

  it('clears a stale scope on a body cell the merge left behind', () => {
    const html =
      '<table><tbody>' +
      '<tr><td scope="col">A</td><td scope="col">B</td></tr>' +
      '</tbody></table>'
    const next = apply(selectCells(stateIn(html, 'A'), 'A', 'B'), mergeCells)
    const merged = cellsIn(next.doc)[0]
    expect(merged?.node.type.name).toBe('table_cell')
    expect(merged?.node.attrs['scope']).toBeNull()
  })

  it('keeps both columns after a resize of a merged cell so colgroup and cells agree', () => {
    let state = withColgroupSync(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'))
    state = apply(state, mergeCells)
    const merged = cellsIn(state.doc).find((cell) => (cell.node.attrs['colspan'] as number) === 2)
    if (!merged) throw new Error('expected a merged cell')
    expect(merged.node.attrs['colwidth']).toEqual([100, 200])

    // Column resize writes the dragged column's new width into that slot of
    // the cell's array and leaves the others. The fight the issue describes
    // is the next slot being 0, so the sync plugin then blanks that <col>.
    const colwidth = [...(merged.node.attrs['colwidth'] as number[])]
    colwidth[0] = 140
    const body = cellMatching(state.doc, 'C')
    let tr = state.tr
    tr = tr.setNodeMarkup(merged.pos, undefined, { ...merged.node.attrs, colwidth })
    tr = tr.setNodeMarkup(body.pos, undefined, { ...body.node.attrs, colwidth: [140] })
    state = state.apply(tr)

    const resized = cellsIn(state.doc).find((cell) => (cell.node.attrs['colspan'] as number) === 2)
    expect(resized?.node.attrs['colwidth']).toEqual([140, 200])
    const colgroup = tableNode(state.doc).attrs['colgroup'] as string
    expect(colgroup).toContain('width="140"')
    expect(colgroup).toContain('width="200"')
    expectColgroupMatchesTable(state.doc)
  })

  it('repairs stock mergeCells through the colgroup sync plugin', () => {
    // The toolbar still registers the upstream command (index.ts belongs to
    // another PR). The plugin has to make that path agree too.
    let state = withColgroupSync(selectCells(stateIn(TWO_BY_TWO_SIZED, 'A'), 'A', 'B'))
    state = apply(state, mergeCellsRaw)
    const merged = cellsIn(state.doc).find((cell) => (cell.node.attrs['colspan'] as number) === 2)
    expect(merged?.node.attrs['colwidth']).toEqual([100, 200])
    expect(merged?.node.attrs['scope']).toBe('colgroup')
  })
})

describe('insert row and column copy visual cell attrs', () => {
  it('copies align and background onto a row inserted below a styled cell', () => {
    const start = stateIn(
      '<table><tbody><tr>' +
        '<td align="right" class="banded" style="background-color:#ff0000">A</td>' +
        '<td>B</td>' +
        '</tr></tbody></table>',
      'A',
    )
    const next = apply(start, addRowAfter)
    const inserted = rowCells(next.doc, 1)
    expect(inserted[0]?.attrs['align']).toBe('right')
    expect(String(inserted[0]?.attrs['style'] ?? '')).toContain('background-color')
    expect(inserted[0]?.attrs['class']).toBeNull()
    expect(inserted[0]?.attrs['scope']).toBeNull()
    expect(inserted[1]?.attrs['align']).toBeNull()
    expect(inserted[1]?.attrs['style']).toBeNull()
  })

  it('copies colwidth onto a new row in the same columns', () => {
    const start = stateIn(
      '<table><tbody><tr>' +
        '<td data-colwidth="100">A</td><td data-colwidth="200">B</td>' +
        '</tr></tbody></table>',
      'A',
    )
    const next = apply(start, addRowAfter)
    const inserted = rowCells(next.doc, 1)
    expect(inserted[0]?.attrs['colwidth']).toEqual([100])
    expect(inserted[1]?.attrs['colwidth']).toEqual([200])
  })

  it('copies align onto a new column but not the neighbour’s colwidth', () => {
    const start = stateIn(
      '<table><tbody><tr>' +
        '<td align="center" data-colwidth="100">A</td><td>B</td>' +
        '</tr></tbody></table>',
      'A',
    )
    const next = apply(start, addColumnAfter)
    const cells = rowCells(next.doc, 0)
    expect(cells).toHaveLength(3)
    expect(cells[1]?.attrs['align']).toBe('center')
    expect(cells[1]?.attrs['colwidth']).toBeNull()
    expect(cells[0]?.attrs['colwidth']).toEqual([100])
  })

  it('does not copy a header’s background onto a body row inserted below it', () => {
    const start = stateIn(
      '<table><thead><tr>' +
        '<th scope="col" style="background-color:#00ff00">H1</th><th scope="col">H2</th>' +
        '</tr></thead>' +
        '<tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
      'H1',
    )
    const next = apply(start, addRowAfter)
    expect(tableSectionCounts(next)).toEqual({ headerRows: 1, footerRows: 0 })
    const inserted = rowCells(next.doc, 1)
    expect(inserted[0]?.type.name).toBe('table_cell')
    expect(inserted[0]?.attrs['style']).toBeNull()
    expect(inserted[0]?.attrs['scope']).toBeNull()
    expect(inserted[0]?.textContent).toBe('')
    expect(rowCells(next.doc, 2)[0]?.textContent).toBe('A')
  })
})

