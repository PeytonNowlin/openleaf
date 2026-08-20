/**
 * Baseline measurements for PR 9 tasks 33, 34 and 35.
 *
 * jsdom, not a browser. Absolute numbers are therefore indicative; the
 * before/after ratio on the same rig is the load-bearing part.
 */

import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, it } from 'vitest'
import {
  coreSchema,
  nonEditablePlugin,
  parseHtml,
  serializeHtml,
  visualAidsPlugin,
} from '../src/index.js'
import { plainDoc, styledDoc, tableDoc, wordDoc } from '../../../bench/docs.js'
import { time } from '../../../bench/_util.js'

const schema = coreSchema()

function stateFor(html: string) {
  return EditorState.create({
    doc: parseHtml(html, { schema }),
    plugins: [visualAidsPlugin(), nonEditablePlugin()],
  })
}

describe('33 - serializeHtml per keystroke', () => {
  it('measures', () => {
    for (const [label, html] of [
      ['plain 3,000 paras', plainDoc()],
      ['styled 3,000 paras', styledDoc()],
      ['250 tables', tableDoc()],
    ] as const) {
      const doc = parseHtml(html, { schema })
      time(`33 serializeHtml  ${label}`, () => {
        const out = serializeHtml(doc)
        if (out.length === 0) throw new Error('empty')
      }, 7, 2)
    }
  })
})

describe('34 - visualAids decorations per transaction', () => {
  it('measures', () => {
    for (const [label, html] of [
      ['clean 3,000 paras', plainDoc()],
      ['word 3,000 paras (~36k nbsp)', wordDoc()],
    ] as const) {
      const state = stateFor(html)
      const plugin = state.plugins.find((p) => (p as { spec?: { key?: unknown } }).spec) as never
      // Simulate what ProseMirror does per transaction: apply a one-char
      // insert, then pull `decorations` off the new state.
      const tr = state.tr.insertText('x', 1)
      const next = state.apply(tr)
      time(`34 decorations   ${label}`, () => {
        for (const p of next.plugins) {
          const d = p.props?.decorations
          if (d) d.call(p, next)
        }
      }, 7, 2)
      void plugin
    }
  })
})

describe('35 - nonEditable filterTransaction step scaling', () => {
  it('measures', () => {
    const state = stateFor(plainDoc(500))
    for (const steps of [125, 250, 500, 1000, 2000]) {
      let tr = state.tr
      for (let i = 0; i < steps; i += 1) {
        const pos = 1 + (i % 400) * 3
        if (pos + 1 < tr.doc.content.size) tr = tr.insertText('z', pos)
      }
      time(`35 filterTransaction ${String(steps).padStart(5)} steps`, () => {
        for (const p of state.plugins) {
          const f = p.spec.filterTransaction
          if (f) f.call(p, tr, state)
        }
      }, 5, 1)
    }
  })
})

describe('keystroke composite', () => {
  it('measures', () => {
    for (const [label, html] of [
      ['plain', plainDoc()],
      ['word-imported', wordDoc()],
    ] as const) {
      const state = stateFor(html)
      time(`composite keystroke ${label}`, () => {
        const tr = state.tr.insertText('x', 1)
        for (const p of state.plugins) {
          const f = p.spec.filterTransaction
          if (f && !f.call(p, tr, state)) return
        }
        const next = state.apply(tr)
        for (const p of next.plugins) {
          const d = p.props?.decorations
          if (d) d.call(p, next)
        }
        serializeHtml(next.doc)
      }, 7, 2)
    }
    void TextSelection
  })
})
