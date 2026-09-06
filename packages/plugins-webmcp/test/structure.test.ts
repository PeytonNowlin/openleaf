import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { getStructureTool } from '../src/get-structure.js'
import { agentHandles, resolveHandle } from '../src/handles.js'
import { agentRegistry } from '../src/registry.js'

/**
 * The outline: what an agent is told about a document it has not read.
 *
 * jsdom against real editor views, for the reason `handles.test.ts` gives --
 * this is the document model, not selection or contenteditable behaviour, and
 * it is asserted through the tool's own JSON rather than by reaching into the
 * handle table. What only a browser can answer -- that the outline describes
 * the editor the author is looking at, including what they have just typed --
 * is in `webmcp.spec.ts`.
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

interface Entry {
  handle: string
  type: string
  level?: number
  text: string
}

interface Outline {
  ok: boolean
  id?: string
  outline?: Entry[]
  truncated?: boolean
  error?: string
}

const raw = (id: string): string => getStructureTool.execute({ id })

function outline(id: string): Entry[] {
  const result = JSON.parse(raw(id)) as Outline
  expect(result.ok).toBe(true)
  return result.outline ?? []
}

/** The text a handle names now, which is the question every entry answers for. */
function textAt(handle: string): string {
  const resolved = resolveHandle(handle)
  if (!resolved.ok) throw new Error(`handle did not resolve: ${resolved.error}`)
  return resolved.editor.view.state.doc.textBetween(resolved.from, resolved.to, ' ').trim()
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('outlining a document', () => {
  it('names each block, in document order', () => {
    editor('post', '<h2>Introduction</h2><p>alpha beta</p><h3>Detail</h3><p>gamma</p>')
    expect(outline('post').map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      'heading:Introduction',
      'paragraph:alpha beta',
      'heading:Detail',
      'paragraph:gamma',
    ])
  })

  it('says how deep a heading is, and says nothing of the sort about a paragraph', () => {
    editor('post', '<h2>Introduction</h2><p>alpha</p>')
    const [heading, paragraph] = outline('post')
    expect(heading?.level).toBe(2)
    // Absent rather than null or zero: a paragraph has no depth to report, and
    // an agent given `"level":0` would eventually sort by it.
    expect(paragraph && 'level' in paragraph).toBe(false)
  })

  it('describes the document without reproducing it', () => {
    // The whole reason this tool exists beside `openleaf_get_document`: an agent
    // that has to read fifty sections of markup to retitle one has spent its
    // context before it starts.
    editor('post', '<h2>Introduction</h2><p>alpha <strong>beta</strong> gamma</p>')
    const answer = raw('post')
    expect(answer).toContain('Introduction')
    expect(answer).not.toContain('<')
    expect(answer).not.toContain('strong')
  })

  it('counts a list or a table as one entry rather than descending into it', () => {
    // A recursive walk would be the document again with different punctuation.
    editor('post', '<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    expect(outline('post')).toHaveLength(1)
    const [list] = outline('post')
    expect(list?.type).toBe('bullet_list')
    expect(list?.text).toContain('one')
    expect(list?.text).toContain('two')
  })

  it('outlines an empty document as an empty outline, not as a failure', () => {
    // An empty document still has a paragraph in it -- `doc` is `block+` -- so
    // "empty" is a thing this tool decides rather than one it can read off.
    editor('post', '')
    expect(JSON.parse(raw('post'))).toEqual({ ok: true, id: 'post', outline: [], truncated: false })
  })

  it('skips the blank line an author left behind', () => {
    // An empty paragraph is spacing, not structure. A paragraph that holds only
    // a line break is not the same thing -- it has content in the model -- and
    // is listed, with no text to show for it.
    editor('post', '<p>alpha</p><p></p><p>beta</p>')
    expect(outline('post').map((entry) => entry.text)).toEqual(['alpha', 'beta'])
  })

  it('keeps a block that carries no text but is still structure', () => {
    // A rule is not a blank line: it is something an author put there, and an
    // agent inserting after it has to know it is there.
    editor('post', '<p>alpha</p><hr><p>beta</p>')
    expect(outline('post').map((entry) => entry.type)).toEqual([
      'paragraph',
      'horizontal_rule',
      'paragraph',
    ])
  })

  it('shortens a long block, so an outline stays shorter than the document', () => {
    editor('post', `<p>${'word '.repeat(200)}</p>`)
    const [only] = outline('post')
    expect(only?.text.length).toBeLessThanOrEqual(81)
    expect(only?.text.endsWith('…')).toBe(true)
  })

  it('caps the outline and says so', () => {
    // Bounded by the handle table: an editor keeps its most recent 256 handles,
    // so an outline longer than that would go stale at the top while it was
    // still being read.
    editor('post', Array.from({ length: 260 }, (_, n) => `<p>block ${String(n)}</p>`).join(''))
    const result = JSON.parse(raw('post')) as Outline
    expect(result.outline).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })

  it('leaves the document exactly as it found it', () => {
    const view = editor('post', '<h2>Introduction</h2><p>alpha</p>')
    const before = view.state.doc
    outline('post')
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('outlines the editor it was named and no other', () => {
    editor('post', '<h2>Introduction</h2>')
    editor('notes', '<h2>Notes</h2>')
    expect(outline('notes').map((entry) => entry.text)).toEqual(['Notes'])
  })
})

describe('a handle taken from the outline', () => {
  it('names the block it was listed for', () => {
    editor('post', '<h2>Introduction</h2><p>alpha</p>')
    expect(outline('post').map((entry) => textAt(entry.handle))).toEqual(['Introduction', 'alpha'])
  })

  it('still names it after an edit somewhere else in the document', () => {
    // The point of the whole mechanism: an agent outlines, thinks, and comes
    // back to a document the author has been typing into meanwhile.
    const view = editor('post', '<h2>Introduction</h2><p>alpha</p>')
    const [heading] = outline('post')
    if (!heading) throw new Error('no outline')

    view.dispatch(view.state.tr.insertText(' and more', view.state.doc.content.size - 1))
    expect(textAt(heading.handle)).toBe('Introduction')
  })

  it('refuses once its block has been deleted', () => {
    const view = editor('post', '<h2>Introduction</h2><p>alpha</p>')
    const [heading] = outline('post')
    if (!heading) throw new Error('no outline')

    const found = resolveHandle(heading.handle)
    if (!found.ok) throw new Error('handle did not resolve')
    view.dispatch(view.state.tr.delete(found.from, found.to))

    // Never the paragraph that moved up to take its place, which is what a
    // handle that answered with a position regardless would have named.
    expect(resolveHandle(heading.handle)).toMatchObject({ ok: false, error: 'stale-handle' })
  })

  it('says nothing about where it points', () => {
    editor('post', '<h2>Introduction</h2>')
    const first = outline('post')[0]?.handle
    const again = outline('post')[0]?.handle
    if (!first || !again) throw new Error('no outline')
    expect(first).not.toContain('post')
    expect(first).not.toContain('Introduction')
    expect(first).not.toBe(again)
  })
})
