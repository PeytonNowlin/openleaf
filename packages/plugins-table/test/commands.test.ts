import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { addColumnAfter, addRowAfter, addRowBefore, deleteRow, insertTable, setCellVerticalAlign, setTableCaption, setTableColgroup, toggleHeaderRow } from '../src/index.js'

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
