import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { countWords, documentStats } from '../src/count.js'
import {
  findMatches,
  findNext,
  replaceAll,
  replaceCurrent,
  searchKey,
  searchPlugin,
  setSearch,
} from '../src/search.js'

function stateFrom(html: string) {
  return EditorState.create({
    doc: parseHtml(html, { schema: coreSchema() }),
    plugins: [searchPlugin()],
  })
}

describe('countWords', () => {
  it('counts zero for empty or whitespace', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n')).toBe(0)
  })

  it('counts latin words', () => {
    expect(countWords('hello there friend')).toBe(3)
  })
})

describe('documentStats', () => {
  it('counts words and paragraphs in a document', () => {
    const doc = parseHtml('<h2>Title</h2><p>One two three.</p>', { schema: coreSchema() })
    const stats = documentStats(doc)
    expect(stats.paragraphs).toBe(2)
    expect(stats.words).toBeGreaterThanOrEqual(4)
    expect(stats.characters).toBeGreaterThan(0)
  })
})

describe('findMatches', () => {
  it('finds a query across a mark boundary', () => {
    const doc = parseHtml('<p><strong>hel</strong>lo there</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(serializeHtml(doc).toLowerCase()).toContain('hel')
  })

  it('does not match across paragraphs', () => {
    const doc = parseHtml('<p>hel</p><p>lo</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello')).toEqual([])
  })

  it('honours match case', () => {
    const doc = parseHtml('<p>Hello hello</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'Hello', { caseSensitive: true })).toHaveLength(1)
    expect(findMatches(doc, 'hello', { caseSensitive: false })).toHaveLength(2)
  })
})

describe('find and replace commands', () => {
  it('selects the next match', () => {
    let state = stateFrom('<p>one two one</p>')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    const search = searchKey.getState(state)
    expect(search?.matches).toHaveLength(2)
    expect(state.selection.from).toBe(search?.matches[0]?.from)
  })

  it('replaces the current match and keeps the others', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toContain('uno')
    expect(searchKey.getState(state)?.matches.length).toBe(1)
  })

  it('replaces every match', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>uno two uno</p>')
  })
})
