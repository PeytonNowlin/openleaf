/**
 * Selections that straddle an isolating node must not throw on replace.
 *
 * #130: a TextSelection from a blockquote into a following <details> made
 * `replaceSelection` throw `TransformError: Cannot join details onto blockquote`.
 * Recovery re-derived the document from the DOM with no history step.
 */

import { history, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clampIsolatingTextSelection,
  coreSchema,
  isolatingSelectionPlugin,
  parseHtml,
  serializeHtml,
  textSelectionCrossesIsolating,
} from '../src/index.js'
import { clampIsolatingReplaceRange } from '../src/isolating-selection.js'

const QUOTE_THEN_DETAILS =
  '<blockquote><p>quote</p></blockquote><details open><summary>s</summary><p>body</p></details>'

function stateFor(html: string, withHistory = false): EditorState {
  return EditorState.create({
    doc: parseHtml(html, { schema: coreSchema() }),
    plugins: withHistory ? [history(), isolatingSelectionPlugin()] : [isolatingSelectionPlugin()],
  })
}

function textPositions(state: EditorState): number[] {
  const positions: number[] = []
  for (let pos = 0; pos <= state.doc.content.size; pos += 1) {
    if (state.doc.resolve(pos).parent.inlineContent) positions.push(pos)
  }
  return positions
}

describe('isolatingSelectionPlugin', () => {
  it('clamps a TextSelection that starts in a blockquote and ends in details', () => {
    const state = stateFor(QUOTE_THEN_DETAILS)
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 12)))
    expect(textSelectionCrossesIsolating(next.selection)).toBe(false)
    expect(next.selection.from).toBeGreaterThanOrEqual(2)
    expect(next.selection.to).toBeLessThan(9)
  })

  it('leaves a selection that only lives inside the quote alone', () => {
    const state = stateFor(QUOTE_THEN_DETAILS)
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 7)))
    expect(next.selection.from).toBe(2)
    expect(next.selection.to).toBe(7)
  })

  it('leaves a selection that only lives inside the details alone', () => {
    const state = stateFor(QUOTE_THEN_DETAILS)
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 11, 12)))
    expect(next.selection.from).toBe(11)
    expect(next.selection.to).toBe(12)
  })

  it('does not clamp a range that contains the whole details from the outside', () => {
    const html =
      '<blockquote><p>quote</p></blockquote><details open><summary>s</summary><p>body</p></details><p>after</p>'
    const state = stateFor(html)
    let afterStart = -1
    state.doc.descendants((node, pos) => {
      if (afterStart < 0 && node.isText && node.text === 'after') afterStart = pos
    })
    const from = 2
    const to = afterStart + 5
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
    expect(next.selection.from).toBe(from)
    expect(next.selection.to).toBe(to)
  })

  it('typing across the #130 range does not throw, does not corrupt, and is undoable', () => {
    let state = stateFor(QUOTE_THEN_DETAILS, true)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 12)))
    expect(() => {
      state = state.apply(state.tr.insertText('X'))
    }).not.toThrow()
    const after = serializeHtml(state.doc)
    expect(after).toContain('X')
    expect(after).toContain('<summary>s</summary>')
    expect(after).toContain('body</details>')
    expect(after).not.toMatch(/<\/details><p>body<\/p>/)

    let undone: EditorState | null = null
    expect(undo(state, (tr) => { undone = state.apply(tr) })).toBe(true)
    expect(serializeHtml(undone!.doc)).toBe(serializeHtml(parseHtml(QUOTE_THEN_DETAILS)))
  })

  it('insertText never throws for any text-to-text range in the #130 document', () => {
    const positions = textPositions(stateFor(QUOTE_THEN_DETAILS))
    const throws: string[] = []
    for (const from of positions) {
      for (const to of positions) {
        if (to <= from) continue
        let state = stateFor(QUOTE_THEN_DETAILS)
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
        try {
          state = state.apply(state.tr.insertText('X'))
        } catch (error) {
          throws.push(`from=${from} to=${to} :: ${(error as Error).message}`)
        }
        const html = serializeHtml(state.doc)
        expect(html, `from=${from} to=${to}`).toContain('<details')
        expect(html, `from=${from} to=${to}`).not.toMatch(/<\/details><p>body<\/p>/)
      }
    }
    expect(throws).toEqual([])
  })

  it('without the plugin, the reported range still throws', () => {
    const state = EditorState.create({
      doc: parseHtml(QUOTE_THEN_DETAILS, { schema: coreSchema() }),
    })
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 12)))
    expect(textSelectionCrossesIsolating(selected.selection)).toBe(true)
    expect(() => selected.tr.insertText('X')).toThrow(/Cannot join details onto blockquote/)
  })
})

describe('clampIsolatingTextSelection', () => {
  it('narrows to the anchor side when the head sits inside details', () => {
    const doc = parseHtml(QUOTE_THEN_DETAILS, { schema: coreSchema() })
    const crossing = TextSelection.create(doc, 3, 12)
    const clamped = clampIsolatingTextSelection(crossing)
    expect(clamped.anchor).toBe(3)
    expect(textSelectionCrossesIsolating(clamped)).toBe(false)
    expect(clamped.head).toBeLessThan(crossing.head)
  })
})

describe('clampIsolatingReplaceRange', () => {
  it('returns null when the range does not cross an isolating boundary', () => {
    const doc = parseHtml(QUOTE_THEN_DETAILS, { schema: coreSchema() })
    expect(clampIsolatingReplaceRange(doc, 2, 7)).toBeNull()
  })

  it('clamps a DOM-derived crossing range even when the model selection is collapsed', () => {
    // #163: at keystroke time `state.selection` is often still the caret, while
    // the DOM range already straddles details. The replace range must come from
    // those positions, not from the stale selection.
    const state = stateFor(QUOTE_THEN_DETAILS)
    expect(state.selection.empty).toBe(true)
    const range = clampIsolatingReplaceRange(state.doc, 3, 12)
    expect(range).not.toBeNull()
    expect(range!.from).toBeGreaterThanOrEqual(2)
    expect(range!.to).toBeLessThan(9)

    let next = state
    expect(() => {
      next = state.apply(state.tr.insertText('X', range!.from, range!.to))
    }).not.toThrow()
    const after = serializeHtml(next.doc)
    expect(after).toContain('X')
    expect(after).toContain('<summary>s</summary>')
    expect(after).toContain('body</details>')
    expect(after).not.toMatch(/<\/details><p>body<\/p>/)
  })
})

describe('isolatingSelectionPlugin beforeinput', () => {
  let view: EditorView | undefined

  function mount(html: string): EditorView {
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, {
      state: EditorState.create({
        doc: parseHtml(html, { schema: coreSchema() }),
        plugins: [history(), isolatingSelectionPlugin()],
      }),
    })
    return view
  }

  afterEach(() => {
    view?.destroy()
    view = undefined
    document.body.innerHTML = ''
  })

  it('types into the anchor side when the DOM range crosses details and the model caret has not moved', () => {
    const v = mount(QUOTE_THEN_DETAILS)
    expect(v.state.selection.empty).toBe(true)

    const quoteText = v.dom.querySelector('blockquote p')?.firstChild
    const bodyText = v.dom.querySelector('details p')?.firstChild
    expect(quoteText?.nodeType).toBe(3)
    expect(bodyText?.nodeType).toBe(3)

    const range = document.createRange()
    range.setStart(quoteText as Text, 1)
    range.setEnd(bodyText as Text, 2)
    const selection = v.dom.ownerDocument.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X',
    })
    v.dom.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    const after = serializeHtml(v.state.doc)
    expect(after).toContain('X')
    expect(after).toContain('<summary>s</summary>')
    expect(after).toContain('body</details>')
    expect(after).not.toMatch(/<\/details><p>body<\/p>/)

    let undone: EditorState | null = null
    expect(undo(v.state, (tr) => { undone = v.state.apply(tr) })).toBe(true)
    expect(serializeHtml(undone!.doc)).toBe(serializeHtml(parseHtml(QUOTE_THEN_DETAILS)))
  })

  it('does not intercept a beforeinput whose DOM range stays on one side', () => {
    const v = mount(QUOTE_THEN_DETAILS)
    const quoteText = v.dom.querySelector('blockquote p')?.firstChild
    expect(quoteText?.nodeType).toBe(3)
    const range = document.createRange()
    range.setStart(quoteText as Text, 0)
    range.setEnd(quoteText as Text, 2)
    const selection = v.dom.ownerDocument.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X',
    })
    v.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(serializeHtml(v.state.doc)).not.toContain('X')
  })

  it('does not intercept uncancelable composition input over a crossing DOM range', () => {
    // insertCompositionText is not cancelable. preventDefault is a no-op, and
    // inserting event.data (the whole composition, every update) would commit
    // each IME candidate as real document text on top of the UA mutation.
    const v = mount(QUOTE_THEN_DETAILS)
    const quoteText = v.dom.querySelector('blockquote p')?.firstChild
    const bodyText = v.dom.querySelector('details p')?.firstChild
    const range = document.createRange()
    range.setStart(quoteText as Text, 1)
    range.setEnd(bodyText as Text, 2)
    const selection = v.dom.ownerDocument.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const before = serializeHtml(v.state.doc)
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertCompositionText',
      data: 'に',
    })
    v.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(serializeHtml(v.state.doc)).toBe(before)
  })
})
