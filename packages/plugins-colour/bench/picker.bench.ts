/**
 * Task 40 item 3: the colour picker's `update` writes an `aria-pressed`
 * attribute per swatch on every transaction, and round-trips the CSSOM to
 * normalise the current colour. jsdom, not a browser.
 */

import {
  activeTextColor,
  clearTextColor,
  coreSchema,
  parseHtml,
  setTextColor,
} from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, it } from 'vitest'
import { DEFAULT_PALETTE } from '../src/palette.js'
import { buildColorPicker } from '../src/picker.js'
import { time } from '../../../bench/_util.js'

function control(html: string) {
  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
  )
  const host = document.createElement('div')
  document.body.appendChild(host)
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus: () => undefined,
  } as unknown as EditorView
  const built = buildColorPicker(
    { view, host },
    {
      label: 'Text colour',
      icon: 'textColour',
      palette: DEFAULT_PALETTE,
      active: activeTextColor,
      apply: setTextColor,
      clear: clearTextColor,
    },
  )
  host.appendChild(built.el)
  return { built, get state() { return state } }
}

describe('40.3 - colour picker update per transaction', () => {
  it('measures', () => {
    for (const [label, html] of [
      ['no colour in force', '<p>hello world</p>'],
      ['colour in force', '<p><span style="color:#cc0000">hello world</span></p>'],
      ['named colour in force', '<p><span style="color:rebeccapurple">hello world</span></p>'],
    ] as const) {
      const { built, state } = control(html)
      time(
        `40.3 picker.update x2000  ${label}`,
        () => {
          for (let i = 0; i < 2000; i += 1) built.update?.(state)
        },
        9,
        2,
      )
    }
  })
})
