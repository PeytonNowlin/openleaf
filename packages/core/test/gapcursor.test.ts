/**
 * A document that is only a block atom (or that starts/ends with one) has no
 * textblock for the caret. Without a gap cursor, a NodeSelection on that atom
 * plus typing replaces it — #164.
 */

import { history } from 'prosemirror-history'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  coreSchema,
  gapCursorPlugin,
  parseHtml,
  serializeHtml,
} from '../src/index.js'

let view: EditorView | undefined

function mount(html: string): EditorView {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [history(), gapCursorPlugin()],
    }),
  })
  return view
}

function type(v: EditorView, text: string): void {
  const { from, to } = v.state.selection
  const handled = v.someProp('handleTextInput', (fn) => fn(v, from, to, text, () => v.state.tr.insertText(text)))
  if (!handled) v.dispatch(v.state.tr.insertText(text))
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

describe('gapCursorPlugin', () => {
  it('ArrowLeft from a lone page-break keeps the atom when the author types', () => {
    const v = mount('<hr class="ol-pagebreak">')
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 0)))
    expect(v.state.selection).toBeInstanceOf(NodeSelection)

    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(v.state.selection).not.toBeInstanceOf(NodeSelection)

    type(v, 'before')
    const html = serializeHtml(v.state.doc)
    expect(html).toMatch(/ol-pagebreak/)
    expect(html).toContain('before')
  })

  it('ArrowRight from a lone page-break keeps the atom when the author types', () => {
    const v = mount('<hr class="ol-pagebreak">')
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 0)))
    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(v.state.selection).not.toBeInstanceOf(NodeSelection)
    type(v, 'after')
    const html = serializeHtml(v.state.doc)
    expect(html).toMatch(/ol-pagebreak/)
    expect(html).toContain('after')
  })
})
