/**
 * What an image resize drag costs the document.
 *
 * Every `pointermove` used to dispatch a `docChanged` transaction. A pointer
 * reports at 60-120 Hz, so a two-second drag paid the full per-keystroke bill
 * about a hundred and eighty times -- and wrote a hundred and eighty undo
 * entries, so getting back past the drag meant that many presses of Ctrl-Z.
 *
 * Counting tests, not timing tests: "how many transactions did the drag
 * dispatch" is the same number on every machine. Confirmed to go red against
 * the unfixed code.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { imageResizePlugin } from '../src/resize.js'

let view: EditorView | undefined

interface Rig {
  handle: HTMLElement
  dispatched: () => number
  widthNow: () => string | null
}

/**
 * A real `EditorView`, because the node view is what installs the handle and
 * the drag listeners, and reproducing that by hand would test the reproduction.
 */
function rig(): Rig {
  const place = document.createElement('div')
  document.body.append(place)
  let count = 0
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml('<p><img src="/a.png" alt="x" width="100" height="50"></p>', {
        schema: coreSchema(),
      }),
      plugins: [imageResizePlugin()],
    }),
    dispatchTransaction(tr: Transaction) {
      if (tr.docChanged) count += 1
      view?.updateState(view.state.apply(tr))
    },
  })

  const handle = view.dom.querySelector('.ol-img-resize > .ol-img-handle')
  if (!(handle instanceof HTMLElement)) {
    throw new Error(`no resize handle: ${view.dom.innerHTML}`)
  }

  return {
    handle,
    dispatched: () => count,
    widthNow: () => {
      let width: string | null = null
      view?.state.doc.descendants((n) => {
        if (n.type.name === 'image') width = (n.attrs['width'] as string | null) ?? null
        return true
      })
      return width
    },
  }
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

/** A PointerEvent jsdom will accept, carrying the one property the code reads. */
function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  })
  return event
}

describe('dragging the resize handle', () => {
  /**
   * MEASURED (jsdom): 40 pointermove events in one drag.
   *   before  40 transactions, 40 undo entries   after  0 until pointerup
   */
  it('dispatches nothing at all while the pointer is moving', () => {
    const r = rig()
    r.handle.dispatchEvent(pointer('pointerdown', 0))
    for (let i = 1; i <= 40; i += 1) {
      window.dispatchEvent(pointer('pointermove', i * 3))
    }
    expect(r.dispatched()).toBe(0)
  })

  /**
   * MEASURED (jsdom): the same drag, released.
   *   before  40 transactions   after  1
   */
  it('dispatches exactly one transaction when the pointer is released', () => {
    const r = rig()
    r.handle.dispatchEvent(pointer('pointerdown', 0))
    for (let i = 1; i <= 40; i += 1) {
      window.dispatchEvent(pointer('pointermove', i * 3))
    }
    window.dispatchEvent(pointer('pointerup', 120))
    expect(r.dispatched()).toBe(1)
  })

  /** The one transaction has to carry the size the author dragged to. */
  it('commits the width the drag finished on', () => {
    const r = rig()
    r.handle.dispatchEvent(pointer('pointerdown', 0))
    window.dispatchEvent(pointer('pointermove', 250))
    window.dispatchEvent(pointer('pointerup', 250))
    expect(r.widthNow()).toBe('250')
  })

  /** A click on the handle that never moves must not touch the document. */
  it('dispatches nothing when the pointer never moved', () => {
    const r = rig()
    r.handle.dispatchEvent(pointer('pointerdown', 40))
    window.dispatchEvent(pointer('pointerup', 40))
    expect(r.dispatched()).toBe(0)
  })
})
