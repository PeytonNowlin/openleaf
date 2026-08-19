import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { addColumnAfter, addRowAfter, insertTable, setCellVerticalAlign, setTableCaption, setTableColgroup, toggleHeaderRow } from '../src/index.js'

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
