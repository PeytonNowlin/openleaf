import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { findTextTool } from '../src/find-text.js'
import { agentHandles, resolveHandle } from '../src/handles.js'
import { agentRegistry } from '../src/registry.js'

/**
 * What a handle is worth after the document has moved under it.
 *
 * jsdom rather than Playwright, and deliberately: nothing here is selection,
 * focus or contenteditable behaviour. It is position mapping, which is document
 * model arithmetic and the same arithmetic in every engine -- and it is asserted
 * by reading the text a handle still names, which is the only question that
 * matters. `webmcp.spec.ts` drives the same tool through the real bundle in
 * three real browsers; what it cannot yet do is resolve a handle, because the
 * tools that consume one land with the write path.
 *
 * The dangerous case has its own test, and it is the reason this module exists:
 * a handle whose text was deleted must refuse, not slide onto the neighbouring
 * text and let a later write land there.
 */

const views: EditorView[] = []

/** An editor in the shape the register expects: a view inside a host element. */
function editor(id: string, html: string): EditorView {
  const host = document.createElement('openleaf-editor')
  host.id = id
  document.body.appendChild(host)
  const mount = document.createElement('div')
  host.appendChild(mount)

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [agentRegistry(), agentHandles()],
    }),
  })
  views.push(view)
  return view
}

interface FindResult {
  ok: boolean
  id?: string
  error?: string
  message?: string
  matches?: { handle: string; context: string }[]
  truncated?: boolean
}

const find = (id: string, text: string): FindResult =>
  JSON.parse(findTextTool.execute({ id, text })) as FindResult

function handles(id: string, text: string): string[] {
  const result = find(id, text)
  expect(result.ok).toBe(true)
  return (result.matches ?? []).map((match) => match.handle)
}

/** The text a handle names now, which is the whole question. */
function textAt(handle: string): string {
  const resolved = resolveHandle(handle)
  if (!resolved.ok) throw new Error(`handle did not resolve: ${resolved.error}`)
  return resolved.editor.view.state.doc.textBetween(resolved.from, resolved.to)
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('searching', () => {
  it('hands back a handle for every occurrence', () => {
    editor('post', '<p>alpha beta gamma beta</p>')
    const found = handles('post', 'beta')
    expect(found).toHaveLength(2)
    expect(new Set(found).size).toBe(2)
    expect(found.map(textAt)).toEqual(['beta', 'beta'])
  })

  it('answers text that does not occur with no matches rather than a failure', () => {
    editor('post', '<p>alpha beta</p>')
    // An agent that is told "error" retries; an agent that is told "none" moves
    // on. Not finding something is an answer.
    expect(find('post', 'omega')).toEqual({ ok: true, id: 'post', matches: [], truncated: false })
  })

  it('reads through a mark boundary but not through a paragraph one', () => {
    editor('post', '<p>be<strong>ta</strong> now</p><p>alpha</p>')
    // "beta" is two text nodes in the model and one word on the page.
    expect(handles('post', 'beta').map(textAt)).toEqual(['beta'])
    // Joining the blocks would match a string the author cannot see as one.
    expect(find('post', 'nowalpha').matches).toEqual([])
  })

  it('gives each match the text around it, so two of the same can be told apart', () => {
    editor('post', '<p>the first beta here</p><p>and a second beta there</p>')
    const contexts = (find('post', 'beta').matches ?? []).map((match) => match.context)
    expect(contexts).toEqual(['the first beta here', 'and a second beta there'])
  })

  it('caps what it returns and says so', () => {
    const many = Array.from({ length: 60 }, () => '<p>x</p>').join('')
    editor('post', many)
    const result = find('post', 'x')
    // A silently short list is what makes an agent "replace every occurrence"
    // and leave half of them behind.
    expect(result.matches).toHaveLength(50)
    expect(result.truncated).toBe(true)
  })

  it('leaves the document exactly as it found it', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const before = view.state.doc
    handles('post', 'beta')
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('refuses a call it cannot act on instead of guessing', () => {
    editor('post', '<p>alpha</p>')
    expect(find('nowhere', 'alpha')).toMatchObject({ ok: false, error: 'unknown-editor' })
    expect(find('post', '')).toMatchObject({ ok: false, error: 'invalid-argument' })
  })
})

describe('a handle', () => {
  it('still names the same text after an edit somewhere else', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const [handle] = handles('post', 'beta')
    expect(handle).toBeDefined()
    if (!handle) return

    // Text inserted before the match: every position after it moves.
    view.dispatch(view.state.tr.insertText('one two three ', 1))
    expect(textAt(handle)).toBe('beta')

    // And after it, which must move nothing.
    view.dispatch(view.state.tr.insertText(' four', view.state.doc.content.size - 1))
    expect(textAt(handle)).toBe('beta')
  })

  it('does not swallow text typed against either of its edges', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    const before = resolveHandle(handle)
    if (!before.ok) throw new Error('handle did not resolve')
    view.dispatch(view.state.tr.insertText('X', before.to))
    view.dispatch(view.state.tr.insertText('Y', before.from))

    // A handle that had grown to "YbetaX" would let a later write rewrite text
    // the agent never read.
    expect(textAt(handle)).toBe('beta')
  })

  it('refuses once its text has been deleted, rather than sliding onto its neighbour', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    const found = resolveHandle(handle)
    if (!found.ok) throw new Error('handle did not resolve')
    view.dispatch(view.state.tr.delete(found.from, found.to))

    const after = resolveHandle(handle)
    expect(after.ok).toBe(false)
    // The failure mode this whole module exists to prevent: `map()` alone would
    // have answered with the position between "alpha " and " gamma", and a
    // write through it would land there.
    expect(after).toMatchObject({ error: 'stale-handle' })
    if (!after.ok) expect(after.message).toContain('deleted')
  })

  it('refuses once its text has been replaced', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    const found = resolveHandle(handle)
    if (!found.ok) throw new Error('handle did not resolve')
    view.dispatch(view.state.tr.insertText('delta', found.from, found.to))
    expect(resolveHandle(handle).ok).toBe(false)
  })

  it('stays refused, even if later editing puts the text back', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    const found = resolveHandle(handle)
    if (!found.ok) throw new Error('handle did not resolve')
    view.dispatch(view.state.tr.delete(found.from, found.to))
    view.dispatch(view.state.tr.insertText('beta', found.from))

    // The characters match; the thing the agent read does not exist any more.
    // Resolving here would be a coincidence dressed up as a guarantee.
    expect(resolveHandle(handle).ok).toBe(false)
  })

  it('survives another plugin registering', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    // What `registerEditorPlugin` does to an editor that already exists.
    // ProseMirror destroys and recreates every plugin view on the way through,
    // so a table held in a view's closure would go with it.
    view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, new Plugin({})] }))

    expect(textAt(handle)).toBe('beta')
  })

  it('stops resolving when its editor leaves the page', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    view.destroy()
    // An agent must not be able to act on an editor that is no longer there,
    // and it has no way to know it went.
    expect(resolveHandle(handle)).toMatchObject({ ok: false, error: 'stale-handle' })
  })

  it('is refused, not thrown at, when it is not a handle at all', () => {
    editor('post', '<p>alpha</p>')
    // A handler that throws reaches the agent as a rejected call with no shape
    // to it, which is the one thing every tool in this package must not do.
    expect(resolveHandle('not-a-handle')).toMatchObject({ ok: false, error: 'stale-handle' })
  })

  it('belongs to its own editor and to no other', () => {
    editor('post', '<p>alpha beta</p>')
    const second = editor('notes', '<p>alpha beta</p>')
    const [handle] = handles('post', 'beta')
    if (!handle) throw new Error('no handle')

    const resolved = resolveHandle(handle)
    if (!resolved.ok) throw new Error('handle did not resolve')
    expect(resolved.editor.id).toBe('post')
    expect(resolved.editor.view).not.toBe(second)
  })

  it('says nothing about where it points', () => {
    editor('post', '<p>alpha beta</p>')
    const first = handles('post', 'beta')[0]
    const again = handles('post', 'beta')[0]
    if (!first || !again) throw new Error('no handle')

    // Opaque is a requirement, not a preference: anything an agent can read out
    // of a handle is something it will eventually compute with.
    expect(first).not.toContain('post')
    expect(first).not.toContain('beta')
    expect(first).not.toBe(again)
  })
})
