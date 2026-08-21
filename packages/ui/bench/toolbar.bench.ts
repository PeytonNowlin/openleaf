/**
 * Baseline measurements for PR 9 task 39: the per-transaction toolbar update.
 *
 * jsdom, not a browser. Absolute milliseconds are therefore indicative; the
 * TRAVERSAL COUNTS are exact and are the load-bearing numbers here, because a
 * document walk costs the same shape of work in every engine.
 *
 * The wall-clock runs cycle through a pool of DISTINCT EditorStates, because a
 * real selection drag produces a new state per pointermove. Timing the same
 * state repeatedly would measure a per-state cache instead of the work.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { describe, it } from 'vitest'
import { registerDefaultItems } from '../src/items.js'
import { DEFAULT_LAYOUT } from '../src/registry.js'
import { Toolbar } from '../src/toolbar.js'
import { plainDoc } from '../../../bench/docs.js'
import { time } from '../../../bench/_util.js'

registerDefaultItems()

const schema = coreSchema()

function selectAllState(html: string): EditorState {
  const doc = parseHtml(html, { schema })
  const state = EditorState.create({ doc })
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

/** Distinct states over the SAME doc instance, as a selection drag produces. */
function dragPool(base: EditorState, n: number): Array<[EditorState, Transaction]> {
  const out: Array<[EditorState, Transaction]> = []
  let s = base
  for (let i = 0; i < n; i += 1) {
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)))
    out.push([s, s.tr.setSelection(s.selection)])
  }
  return out
}

function viewFor(state: EditorState): EditorView {
  let current = state
  return {
    get state() {
      return current
    },
    dispatch(tr: Transaction) {
      current = current.apply(tr)
    },
    focus: () => undefined,
  } as unknown as EditorView
}

function mount(state: EditorState): Toolbar {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const toolbar = new Toolbar(host, document, { layout: DEFAULT_LAYOUT })
  host.appendChild(toolbar.el)
  toolbar.mount(viewFor(state))
  return toolbar
}

/**
 * Count document traversals for one toolbar update.
 *
 * `walks` is how many times something started a `nodesBetween` over the whole
 * doc node; `visits` is how many times a per-node callback ran inside those
 * walks -- the figure that scales with document size.
 */
function instrument(doc: PMNode): { walks: () => number; visits: () => number; reset: () => void } {
  let walks = 0
  let visits = 0
  const original = doc.nodesBetween.bind(doc)
  Object.defineProperty(doc, 'nodesBetween', {
    configurable: true,
    value(
      from: number,
      to: number,
      f: (node: PMNode, pos: number, parent: PMNode | null, index: number) => boolean | void,
      startPos?: number,
    ) {
      walks += 1
      return original(
        from,
        to,
        (node, pos, parent, index) => {
          visits += 1
          return f(node, pos, parent, index)
        },
        startPos,
      )
    },
  })
  return {
    walks: () => walks,
    visits: () => visits,
    reset: () => {
      walks = 0
      visits = 0
    },
  }
}

describe('39 - toolbar update per transaction', () => {
  it('counts document traversals for one Select-All update', () => {
    for (const paragraphs of [100, 3000] as const) {
      const base = selectAllState(plainDoc(paragraphs))
      const toolbar = mount(base)
      const counters = instrument(base.doc)
      const [[state, tr]] = dragPool(base, 1) as [[EditorState, Transaction]]
      counters.reset()
      toolbar.update(state, tr)
      console.log(
        `39 traversals    select-all ${String(paragraphs).padStart(5)} paras   ` +
          `walks=${counters.walks()}  visits=${counters.visits()}`,
      )
      toolbar.destroy()
    }
  })

  it('counts traversals for a transaction that changed neither doc nor selection', () => {
    const base = selectAllState(plainDoc(3000))
    const toolbar = mount(base)
    const counters = instrument(base.doc)
    const inert = base.tr.setMeta('ping', true)
    counters.reset()
    toolbar.update(base, inert)
    console.log(
      '39 traversals    inert tr    3000 paras   ' +
        `walks=${counters.walks()}  visits=${counters.visits()}`,
    )
    toolbar.destroy()
  })

  it('counts traversals when four toolbars share one state', () => {
    const base = selectAllState(plainDoc(3000))
    const bars = [mount(base), mount(base), mount(base), mount(base)]
    const counters = instrument(base.doc)
    const [[state, tr]] = dragPool(base, 1) as [[EditorState, Transaction]]
    counters.reset()
    for (const bar of bars) bar.update(state, tr)
    console.log(
      '39 traversals    4 bars/1 state 3000 paras ' +
        `walks=${counters.walks()}  visits=${counters.visits()}`,
    )
    for (const bar of bars) bar.destroy()
  })

  it('measures wall clock', () => {
    for (const paragraphs of [100, 3000, 15000] as const) {
      const base = selectAllState(plainDoc(paragraphs))
      const toolbar = mount(base)
      const pool = dragPool(base, 24)
      let i = 0
      time(
        `39 toolbar.update select-all ${String(paragraphs).padStart(5)} paras`,
        () => {
          const entry = pool[i++ % pool.length] as [EditorState, Transaction]
          toolbar.update(entry[0], entry[1])
        },
        15,
        3,
      )
      toolbar.destroy()
    }
  })

  it('measures four bars on one state, the pointermove-drag shape', () => {
    const base = selectAllState(plainDoc(3000))
    const bars = [mount(base), mount(base), mount(base), mount(base)]
    const pool = dragPool(base, 24)
    let i = 0
    time(
      '39 four bars     select-all  3000 paras',
      () => {
        const entry = pool[i++ % pool.length] as [EditorState, Transaction]
        for (const bar of bars) bar.update(entry[0], entry[1])
      },
      15,
      3,
    )
    for (const bar of bars) bar.destroy()
  })
})
