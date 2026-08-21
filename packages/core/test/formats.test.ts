import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { CARRIED_ATTR } from '../src/extensions.js'
import {
  coreSchema,
  parseFormatList,
  parseHtml,
  serializeHtml,
  setBlockClass,
} from '../src/index.js'

describe('parseFormatList', () => {
  it('reads token=label pairs', () => {
    expect(parseFormatList('p.lead=Lead paragraph|.note=Note')).toEqual([
      { token: 'p.lead', label: 'Lead paragraph' },
      { token: '.note', label: 'Note' },
    ])
  })
})

describe('setBlockClass', () => {
  it('writes a class that round-trips on the paragraph', () => {
    const schema = coreSchema()
    let state = EditorState.create({ doc: parseHtml('<p>Hello</p>', { schema }) })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    setBlockClass('lead')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p class="lead">Hello</p>')
    const para = state.doc.firstChild
    expect(para?.attrs[CARRIED_ATTR]).toMatchObject({ class: 'lead' })
  })
})
