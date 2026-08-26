/**
 * Visibility gates on the floating selection and insert bars.
 *
 * Placement is pointer-driven on purpose; these tests are about *whether*
 * a bar is on screen, not where. A test that only checks the normal case
 * would pass against the unfixed code, which showed a bar for any non-empty
 * selection and any empty textblock.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { AllSelection, EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingToolbars } from '../src/floating.js'
import { registerDefaultItems } from '../src/items.js'

registerDefaultItems()

const mounted: FloatingToolbars[] = []

function rect(width = 400, height = 200): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {
      return this
    },
  }
}

function fixture(
  html: string,
  options: {
    focused?: boolean
    editable?: boolean
    readonly?: boolean
    selection?: (state: EditorState) => EditorState
  } = {},
): {
  host: HTMLElement
  view: EditorView
  bars: FloatingToolbars
  setFocused: (next: boolean) => void
  selection: HTMLElement
  insert: HTMLElement
} {
  const host = document.createElement('div')
  host.className = 'ol-editor'
  if (options.readonly) host.setAttribute('readonly', '')
  document.body.appendChild(host)

  const canvas = document.createElement('div')
  canvas.className = 'ProseMirror'
  canvas.getBoundingClientRect = () => rect()
  host.appendChild(canvas)
  host.getBoundingClientRect = () => rect()

  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  if (options.selection) state = options.selection(state)

  let focused = options.focused ?? true
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus: () => {
      focused = true
    },
    hasFocus: () => focused,
    get editable() {
      return options.editable ?? !host.hasAttribute('readonly')
    },
    isDestroyed: false,
    dom: canvas,
    coordsAtPos: () => ({ left: 24, right: 24, top: 40, bottom: 56 }),
  } as unknown as EditorView

  const bars = new FloatingToolbars(host, document, {
    selectionLayout: 'bold italic',
    insertLayout: 'image',
  })
  mounted.push(bars)
  bars.mount(view)

  const selection = host.querySelector('.ol-toolbar.ol-floating[aria-label="Selection formatting"]')
  const insert = host.querySelector('.ol-toolbar.ol-floating[aria-label="Insert"]')
  if (!(selection instanceof HTMLElement) || !(insert instanceof HTMLElement)) {
    throw new Error('expected both floating bars')
  }
  return {
    host,
    view,
    bars,
    setFocused: (next) => {
      focused = next
    },
    selection,
    insert,
  }
}

function rangeInside(find: (node: { textContent: string }) => boolean): (state: EditorState) => EditorState {
  return (state) => {
    let from = -1
    let to = -1
    state.doc.descendants((node, pos) => {
      if (from >= 0) return false
      if (!find(node) || !node.isTextblock || node.content.size === 0) return true
      from = pos + 1
      to = pos + node.content.size + 1
      return false
    })
    if (from < 0) throw new Error('no matching textblock')
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  }
}

function selectAtom(name: string): (state: EditorState) => EditorState {
  return (state) => {
    let pos = -1
    state.doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      if (node.type.name === name) {
        pos = nodePos
        return false
      }
      return true
    })
    if (pos < 0) throw new Error(`no ${name}`)
    return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
  }
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  for (const bars of mounted.splice(0)) bars.destroy()
})

describe('floating toolbar visibility', () => {
  it('shows the selection bar for a focused, editable, unlocked range', () => {
    const { selection, insert } = fixture('<p>hello</p>', {
      selection: (state) =>
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6))),
    })
    expect(selection.hidden).toBe(false)
    expect(insert.hidden).toBe(true)
  })

  it('shows the insert bar on mount of a focused empty block', () => {
    // Mount path, not the update path: an editor that opens on an empty
    // paragraph used to wait for a transaction, then (after the CSS `hidden`
    // fix) showed regardless of focus. Both are wrong; this is the remaining
    // honest case.
    const { insert, selection } = fixture('<p></p>')
    expect(insert.hidden).toBe(false)
    expect(selection.hidden).toBe(true)
  })

  it('hides both bars when the view is unfocused', () => {
    const { selection, insert } = fixture('<p>hello</p>', {
      focused: false,
      selection: (state) =>
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6))),
    })
    expect(selection.hidden).toBe(true)
    expect(insert.hidden).toBe(true)
  })

  it('hides the insert bar on mount of an unfocused empty editor', () => {
    const { insert } = fixture('<p></p>', { focused: false })
    expect(insert.hidden).toBe(true)
  })

  it('hides both bars when the host is readonly', () => {
    const { selection, insert } = fixture('<p></p>', { readonly: true })
    expect(selection.hidden).toBe(true)
    expect(insert.hidden).toBe(true)
  })

  it('hides the insert bar on mount of a readonly empty editor', () => {
    const { insert } = fixture('<p></p>', { readonly: true, focused: true })
    expect(insert.hidden).toBe(true)
  })

  it('hides the selection bar when the range is inside a locked node', () => {
    const { selection, insert } = fixture('<p>before</p><p contenteditable="false">locked</p><p>after</p>', {
      selection: rangeInside((node) => node.textContent === 'locked'),
    })
    expect(selection.hidden).toBe(true)
    expect(insert.hidden).toBe(true)
  })

  it('shows the selection bar for a range that spans a locked node', () => {
    // Endpoints sit in unlocked paragraphs; the locked block is in the middle.
    // Hiding here would take Bold away from Select All on any document that
    // happens to contain one locked region. Commands already no-op inside it.
    const html = '<p>before</p><p contenteditable="false">locked</p><p>after</p>'
    const { selection } = fixture(html, {
      selection: (state) =>
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1))),
    })
    expect(selection.hidden).toBe(false)
  })

  it('shows the selection bar on Select All over a document that contains a locked node', () => {
    const html = '<p>before</p><p contenteditable="false">locked</p><p>after</p>'
    const { selection } = fixture(html, {
      selection: (state) => state.apply(state.tr.setSelection(new AllSelection(state.doc))),
    })
    expect(selection.hidden).toBe(false)
  })

  it('hides the selection bar on a preserved atom', () => {
    const { selection } = fixture(
      '<p>x</p><div class="callout" data-callout-id="7"><p>keep</p></div><p>y</p>',
      { selection: selectAtom('unknown_block') },
    )
    expect(selection.hidden).toBe(true)
  })

  it('still shows the selection bar during a pointer sequence that has not focused yet', () => {
    // The trap a naive `hasFocus()` guard falls into: some engines leave
    // `hasFocus()` false while a drag-select is establishing the range.
    const { view, selection, setFocused } = fixture('<p>hello</p>', {
      focused: false,
      selection: (state) =>
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6))),
    })
    expect(selection.hidden).toBe(true)
    // jsdom has no PointerEvent; the listener reads `button` off the event
    // object and treats a missing one as the primary button.
    view.dom.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(selection.hidden).toBe(false)
    setFocused(true)
    view.dom.ownerDocument.dispatchEvent(new Event('pointerup', { bubbles: true }))
    expect(selection.hidden).toBe(false)
  })

  it('hides on a later readonly attribute without waiting for a transaction', async () => {
    const { host, insert } = fixture('<p></p>')
    expect(insert.hidden).toBe(false)
    host.setAttribute('readonly', '')
    await vi.waitFor(() => expect(insert.hidden).toBe(true))
  })

  it('hides when focus leaves the view, and shows again when it returns', async () => {
    const { view, selection, setFocused } = fixture('<p>hello</p>', {
      selection: (state) =>
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6))),
    })
    expect(selection.hidden).toBe(false)
    setFocused(false)
    view.dom.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    await vi.waitFor(() => expect(selection.hidden).toBe(true))
    setFocused(true)
    view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(selection.hidden).toBe(false)
  })
})
