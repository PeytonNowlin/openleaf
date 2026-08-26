/**
 * The editor-only context menu: the pointer sequence that opened it, and
 * where a left-edge click is placed.
 *
 * Both defects here were a capture-phase closer and a `clientX <= 0` caret
 * fallback that no existing test dispatched a pointer event at. jsdom is
 * honest for the DOM contract -- the menu's `hidden` flag, and the pixel
 * `style.left` `#place` writes. Layout-dependent caret geometry is the e2e
 * suite's job; here `coordsAtPos` is stubbed so caret-fallback and click
 * coordinates cannot collapse to the same number.
 */

import { TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

const live: OpenLeafEditor[] = []

afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await flush()
})

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeEditor(html: string): OpenLeafEditor {
  const el = document.createElement('openleaf-editor') as OpenLeafEditor
  el.innerHTML = html
  live.push(el)
  return el
}

function menuOf(el: OpenLeafEditor): HTMLElement {
  const menu = el.querySelector<HTMLElement>('[role="menu"][aria-label="Editor menu"]')
  if (!menu) throw new Error('the editor built no context menu')
  return menu
}

function linkOf(el: OpenLeafEditor): HTMLAnchorElement {
  const link = el.querySelector<HTMLAnchorElement>('[role="textbox"] a, .ProseMirror a, a')
  if (!link) throw new Error('no link in the editor to open a menu on')
  return link
}

/**
 * A pointer-shaped event jsdom will accept.
 *
 * jsdom has no `PointerEvent`. The code under test only reads `type`,
 * `pointerId`, `clientX`/`clientY` and `target`, so a MouseEvent with
 * `pointerId` defined is the same contract the resize-handle tests use.
 */
function pointer(
  type: string,
  init: { pointerId: number; pointerType?: string; clientX?: number; clientY?: number; button?: number },
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId })
  if (init.pointerType !== undefined) {
    Object.defineProperty(event, 'pointerType', { value: init.pointerType })
  }
  return event
}

const CARET = { left: 320, right: 320, top: 80, bottom: 100 }

function stubCaret(el: OpenLeafEditor): void {
  const view = el.view
  if (!view) throw new Error('no view to stub')
  view.coordsAtPos = () => CARET
}

function placeCaretInLink(el: OpenLeafEditor): void {
  const view = el.view
  if (!view) throw new Error('no view to place the caret in')
  let at: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (at !== null || !node.isText) return
    if (node.marks.some((mark) => mark.type.name === 'link')) at = pos + 1
  })
  if (at === null) throw new Error('no link mark to put the caret in')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
}

describe('the pointer sequence that opened the context menu', () => {
  /*
   * Hybrid / long-press engines fire `contextmenu` and then a follow-up
   * `pointerdown` for the same pointer. The document capture closer treated
   * that down as an outside click, so the menu never stayed open -- and
   * preventDefault had already eaten the browser's.
   */
  it('stays open for a follow-up pointerdown with the same pointerId', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()

    const link = linkOf(el)
    const id = 7
    link.dispatchEvent(pointer('contextmenu', { pointerId: id, clientX: 40, clientY: 40 }))
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)

    link.dispatchEvent(pointer('pointerdown', { pointerId: id, pointerType: 'touch' }))
    expect(menu.hidden).toBe(false)
    expect(el.contains(menu)).toBe(true)
  })

  it('closes on a later, distinct pointerdown', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()

    const link = linkOf(el)
    link.dispatchEvent(pointer('contextmenu', { pointerId: 7, clientX: 40, clientY: 40 }))
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)

    link.dispatchEvent(pointer('pointerdown', { pointerId: 7, pointerType: 'touch' }))
    expect(menu.hidden).toBe(false)

    document.dispatchEvent(pointer('pointerdown', { pointerId: 99, pointerType: 'mouse' }))
    expect(menu.hidden).toBe(true)
  })

  it('closes on the same pointerId after that sequence is released', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()

    const link = linkOf(el)
    const id = 1
    link.dispatchEvent(pointer('pointerdown', { pointerId: id, button: 2 }))
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)

    // Same id, still down: the rest of the opening sequence, not a dismissal.
    link.dispatchEvent(pointer('pointerdown', { pointerId: id }))
    expect(menu.hidden).toBe(false)

    document.dispatchEvent(pointer('pointerup', { pointerId: id }))
    document.dispatchEvent(pointer('pointerdown', { pointerId: id }))
    expect(menu.hidden).toBe(true)
  })

  it('does not arm a swallow on the keyboard path, so a pointer still dismisses', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()
    placeCaretInLink(el)
    stubCaret(el)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)

    document.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'mouse' }))
    expect(menu.hidden).toBe(true)
  })
})

describe('where the context menu is placed', () => {
  it('uses the event coordinates when clientX is 0, not the caret', async () => {
    const el = makeEditor(
      '<p>A long first paragraph that is not the click target.</p>' +
        '<p>See <a href="https://example.org">this link</a>.</p>',
    )
    document.body.appendChild(el)
    await flush()
    stubCaret(el)

    linkOf(el).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 50 }),
    )
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)
    // `#place` clamps a real x onto the viewport: 0 becomes 4, not the stubbed caret at 320.
    expect(menu.style.left).toBe('4px')
  })

  it('treats a negative clientX as a real coordinate, not a missing one', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()
    stubCaret(el)

    linkOf(el).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: -12, clientY: 50 }),
    )
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)
    expect(menu.style.left).toBe('4px')
  })

  it('places a keyboard open at the caret', async () => {
    const el = makeEditor('<p>See <a href="https://example.org">this link</a>.</p>')
    document.body.appendChild(el)
    await flush()
    placeCaretInLink(el)
    stubCaret(el)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
    const menu = menuOf(el)
    expect(menu.hidden).toBe(false)
    expect(menu.style.left).toBe(`${CARET.left}px`)
  })
})
