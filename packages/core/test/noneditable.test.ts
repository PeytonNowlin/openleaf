/**
 * `contenteditable="false"` regions, and the transaction filter that locks them.
 *
 * The filter is the interesting part: it runs on every document change in the
 * editor, so a mistake in it does not look like a permissions bug. It looks like
 * the editor ignoring a command.
 */

import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { coreSchema, isNonEditableNode, nonEditablePlugin, parseHtml, serializeHtml } from '../src/index.js'

/*
 * A claimed node carrying the attribute as residue. A preserved `<div>` is an
 * `unknown_block` holding raw markup, so the attribute is inside that markup
 * rather than in the node's carried attributes -- the whole atom is already
 * uneditable, which is why the plugin has nothing to do there.
 */
const LOCKED = '<p>before</p><p contenteditable="false">locked</p><p>after</p>'

function stateFor(html: string): EditorState {
  const schema = coreSchema()
  return EditorState.create({ doc: parseHtml(html, { schema }), plugins: [nonEditablePlugin()] })
}

/** Apply a transaction the way the view does, through the plugin's filter. */
function applied(state: EditorState, build: (s: EditorState) => EditorState): EditorState {
  return build(state)
}

describe('locked regions', () => {
  it('recognises a carried contenteditable="false"', () => {
    const doc = parseHtml(LOCKED, { schema: coreSchema() })
    const locked: string[] = []
    doc.descendants((node) => {
      if (isNonEditableNode(node)) locked.push(node.textContent)
      return true
    })
    expect(locked).toEqual(['locked'])
  })

  it('round-trips the attribute', () => {
    expect(serializeHtml(parseHtml(LOCKED, { schema: coreSchema() }))).toContain(
      'contenteditable="false"',
    )
  })
})

describe('the transaction filter', () => {
  /*
   * The bug this pins: each step's map reports positions in the document that
   * step applied to, not in the state's document. Reading the state's document
   * with those coordinates walks off the end of it as soon as an earlier step
   * has grown the document -- `nodesBetween` throws, the throw escapes the
   * filter, and ProseMirror drops the whole transaction. What an author saw was
   * a toolbar button doing nothing.
   */
  it('accepts a multi-step transaction whose later steps run past the old end', () => {
    let state = stateFor('<p>one</p>')
    const tr = state.tr
    // Two insertions, so the second step's map addresses a document longer than
    // the one the filter is handed.
    tr.insert(tr.doc.content.size, state.schema.nodes['paragraph']!.create(null, state.schema.text('two')))
    tr.insert(tr.doc.content.size, state.schema.nodes['paragraph']!.create(null, state.schema.text('three')))
    expect(() => {
      state = state.apply(tr)
    }).not.toThrow()
    expect(serializeHtml(state.doc)).toBe('<p>one</p><p>two</p><p>three</p>')
  })

  it('still refuses an edit inside a locked region', () => {
    const state = stateFor(LOCKED)
    let inside = -1
    state.doc.descendants((node, pos) => {
      // Strictly inside, so this is an edit to the contents rather than a
      // deletion of the node itself -- which stays allowed.
      if (isNonEditableNode(node) && inside < 0) inside = pos + 2
      return true
    })
    expect(inside).toBeGreaterThan(0)
    const tr = state.tr.insertText('x', inside)
    expect(serializeHtml(state.apply(tr).doc)).toBe(serializeHtml(state.doc))
  })

  it('allows an edit outside a locked region', () => {
    const state = stateFor(LOCKED)
    // End of the first paragraph: "before" occupies 1..7.
    const next = state.apply(state.tr.insertText('!', 7))
    expect(serializeHtml(next.doc)).toContain('before!')
  })

  it('leaves a transaction that changes nothing alone', () => {
    const state = stateFor(LOCKED)
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    expect(serializeHtml(next.doc)).toBe(serializeHtml(state.doc))
  })
})
