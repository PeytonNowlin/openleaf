import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findTextTool } from '../src/find-text.js'
import { agentHandles, createHandles, type HandleRange } from '../src/handles.js'
import { insertHtmlTool } from '../src/insert-html.js'
import { agentRegistry, findEditor } from '../src/registry.js'
import { agentKey } from '../src/write.js'

/**
 * What an insertion puts into a document, and what it refuses to put anywhere.
 *
 * jsdom rather than Playwright for the reason the other write tests are: none
 * of this is selection, focus or contenteditable behaviour. It is what the
 * schema will hold where, how many transactions come out, and what a refusal
 * leaves behind -- document model, identical in every engine.
 * `webmcp.spec.ts` drives the same tool through the shipped bundle in three
 * real browsers and asserts on what the form would post.
 *
 * The refusals are the point of the file. Replacement can be fitted into
 * whatever the range will take; an insertion that is fitted is an insertion the
 * agent asked for and did not get, reported as a success.
 */

const views: EditorView[] = []

/** Every transaction the editor has been handed, so a call can be counted. */
let dispatched: Transaction[] = []

/** An editor in the shape the register expects: a view inside a host element. */
function editor(id: string, html: string): EditorView {
  const host = document.createElement('openleaf-editor')
  host.id = id
  document.body.appendChild(host)
  const mount = document.createElement('div')
  host.appendChild(mount)

  const view: EditorView = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [agentRegistry(), agentHandles()],
    }),
    dispatchTransaction(tr) {
      dispatched.push(tr)
      view.updateState(view.state.apply(tr))
    },
  })
  views.push(view)
  return view
}

const html = (view: EditorView): string => serializeHtml(view.state.doc)

interface ToolResult {
  ok: boolean
  id?: string
  error?: string
  message?: string
}

const insert = (args: Record<string, unknown>): ToolResult =>
  JSON.parse(insertHtmlTool.execute(args)) as ToolResult

/** The first handle for `text`: an inline range inside one textblock. */
function handleFor(id: string, text: string): string {
  const found = JSON.parse(findTextTool.execute({ id, text })) as {
    matches?: { handle: string }[]
  }
  const handle = found.matches?.[0]?.handle
  expect(handle, `nothing matched "${text}"`).toBeTruthy()
  // Cleared here rather than in `beforeEach`: the search issues a step-free
  // transaction of its own for the handles, and the count that matters is what
  // the insertion adds on top of it.
  dispatched = []
  return handle as string
}

/**
 * A handle over the `n`th top-level block's whole node range -- the other shape
 * a handle comes in, and the one an outline hands out. Nothing in the handle
 * says which of the two it is, so both have to be right.
 */
function blockHandle(view: EditorView, id: string, n: number): string {
  const registered = findEditor(id)
  expect(registered).toBeTruthy()
  let from = 0
  for (let i = 0; i < n; i += 1) from += view.state.doc.child(i).nodeSize
  const range: HandleRange = { from, to: from + view.state.doc.child(n).nodeSize }
  const [issued] = createHandles(registered!, [range])
  dispatched = []
  return issued?.handle as string
}

beforeEach(() => {
  dispatched = []
})

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('inserting beside the text a handle names', () => {
  it('puts inline content after it, leaving it in place', () => {
    const view = editor('post', '<p>alpha beta</p>')
    expect(
      insert({ id: 'post', handle: handleFor('post', 'alpha'), html: ',', position: 'after' }),
    ).toEqual({ ok: true, id: 'post' })
    expect(html(view)).toBe('<p>alpha, beta</p>')
  })

  it('puts inline content before it', () => {
    const view = editor('post', '<p>alpha beta</p>')
    insert({ id: 'post', handle: handleFor('post', 'beta'), html: '<em>x</em>', position: 'before' })
    expect(html(view)).toBe('<p>alpha <em>x</em>beta</p>')
  })

  it('keeps the marks the HTML carried', () => {
    const view = editor('post', '<p>alpha</p>')
    insert({
      id: 'post',
      handle: handleFor('post', 'alpha'),
      html: '<strong>bold</strong>',
      position: 'after',
    })
    expect(html(view)).toBe('<p>alpha<strong>bold</strong></p>')
  })

  it('drops a space at the edge of the HTML, the way parsing it does', () => {
    // Not this tool's doing and not worth working around here: the HTML is
    // parsed on its own, so a leading space is leading whitespace in a
    // document and goes the way it goes in any browser. It is in the tool's
    // description because an agent that does not know it writes "alphaone",
    // and `&nbsp;` is the answer -- as it would be in the markup itself.
    const view = editor('post', '<p>alpha beta</p>')
    insert({ id: 'post', handle: handleFor('post', 'alpha'), html: ' one', position: 'after' })
    expect(html(view)).toBe('<p>alphaone beta</p>')

    const second = editor('notes', '<p>alpha beta</p>')
    insert({ id: 'notes', handle: handleFor('notes', 'alpha'), html: '&nbsp;one', position: 'after' })
    expect(html(second)).toBe('<p>alpha&nbsp;one beta</p>')
  })

  it("lands as exactly one transaction, marked as the agent's", () => {
    // The count is the acceptance criterion an author feels: one call the agent
    // made is one entry the author undoes. The marker is what makes grouping a
    // run of them possible at all.
    editor('post', '<p>alpha</p>')
    insert({ id: 'post', handle: handleFor('post', 'alpha'), html: ' one', position: 'after' })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.getMeta(agentKey)).toEqual({ tool: 'openleaf_insert_html' })
  })

  it('leaves the handle naming the same text, so a second insertion works', () => {
    // The difference from replacement that an agent plans around: an insertion
    // does not delete what the handle named, so the handle is not spent. Both
    // ends map outward, which is what keeps the new content outside it.
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    expect(insert({ id: 'post', handle, html: '(', position: 'before' })).toMatchObject({
      ok: true,
    })
    expect(insert({ id: 'post', handle, html: ')', position: 'after' })).toMatchObject({
      ok: true,
    })
    expect(html(view)).toBe('<p>alpha (beta)</p>')
  })
})

describe('inserting at a handle that names a whole block', () => {
  it('puts a block after it without disturbing it', () => {
    const view = editor('post', '<h2>Heading</h2><p>alpha</p>')
    expect(
      insert({
        id: 'post',
        handle: blockHandle(view, 'post', 0),
        html: '<p>intro</p>',
        position: 'after',
      }),
    ).toMatchObject({ ok: true })
    expect(html(view)).toBe('<h2>Heading</h2><p>intro</p><p>alpha</p>')
    expect(dispatched).toHaveLength(1)
  })

  it('puts a block before it, including at the top of the document', () => {
    const view = editor('post', '<p>alpha</p>')
    insert({
      id: 'post',
      handle: blockHandle(view, 'post', 0),
      html: '<h2>Title</h2>',
      position: 'before',
    })
    expect(html(view)).toBe('<h2>Title</h2><p>alpha</p>')
  })

  it('keeps several blocks as the blocks they were', () => {
    const view = editor('post', '<p>alpha</p>')
    insert({
      id: 'post',
      handle: blockHandle(view, 'post', 0),
      html: '<h2>Title</h2><p>one</p>',
      position: 'after',
    })
    expect(html(view)).toBe('<p>alpha</p><h2>Title</h2><p>one</p>')
  })
})

describe('an insertion the schema will not take', () => {
  it('refuses a block inside a sentence rather than splitting it', () => {
    // The case the tool exists to get right. `replaceRange` would answer this
    // by cutting the paragraph in two around the heading -- a document the
    // agent did not ask for, reported as a success it can act on.
    const view = editor('post', '<p>alpha beta</p>')
    const before = html(view)
    const result = insert({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<h2>Title</h2>',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'invalid-position' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('says what the position holds, so the agent can act on the refusal', () => {
    // The schema's own content expression. It is the difference between "no"
    // and "no, this holds inline content" -- the second tells an agent to send
    // inline HTML, or to ask an outline for a handle that names a block.
    editor('post', '<p>alpha beta</p>')
    const result = insert({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<ul><li>one</li></ul>',
      position: 'before',
    })
    expect(result.error).toBe('invalid-position')
    expect(result.message).toContain('paragraph')
    expect(result.message).toContain('inline')
  })

  it('refuses several blocks aimed into a run of text', () => {
    // A lone paragraph is unwrapped into the sentence it lands in, because a
    // model wraps its answer in one. Two of them are structure it chose, and
    // structure does not go inside a sentence.
    const view = editor('post', '<p>alpha beta</p>')
    const before = html(view)
    const result = insert({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<p>one</p><p>two</p>',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'invalid-position' })
    expect(html(view)).toBe(before)
  })

  it('unwraps a lone paragraph into the sentence instead of refusing it', () => {
    const view = editor('post', '<p>alpha beta</p>')
    expect(
      insert({
        id: 'post',
        handle: handleFor('post', 'beta'),
        html: '<p>&nbsp;and one</p>',
        position: 'after',
      }),
    ).toMatchObject({ ok: true })
    expect(html(view)).toBe('<p>alpha beta&nbsp;and one</p>')
  })

  it('refuses content a code block cannot carry, rather than flattening it', () => {
    // A code block holds text and no marks at all, so the fitting an insertion
    // does not do would have dropped the emphasis and kept the word -- an agent
    // told it emphasised something that is not emphasised.
    const view = editor('post', '<pre><code>alpha beta</code></pre>')
    const before = html(view)
    const result = insert({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<em>one</em>',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'invalid-position' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })
})

describe('what an insertion inherits from the write path', () => {
  it('sanitizes before it parses', () => {
    const view = editor('post', '<p>alpha</p>')
    insert({
      id: 'post',
      handle: blockHandle(view, 'post', 0),
      html: '<div class="callout" style="color:red"><p>injected</p></div>',
      position: 'after',
    })
    expect(html(view)).toContain('class="callout"')
    expect(html(view)).not.toContain('color:red')
  })

  it('refuses content the paste policy leaves nothing of, and writes nothing', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const before = html(view)
    const result = insert({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<script>alert(1)</script>',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'rejected-content' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses a range that covers preserved markup', () => {
    // The reachable route: the search stands an inline atom in for one
    // object-replacement character, so an agent that searches for that
    // character is handed a handle onto markup the editor hands back
    // byte-identical. Inserting against its edge is refused with it -- the
    // whole named range is the question, not the point being written to.
    const view = editor('post', '<p>alpha <ins>tracked</ins> beta</p>')
    const before = html(view)
    const result = insert({
      id: 'post',
      handle: handleFor('post', '￼'),
      html: 'one',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'preserved-region' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses a handle whose text is gone', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    view.dispatch(view.state.tr.delete(7, 11))
    const before = html(view)
    dispatched = []

    const result = insert({ id: 'post', handle, html: 'one', position: 'after' })
    expect(result).toMatchObject({ ok: false, error: 'stale-handle' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses a handle that names text in another editor', () => {
    const first = editor('post', '<p>alpha beta</p>')
    const second = editor('notes', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')

    const result = insert({ id: 'notes', handle, html: 'one', position: 'after' })
    expect(result).toMatchObject({ ok: false, error: 'invalid-argument' })
    expect(html(first)).toBe('<p>alpha beta</p>')
    expect(html(second)).toBe('<p>alpha beta</p>')
  })

  it('refuses an editor that is not on the page', () => {
    editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    expect(insert({ id: 'gone', handle, html: 'one', position: 'after' })).toMatchObject({
      ok: false,
      error: 'unknown-editor',
    })
  })
})

describe('the arguments', () => {
  it('refuses empty HTML rather than writing an empty passage', () => {
    editor('post', '<p>alpha beta</p>')
    expect(
      insert({ id: 'post', handle: handleFor('post', 'beta'), html: '', position: 'after' }),
    ).toMatchObject({ ok: false, error: 'invalid-argument' })
  })

  it('refuses a call that does not say which side to insert on', () => {
    // Not defaulted to one end. "Insert at this heading" means opposite things
    // to an agent writing an introduction and one writing a section, so
    // guessing would be wrong half the time and silent about it.
    const view = editor('post', '<p>alpha beta</p>')
    const result = insert({ id: 'post', handle: handleFor('post', 'beta'), html: 'one' })
    expect(result).toMatchObject({ ok: false, error: 'invalid-argument' })
    expect(result.message).toContain('position')
    expect(html(view)).toBe('<p>alpha beta</p>')
  })

  it('refuses a side it does not know', () => {
    editor('post', '<p>alpha beta</p>')
    expect(
      insert({
        id: 'post',
        handle: handleFor('post', 'beta'),
        html: 'one',
        position: 'inside',
      }),
    ).toMatchObject({ ok: false, error: 'invalid-argument' })
  })
})
