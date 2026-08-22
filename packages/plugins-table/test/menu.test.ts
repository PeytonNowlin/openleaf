/**
 * The table context menu under `readonly`.
 *
 * This menu is bound directly on `view.dom` -- deliberately, because
 * cell-selection handling in `prosemirror-tables` can swallow a `contextmenu`
 * event before a later plugin sees it. That is also what takes it out of
 * ProseMirror's `editable` gate, which is the guard typing, paste, drop and the
 * keymaps get for free. So a read-only editor opened this menu with all fourteen
 * entries live, and Delete row worked -- from the mouse, and from Shift+F10,
 * which fires `contextmenu` too.
 *
 * Driven through real DOM events rather than by calling internals: the whole
 * defect was that the listener was reachable, so reaching it the same way is the
 * test.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { tableContextMenu } from '../src/menu.js'

const TABLE =
  '<table><tbody><tr><th scope="col">Region</th></tr><tr><td>North</td></tr></tbody></table>'

let view: EditorView | undefined
let host: HTMLElement | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
  host = undefined
  document.body.innerHTML = ''
})

/**
 * Mount an editor inside an `openleaf-editor` host, which is what the menu looks
 * up to find the element it belongs to.
 */
function mount(editable: boolean): { view: EditorView; host: HTMLElement } {
  const element = document.createElement('openleaf-editor')
  document.body.append(element)
  const place = document.createElement('div')
  element.append(place)
  const doc = parseHtml(TABLE, { schema: coreSchema() })
  let cell = 1
  doc.descendants((node, pos) => {
    if (node.isText && node.text === 'North') {
      cell = pos
      return false
    }
    return true
  })
  view = new EditorView(place, {
    editable: () => editable,
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, cell),
      plugins: [tableContextMenu()],
    }),
  })
  host = element
  return { view, host: element }
}

/**
 * A `contextmenu` at the cell, with coordinates the view can resolve.
 *
 * jsdom gives every element a zero rect, so `posAtCoords` cannot work from real
 * geometry. The menu reads the position under the pointer for a good reason --
 * right-clicking a second table must not act on the first -- so that lookup is
 * stubbed to return the cell the selection is already in, which is what a real
 * click on it would produce.
 */
function rightClick(editor: EditorView): boolean {
  const pos = editor.state.selection.from
  editor.posAtCoords = () => ({ pos, inside: pos })
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  editor.dom.dispatchEvent(event)
  return event.defaultPrevented
}

const menuIn = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>('.ol-table-menu')

const itemsIn = (element: HTMLElement): HTMLButtonElement[] => [
  ...element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
]

const rowCount = (editor: EditorView): number => {
  let rows = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table_row') rows += 1
    return true
  })
  return rows
}

describe('an editable table', () => {
  it('opens the menu on a secondary click', () => {
    const editor = mount(true)
    expect(rightClick(editor.view)).toBe(true)
    const menu = menuIn(editor.host)
    expect(menu).not.toBeNull()
    expect(menu?.hidden).toBe(false)
    expect(itemsIn(editor.host).length).toBeGreaterThan(0)
  })

  it('runs the command that was clicked', () => {
    const editor = mount(true)
    rightClick(editor.view)
    const before = rowCount(editor.view)
    const deleteRow = itemsIn(editor.host).find((item) => item.textContent === 'Delete row')
    if (!deleteRow) throw new Error('no Delete row item')
    deleteRow.click()
    expect(rowCount(editor.view)).toBe(before - 1)
  })
})

describe('a read-only table', () => {
  it('opens nothing, and leaves the browser its own menu', () => {
    const editor = mount(false)
    // Not prevented: a read-only author should get copy and inspect, not a
    // table editor.
    expect(rightClick(editor.view)).toBe(false)
    expect(menuIn(editor.host)).toBeNull()
  })

  it('does not delete a row when the item is clicked anyway', () => {
    // The menu is built once and `readonly` can arrive afterwards, so the state
    // an item advertises is not the last word: the check is re-asked in `run`.
    const editor = mount(true)
    rightClick(editor.view)
    const before = rowCount(editor.view)
    const deleteRow = itemsIn(editor.host).find((item) => item.textContent === 'Delete row')
    if (!deleteRow) throw new Error('no Delete row item')

    editor.view.setProps({ editable: () => false })
    deleteRow.click()
    expect(rowCount(editor.view)).toBe(before)
  })

  it('dismisses an open menu when readonly arrives', () => {
    const editor = mount(true)
    rightClick(editor.view)
    expect(menuIn(editor.host)?.hidden).toBe(false)
    // `setProps` is what the element calls from `attributeChangedCallback`, and
    // it runs the plugin views.
    editor.view.setProps({ editable: () => false })
    expect(menuIn(editor.host)?.hidden).toBe(true)
  })
})
