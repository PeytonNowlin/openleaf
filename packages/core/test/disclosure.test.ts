/**
 * Opening and closing a `<details>` while editing.
 *
 * The browser toggles a disclosure when its `<summary>` is clicked, and inside a
 * contenteditable it does not: the click is spent placing a caret. A `<details>`
 * parsed without `open` therefore rendered collapsed with no gesture that could
 * expand it, so the body of a collapsible section already in a document was
 * unreachable -- not merely uneditable, unreadable.
 */

import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { coreSchema, disclosurePlugin, parseHtml, serializeHtml } from '../src/index.js'

let view: EditorView | undefined

function mount(html: string): EditorView {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [disclosurePlugin()],
    }),
  })
  return view
}

/** Click a DOM node the way a person does, so the plugin's handler runs. */
function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

describe('clicking a summary', () => {
  it('opens a collapsed details', () => {
    const v = mount('<details><summary>More</summary><p>body</p></details>')
    const summary = v.dom.querySelector('summary')
    expect(summary).not.toBeNull()
    click(summary as Element)
    expect(v.state.doc.firstChild?.attrs['open']).toBe(true)
    expect(serializeHtml(v.state.doc)).toContain('<details open="">')
  })

  it('closes an open one', () => {
    const v = mount('<details open><summary>More</summary><p>body</p></details>')
    click(v.dom.querySelector('summary') as Element)
    expect(v.state.doc.firstChild?.attrs['open']).toBe(false)
    expect(serializeHtml(v.state.doc)).not.toContain('open')
  })

  it('alternates rather than sticking', () => {
    const v = mount('<details><summary>More</summary><p>body</p></details>')
    const seen: unknown[] = []
    for (let i = 0; i < 4; i += 1) {
      click(v.dom.querySelector('summary') as Element)
      seen.push(v.state.doc.firstChild?.attrs['open'])
    }
    expect(seen).toEqual([true, false, true, false])
  })

  // The click lands on the label's text far more often than on the marker, and
  // an earlier version keyed off ProseMirror's `direct` flag -- which is false
  // for the summary when the text node is what was hit. It toggled once and then
  // appeared stuck.
  it('toggles when the click lands on the label text, not just the marker', () => {
    const v = mount('<details><summary>More</summary><p>body</p></details>')
    const text = v.dom.querySelector('summary')?.firstChild
    expect(text?.nodeType).toBe(3)
    text?.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(v.state.doc.firstChild?.attrs['open']).toBe(true)
  })

  it('cancels the browser default, so the two toggles cannot fight', () => {
    const v = mount('<details><summary>More</summary><p>body</p></details>')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    v.dom.querySelector('summary')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a click elsewhere in the document alone', () => {
    const v = mount('<details><summary>More</summary><p>body</p></details><p>outside</p>')
    const before = v.state.doc.firstChild?.attrs['open']
    click(v.dom.querySelectorAll('p')[1] as Element)
    expect(v.state.doc.firstChild?.attrs['open']).toBe(before)
  })

  it('toggles the nearest details when they are nested', () => {
    const v = mount(
      '<details><summary>Outer</summary><details><summary>Inner</summary><p>x</p></details></details>',
    )
    const inner = v.dom.querySelectorAll('summary')[1]
    click(inner as Element)
    const outer = v.state.doc.firstChild
    expect(outer?.attrs['open']).toBe(false)
    expect(outer?.child(1).attrs['open']).toBe(true)
  })
})
