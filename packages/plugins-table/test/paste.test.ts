/**
 * Paste into a table cell: nest, do not merge into the host grid.
 *
 * `tableEditing.handlePaste` unwraps a closed table into rows and runs
 * `insertCells` from the caret's cell. A 2×2 pasted at a text caret in a 2×2
 * replaced the host; a slice of loose cells rewrote `colspan` on cells the
 * author had not selected. These tests drive the live plugin stack through
 * `handlePaste`, which is the seam `tableEditing` also occupies.
 */

import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import type { Node } from 'prosemirror-model'
import { Fragment, Slice } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { tableEditingPlugins } from '../src/index.js'

const HOST =
  '<table><tbody>' +
  '<tr><td colspan="2">Wide</td><td>Side</td></tr>' +
  '<tr><td>Target</td><td>Sibling</td><td>Corner</td></tr>' +
  '</tbody></table>'

const INNER_TABLE =
  '<table><tbody>' +
  '<tr><td>Inner A</td><td>Inner B</td></tr>' +
  '<tr><td>Inner C</td><td>Inner D</td></tr>' +
  '</tbody></table>'

let view: EditorView | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

function posOfText(doc: Node, text: string): number {
  let pos = -1
  doc.descendants((node, nodePos) => {
    if (node.isText && node.text === text) {
      pos = nodePos
      return false
    }
    return true
  })
  if (pos < 0) throw new Error(`no text ${JSON.stringify(text)}`)
  return pos
}

function cellPosOfText(doc: Node, text: string): number {
  const $pos = doc.resolve(posOfText(doc, text))
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec['tableRole'] as string | undefined
    if (role === 'cell' || role === 'header_cell') return $pos.before(depth)
  }
  throw new Error(`no cell for ${JSON.stringify(text)}`)
}

function mount(html: string, caretAt: string): EditorView {
  const place = document.createElement('div')
  document.body.append(place)
  const doc = parseHtml(html)
  view = new EditorView(place, {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, posOfText(doc, caretAt)),
      plugins: tableEditingPlugins(),
    }),
  })
  return view
}

function applyPaste(editor: EditorView, slice: Slice): boolean {
  return Boolean(editor.someProp('handlePaste', (fn) => fn(editor, {} as ClipboardEvent, slice)))
}

function tableNode(html: string): Node {
  const doc = parseHtml(html)
  let table: Node | null = null
  doc.forEach((node) => {
    if (node.type.name === 'table') table = node
  })
  if (!table) throw new Error(`no table in ${html}`)
  return table
}

function closedTableSlice(html: string): Slice {
  return new Slice(Fragment.from(tableNode(html)), 0, 0)
}

function looseCellSlice(html: string): Slice {
  return new Slice(tableNode(html).content, 0, 0)
}

function tableCount(doc: Node): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'table') count += 1
    return true
  })
  return count
}

function colspanOf(doc: Node, text: string): number {
  let found: number | null = null
  doc.descendants((node) => {
    if (found !== null) return false
    if (node.type.name !== 'table_cell' && node.type.name !== 'table_header') return true
    if (node.textContent.includes(text)) found = node.attrs['colspan'] as number
    return true
  })
  if (found === null) throw new Error(`no cell containing ${JSON.stringify(text)}`)
  return found
}

describe('paste of a whole table at a text caret in a cell', () => {
  it('nests the table and keeps the host grid, including unrelated colspan', () => {
    const editor = mount(HOST, 'Target')
    expect(applyPaste(editor, closedTableSlice(INNER_TABLE))).toBe(true)

    const { doc } = editor.state
    expect(tableCount(doc)).toBe(2)
    expect(colspanOf(doc, 'Wide')).toBe(2)

    const html = serializeHtml(doc)
    expect(html).toContain('Target')
    expect(html).toContain('Sibling')
    expect(html).toContain('Corner')
    expect(html).toContain('Side')
    expect(html).toContain('Wide')
    expect(html).toContain('Inner A')
    expect(html).toContain('Inner D')
    expect(html.match(/<table/g)?.length).toBe(2)
  })
})

describe('paste of loose cells at a text caret in a cell', () => {
  it('wraps them in a nested table rather than mapping onto the host', () => {
    const editor = mount(HOST, 'Target')
    expect(applyPaste(editor, looseCellSlice(INNER_TABLE))).toBe(true)

    const { doc } = editor.state
    expect(tableCount(doc)).toBe(2)
    expect(colspanOf(doc, 'Wide')).toBe(2)
    expect(serializeHtml(doc)).toContain('Sibling')
    expect(serializeHtml(doc)).toContain('Inner A')
  })
})

describe('paste onto a CellSelection', () => {
  it('still maps onto the selected cells and does not rewrite other colspan', () => {
    const editor = mount(HOST, 'Target')
    const { doc } = editor.state
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(doc, cellPosOfText(doc, 'Target'), cellPosOfText(doc, 'Sibling')),
      ),
    )

    const pasted = '<table><tbody><tr><td>X</td><td>Y</td></tr></tbody></table>'
    expect(applyPaste(editor, closedTableSlice(pasted))).toBe(true)

    const next = editor.state.doc
    expect(tableCount(next)).toBe(1)
    expect(colspanOf(next, 'Wide')).toBe(2)
    const html = serializeHtml(next)
    expect(html).toContain('X')
    expect(html).toContain('Y')
    expect(html).toContain('Wide')
    expect(html).toContain('Side')
    expect(html).toContain('Corner')
    expect(html).not.toContain('Target')
    expect(html).not.toContain('Sibling')
  })
})

describe('paste of non-table content in a cell', () => {
  it('is not claimed, so ordinary paste still runs', () => {
    const editor = mount(HOST, 'Target')
    const paragraph = parseHtml('<p>Hello</p>').child(0)
    expect(applyPaste(editor, new Slice(Fragment.from(paragraph), 0, 0))).toBe(false)
    expect(tableCount(editor.state.doc)).toBe(1)
    expect(serializeHtml(editor.state.doc)).toContain('Target')
  })
})
