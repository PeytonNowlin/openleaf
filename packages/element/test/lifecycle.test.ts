/**
 * Custom-element lifecycle: DOM moves, real removals, pre-upgrade properties
 * and the `value` setter's history behaviour.
 *
 * jsdom is honest for this one, and it is where all four of these bugs were
 * first reproduced. Everything under test is DOM plumbing -- connect/disconnect
 * ordering, what is left in the subtree after a teardown, whether an own data
 * property shadows a prototype accessor, and which transactions reach the undo
 * stack. None of it depends on layout, IME or a real contenteditable, and the
 * behaviour that does still lives in packages/element/test/e2e.
 */

import { undo } from 'prosemirror-history'
import { TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

const live: OpenLeafEditor[] = []

/**
 * An editor is a registry subscriber and a document-level listener until it is
 * torn down, so every test disposes of its own. The flush matters: teardown is
 * deliberately deferred by one microtask.
 */
afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await flush()
})

/** Let the deferred teardown decide. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeEditor(html: string, attributes: Record<string, string> = {}): OpenLeafEditor {
  const el = document.createElement('openleaf-editor') as OpenLeafEditor
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  el.innerHTML = html
  live.push(el)
  return el
}

/** Two containers, so a move is a real move between parents. */
function containers(): [HTMLDivElement, HTMLDivElement] {
  const a = document.createElement('div')
  const b = document.createElement('div')
  document.body.append(a, b)
  return [a, b]
}

describe('moving the element in the DOM', () => {
  // Task 12. The browser fires disconnect then connect SYNCHRONOUSLY for a
  // move, so this used to destroy the view and build a second one.
  it('keeps the same view, document, selection and undo history', async () => {
    const [a, b] = containers()
    const el = makeEditor('<p>Original content</p>')
    a.appendChild(el)

    const view = el.view
    expect(view).not.toBeNull()
    expect(el.value).toBe('<p>Original content</p>')

    view!.dispatch(view!.state.tr.insertText('!', view!.state.doc.content.size - 1))
    expect(el.value).toBe('<p>Original content!</p>')

    b.appendChild(el)
    await flush()

    // The SAME EditorView, not a rebuilt one.
    expect(el.view).toBe(view)
    expect(el.value).toBe('<p>Original content!</p>')

    // Undo history survived the move.
    undo(view!.state, view!.dispatch)
    expect(el.value).toBe('<p>Original content</p>')
  })

  // Task 11. Even with the deferred teardown, an unbound editor that is really
  // removed and later re-inserted must not read its own chrome back as content.
  it('does not leave chrome behind, and never reads it back as the document', async () => {
    const [a, b] = containers()
    const el = makeEditor('<p>Original content</p>', { menubar: '' })
    a.appendChild(el)

    expect(el.querySelector('.ol-toolbar')).not.toBeNull()
    expect(el.querySelector('.ol-menubar')).not.toBeNull()
    expect(el.querySelector('.ol-content')).not.toBeNull()

    a.removeChild(el)
    await flush()

    // Complete teardown: nothing this element appended is left in its subtree.
    expect(el.querySelector('.ol-toolbar')).toBeNull()
    expect(el.querySelector('.ol-menubar')).toBeNull()
    expect(el.querySelector('.ol-content')).toBeNull()
    expect(el.querySelector('.ol-live')).toBeNull()
    expect(el.innerHTML).toBe('')

    b.appendChild(el)

    expect(el.value).toBe('<p>Original content</p>')
    expect(el.value).not.toContain('ol-toolbar')
    expect(el.value).not.toContain('ol-menubar')
    expect(el.value).not.toContain('Rich text editor')
  })

  it('carries edits made before a real removal into the rebuilt editor', async () => {
    const [a, b] = containers()
    const el = makeEditor('<p>Original content</p>')
    a.appendChild(el)

    const view = el.view!
    view.dispatch(view.state.tr.insertText(' edited', view.state.doc.content.size - 1))

    a.removeChild(el)
    await flush()
    b.appendChild(el)

    expect(el.value).toBe('<p>Original content edited</p>')
  })

  // The bound case already survived, because the textarea outranks the
  // subtree. Pinned so the `#initialHtml` fallback cannot regress it.
  it('rebuilds from the bound textarea rather than the chrome', async () => {
    const form = document.createElement('form')
    const textarea = document.createElement('textarea')
    textarea.id = 'body'
    textarea.name = 'body'
    textarea.value = '<p>From the server</p>'
    const [a, b] = containers()
    form.appendChild(textarea)
    document.body.appendChild(form)

    const el = makeEditor('', { for: 'body' })
    a.appendChild(el)
    expect(el.value).toBe('<p>From the server</p>')

    a.removeChild(el)
    await flush()
    b.appendChild(el)

    expect(el.value).toBe('<p>From the server</p>')
  })

  // The riskiest part of deferring: a disconnect that is followed by a connect
  // and another disconnect inside one task queues two teardowns.
  it('tears down exactly once, however the callbacks interleave', async () => {
    const [a, b] = containers()
    const el = makeEditor('<p>Original content</p>')
    a.appendChild(el)

    a.removeChild(el)
    b.appendChild(el)
    b.removeChild(el)
    await flush()

    expect(el.view).toBeNull()
    expect(el.innerHTML).toBe('')

    // A second teardown must be a no-op rather than a throw.
    el.disconnectedCallback()
    await flush()
    expect(el.view).toBeNull()

    // And it is still rebuildable afterwards.
    a.appendChild(el)
    expect(el.view).not.toBeNull()
    expect(el.value).toBe('<p>Original content</p>')
  })

  it('leaves other instances alone when one moves', async () => {
    const [a, b] = containers()
    const first = makeEditor('<p>First</p>')
    const second = makeEditor('<p>Second</p>')
    a.append(first, second)

    const secondView = second.view
    b.appendChild(first)
    await flush()

    expect(second.view).toBe(secondView)
    expect(second.value).toBe('<p>Second</p>')
    expect(first.value).toBe('<p>First</p>')
    expect(second.querySelector('.ol-content')).not.toBeNull()
  })

  it('follows the element into a different form', async () => {
    const outside = document.createElement('form')
    const inside = document.createElement('form')
    const textarea = document.createElement('textarea')
    textarea.name = 'body'
    document.body.append(outside, inside)
    outside.appendChild(textarea)

    const el = makeEditor('<p>Hello</p>')
    outside.appendChild(el)
    inside.appendChild(el)
    await flush()

    // Submitting the form the element now lives in still syncs it.
    inside.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(el.value).toBe('<p>Hello</p>')
  })
})

describe('pre-upgrade property assignment', () => {
  // Task 13. `defer`, code splitting and SSR hydration all assign `.value`
  // before the definition script runs.
  it('re-applies a value assigned before the element upgraded', () => {
    const tag = 'openleaf-editor-late'
    const el = document.createElement(tag) as OpenLeafEditor
    el.value = '<p>set early</p>'
    // Assignment before upgrade lands as an own data property.
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(true)

    document.body.appendChild(el)
    class LateEditor extends OpenLeafEditor {}
    customElements.define(tag, LateEditor)
    live.push(el)

    // Upgrading deleted the shadow, so the accessor is reachable again.
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(false)
    expect(el.view).not.toBeNull()
    expect(el.view!.state.doc.textContent).toBe('set early')
    expect(el.value).toBe('<p>set early</p>')

    // And the accessor -- not a data property -- handles later writes.
    el.value = '<p>set later</p>'
    expect(el.view!.state.doc.textContent).toBe('set later')
  })

  // `imageUploader` is read off the host as a plain expando today, so there is
  // no accessor to shadow and this passes either way. It is here so that the
  // day it becomes an accessor -- the natural way to add validation to it --
  // the upgrade step is already covered rather than quietly missing.
  it('re-applies an imageUploader assigned before the element upgraded', () => {
    const tag = 'openleaf-editor-late-uploader'
    const el = document.createElement(tag) as OpenLeafEditor & {
      imageUploader?: unknown
    }
    const uploader = async (): Promise<{ src: string }> => ({ src: '/x.png' })
    el.imageUploader = uploader

    document.body.appendChild(el)
    class LateUploaderEditor extends OpenLeafEditor {}
    customElements.define(tag, LateUploaderEditor)
    live.push(el)

    expect(el.imageUploader).toBe(uploader)
  })
})

describe('the value setter', () => {
  // Task 14, first half.
  it('is idempotent: assigning the current value changes nothing', () => {
    const el = makeEditor('<p>Hello</p>')
    document.body.appendChild(el)

    let changes = 0
    el.addEventListener('openleaf:change', () => {
      changes += 1
    })

    el.value = el.value
    expect(changes).toBe(0)
    expect(el.value).toBe('<p>Hello</p>')

    // A different value is still applied, and does fire.
    el.value = '<p>Goodbye</p>'
    expect(changes).toBe(1)
    expect(el.value).toBe('<p>Goodbye</p>')
  })

  // Task 14, second half. Every wrapper mounts empty and then pushes the
  // server's HTML in, and that must not be the first thing Ctrl-Z eats.
  it('does not let the first undo empty a wrapper-filled document', () => {
    const el = makeEditor('')
    document.body.appendChild(el)

    el.value = '<p>From the server</p>'
    expect(el.value).toBe('<p>From the server</p>')

    const view = el.view!
    undo(view.state, view.dispatch)
    expect(el.value).toBe('<p>From the server</p>')
  })

  it('keeps later assignments undoable', () => {
    const el = makeEditor('')
    document.body.appendChild(el)

    el.value = '<p>From the server</p>'
    el.value = '<p>Replaced</p>'
    expect(el.value).toBe('<p>Replaced</p>')

    const view = el.view!
    undo(view.state, view.dispatch)
    expect(el.value).toBe('<p>From the server</p>')
  })

  it('keeps an author edit undoable after a wrapper fill', () => {
    const el = makeEditor('')
    document.body.appendChild(el)
    el.value = '<p>From the server</p>'

    const view = el.view!
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1))
    expect(el.value).toBe('<p>From the server!</p>')

    undo(view.state, view.dispatch)
    expect(el.value).toBe('<p>From the server</p>')

    // The fill itself is still not undoable, so the document cannot be emptied.
    undo(el.view!.state, el.view!.dispatch)
    expect(el.value).toBe('<p>From the server</p>')
  })

  it('leaves the caret where the author had it', () => {
    const el = makeEditor('<p>hello world</p>')
    document.body.appendChild(el)

    const view = el.view!
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
    expect(view.state.selection.from).toBe(7)

    el.value = '<p>hello there</p>'
    expect(el.view!.state.selection.from).toBe(7)
  })

  it('holds an assignment made while there is no view', async () => {
    const [a] = containers()
    const el = makeEditor('<p>Original</p>')
    a.appendChild(el)
    a.removeChild(el)
    await flush()
    expect(el.view).toBeNull()

    el.value = '<p>Set while detached</p>'
    expect(el.value).toBe('<p>Set while detached</p>')

    a.appendChild(el)
    expect(el.value).toBe('<p>Set while detached</p>')
  })
})
