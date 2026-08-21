/**
 * Task 40 item 4: image resize dispatches a document transaction per
 * `pointermove`. jsdom, not a browser -- and jsdom has no layout, so the cost
 * measured here is the ProseMirror transaction bill only, which is the part
 * the fix removes.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { describe, it } from 'vitest'
import { imageResizePlugin } from '../src/resize.js'
import { time } from '../../../bench/_util.js'

function pointer(type: string, clientX: number): Event {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
}

/** A drag of `moves` pointermove events, start to finish. */
function drag(view: EditorView, handle: Element, moves: number): void {
  // `bubbles: true`, so one dispatch on the handle reaches a window listener and
  // a handle listener alike -- the fix moves them and the bench must not care.
  handle.dispatchEvent(pointer('pointerdown', 100))
  for (let i = 1; i <= moves; i += 1) handle.dispatchEvent(pointer('pointermove', 100 + i))
  handle.dispatchEvent(pointer('pointerup', 100 + moves))
  void view
}

describe('40.4 - image resize per pointermove', () => {
  it('measures', () => {
    for (const paragraphs of [50, 2000]) {
      const filler = Array.from({ length: paragraphs }, (_, i) => `<p>paragraph ${i}</p>`).join('')
      const place = document.createElement('div')
      document.body.append(place)
      let transactions = 0
      const view = new EditorView(place, {
        state: EditorState.create({
          doc: parseHtml(`<p><img src="/a.png" alt="x" width="240"></p>${filler}`, {
            schema: coreSchema(),
          }),
          plugins: [imageResizePlugin()],
        }),
        dispatchTransaction(tr: Transaction) {
          transactions += 1
          view.updateState(view.state.apply(tr))
        },
      })
      const handle = view.dom.querySelector('.ol-img-handle')
      if (!handle) throw new Error(`no handle: ${view.dom.innerHTML}`)

      transactions = 0
      time(
        `40.4 drag 120 pointermove  ${String(paragraphs).padStart(4)} paras`,
        () => {
          drag(view, handle, 120)
        },
        7,
        2,
      )
      console.log(`     transactions dispatched across the timed drags: ${transactions}`)
      view.destroy()
      place.remove()
    }
  })
})
