/**
 * One author gesture must be one undo event.
 *
 * Autolink's space / Enter / compositionend paths used to dispatch a mark as a
 * *separate* transaction from the keystroke that committed the URL. `AddMarkStep`
 * maps no positions, so `prosemirror-history` treats that mark as non-adjacent
 * and starts a new undo event — Ctrl+Z peeled the link off and left the URL,
 * and a second undo was needed to remove the text (#182).
 *
 * These tests drive the same transaction sequence those gestures produce.
 * jsdom has no IME: the compositionend case is that sequence, not a real
 * keyboard. A human checking a CJK IME should compose a URL, accept, press
 * Space, and need two undos (space, then the linked URL), not three.
 */

import { splitBlock } from 'prosemirror-commands'
import { closeHistory, history, redo, undo, undoDepth } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { autolinkPlugin, coreSchema, parseHtml, serializeHtml } from '../src/index.js'

function atEnd(state: EditorState): EditorState {
  const end = state.doc.content.size - 1
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)))
}

function editor(html: string) {
  const schema = coreSchema()
  const plugin = autolinkPlugin()
  let state = atEnd(
    EditorState.create({
      doc: parseHtml(html, { schema }),
      plugins: [history(), plugin],
    }),
  )
  plugin.spec.view?.({ composing: false, isDestroyed: false } as unknown as EditorView)

  const view = {
    get state() {
      return state
    },
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      state = state.apply(tr)
    },
    composing: false,
    isDestroyed: false,
  } as unknown as EditorView

  return {
    plugin,
    view,
    get state() {
      return state
    },
    html() {
      return serializeHtml(state.doc)
    },
    insert(text: string, pos = state.selection.from) {
      state = state.apply(state.tr.insertText(text, pos))
    },
    closeHistory() {
      state = state.apply(closeHistory(state.tr))
    },
  }
}

function undoOnce(ed: ReturnType<typeof editor>): boolean {
  return undo(ed.state, (tr) => ed.view.dispatch(tr))
}

function redoOnce(ed: ReturnType<typeof editor>): boolean {
  return redo(ed.state, (tr) => ed.view.dispatch(tr))
}

/** Physical Space: PM inserts the character, then autolink's `appendTransaction` adds the mark. */
function typeSpace(ed: ReturnType<typeof editor>): void {
  ed.insert(' ')
}

function typeEnter(ed: ReturnType<typeof editor>): void {
  splitBlock(ed.state, (tr) => ed.view.dispatch(tr))
}

async function fireCompositionEnd(ed: ReturnType<typeof editor>): Promise<void> {
  ed.plugin.props.handleDOMEvents?.compositionend?.call(
    ed.plugin,
    ed.view,
    new CompositionEvent('compositionend'),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('autolink undo grouping (#182)', () => {
  it('a typed space after a URL is one undo, and the URL insert stays its own step', () => {
    const ed = editor('<p>keep</p>')
    ed.insert('https://example.org')
    ed.closeHistory()
    expect(undoDepth(ed.state)).toBe(1)
    const afterUrl = ed.html()

    typeSpace(ed)
    expect(ed.html()).toContain('href="https://example.org"')
    expect(ed.html()).toContain('https://example.org')
    expect(undoDepth(ed.state)).toBe(2)

    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe(afterUrl)
    expect(ed.html()).not.toContain('href=')
    expect(undoDepth(ed.state)).toBe(1)

    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe('<p>keep</p>')
    expect(undoDepth(ed.state)).toBe(0)
  })

  it('an edit that is not adjacent to the autolink stays a separate undo step', () => {
    const ed = editor('<p>keep</p>')
    ed.insert('https://example.org')
    ed.closeHistory()
    typeSpace(ed)
    const linked = ed.html()
    expect(linked).toContain('href="https://example.org"')

    // Insert at the start of the paragraph, far from the URL. Adjacent typing
    // after the space would coalesce under stock `newGroupDelay`; this is a
    // distinct edit that must not be swallowed by the autolink group.
    ed.insert('z', 1)
    expect(undoDepth(ed.state)).toBe(3)
    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe(linked)
    expect(undoDepth(ed.state)).toBe(2)
  })

  it('compositionend autolink joins the composed URL, and the edit before it stays separate', async () => {
    const ed = editor('<p>keep</p>')
    ed.insert('prior')
    ed.closeHistory()
    ed.insert('https://example.org')
    expect(undoDepth(ed.state)).toBe(2)
    expect(ed.html()).not.toContain('href=')

    await fireCompositionEnd(ed)
    expect(ed.html()).toContain('href="https://example.org"')
    expect(undoDepth(ed.state)).toBe(2)

    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe('<p>keepprior</p>')
    expect(ed.html()).not.toContain('href=')
    expect(undoDepth(ed.state)).toBe(1)

    expect(redoOnce(ed)).toBe(true)
    expect(ed.html()).toContain('href="https://example.org"')

    expect(undoOnce(ed)).toBe(true)
    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe('<p>keep</p>')
  })

  it('Enter after a URL is one undo, and the URL insert stays its own step', () => {
    const ed = editor('<p>keep</p>')
    ed.insert('https://example.org')
    ed.closeHistory()
    const afterUrl = ed.html()

    typeEnter(ed)
    expect(ed.html()).toContain('href="https://example.org"')
    expect(ed.html()).toMatch(/<p><\/p>$/)
    expect(undoDepth(ed.state)).toBe(2)

    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe(afterUrl)
    expect(ed.html()).not.toContain('href=')
    expect(undoDepth(ed.state)).toBe(1)

    expect(undoOnce(ed)).toBe(true)
    expect(ed.html()).toBe('<p>keep</p>')
  })
})
