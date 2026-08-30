import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findTextTool } from '../src/find-text.js'
import { createHandles, agentHandles } from '../src/handles.js'
import { agentRegistry, findEditor } from '../src/registry.js'
import { replaceAtTool } from '../src/replace-at.js'
import { agentKey } from '../src/write.js'

/**
 * What an agent write does to a document, and what a refused one does not.
 *
 * jsdom rather than Playwright for the same reason `handles.test.ts` is: none
 * of this is selection, focus or contenteditable behaviour. It is what the
 * paste policy lets through, what the preservation layer refuses, and how many
 * transactions come out the other side -- all of which are document model and
 * identical in every engine. `webmcp.spec.ts` drives the same tool through the
 * shipped bundle in three real browsers and asserts on what the form would
 * post; what it cannot see from there is the transaction count or the marker,
 * and those are acceptance criteria in their own right.
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

const replace = (args: Record<string, unknown>): ToolResult =>
  JSON.parse(replaceAtTool.execute(args)) as ToolResult

/** The first handle for `text`, which is how an agent gets a range at all. */
function handleFor(id: string, text: string): string {
  const found = JSON.parse(findTextTool.execute({ id, text })) as {
    matches?: { handle: string }[]
  }
  const handle = found.matches?.[0]?.handle
  expect(handle).toBeTruthy()
  // Cleared here rather than in `beforeEach`: the search issues a step-free
  // transaction of its own for the handles, and the count that matters is what
  // the write adds on top of it.
  dispatched = []
  return handle as string
}

beforeEach(() => {
  dispatched = []
})

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('replacing the text at a handle', () => {
  it('puts the new content where the handle pointed', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    expect(replace({ id: 'post', handle: handleFor('post', 'beta'), html: 'delta' })).toEqual({
      ok: true,
      id: 'post',
    })
    expect(html(view)).toBe('<p>alpha delta gamma</p>')
  })

  it('lands as exactly one transaction, marked as the agent\'s', () => {
    // The transaction count is the acceptance criterion an author feels: one
    // call the agent made is one entry the author undoes. The marker is what
    // makes the undo grouping across a run of calls possible at all, and it is
    // read nowhere else yet, so this is the only place it can be proved.
    editor('post', '<p>alpha beta</p>')
    replace({ id: 'post', handle: handleFor('post', 'beta'), html: 'gamma' })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.getMeta(agentKey)).toEqual({ tool: 'openleaf_replace_at' })
  })

  it('merges a block of HTML into the paragraph it landed in', () => {
    // What a person pasting `<p>text</p>` mid-sentence gets, because it is the
    // same slice and the same fitting. An agent that wraps its answer in a
    // paragraph -- and models do -- must not split the sentence in two.
    const view = editor('post', '<p>alpha beta gamma</p>')
    replace({ id: 'post', handle: handleFor('post', 'beta'), html: '<p>delta</p>' })
    expect(html(view)).toBe('<p>alpha delta gamma</p>')
  })

  it('keeps the marks the HTML carried', () => {
    const view = editor('post', '<p>alpha beta</p>')
    replace({ id: 'post', handle: handleFor('post', 'beta'), html: '<strong>bold</strong>' })
    expect(html(view)).toBe('<p>alpha <strong>bold</strong></p>')
  })
})

describe('a handle that names a whole block', () => {
  /**
   * The shape an outline hands out: a block's whole node range, boundary
   * tokens included, rather than a run of inline text inside one. Nothing in
   * the handle table distinguishes the two -- the range is the contract -- so
   * the write path has to read the shape off the document, and an inline slice
   * dropped over a block range is the failure this guards.
   */
  function blockHandle(view: EditorView, id: string, index: number): string {
    const registered = findEditor(id)
    expect(registered).toBeTruthy()
    let offset = 0
    for (let i = 0; i < index; i += 1) offset += view.state.doc.child(i).nodeSize
    const [issued] = createHandles(registered!, [
      { from: offset, to: offset + view.state.doc.child(index).nodeSize },
    ])
    dispatched = []
    return issued?.handle as string
  }

  it('replaces the block rather than splitting the one beside it', () => {
    const view = editor('post', '<h2>Heading</h2><p>alpha</p>')
    expect(
      replace({ id: 'post', handle: blockHandle(view, 'post', 0), html: '<p>rewritten</p>' }),
    ).toMatchObject({ ok: true })
    expect(html(view)).toBe('<p>rewritten</p><p>alpha</p>')
    expect(dispatched).toHaveLength(1)
  })

  it('keeps a block the agent asked for as that block', () => {
    // The reason an outline names the whole node and not its contents: a
    // heading a later call rewrites should come back a heading.
    const view = editor('post', '<h2>Heading</h2><p>alpha</p>')
    replace({ id: 'post', handle: blockHandle(view, 'post', 0), html: '<h2>Rewritten</h2>' })
    expect(html(view)).toBe('<h2>Rewritten</h2><p>alpha</p>')
  })

  it('turns bare text into the one block that replaces it', () => {
    const view = editor('post', '<p>alpha</p><h2>Heading</h2><p>omega</p>')
    replace({ id: 'post', handle: blockHandle(view, 'post', 1), html: 'plain' })
    expect(html(view)).toBe('<p>alpha</p><p>plain</p><p>omega</p>')
  })
})

describe('the paste policy, applied before the parser', () => {
  it('strips what a paste would strip, rather than preserving it', () => {
    // The ordering this ticket exists for. Parsing first would hand the
    // preservation layer a `<div>` it does not recognize, and it would keep it
    // whole -- inline style and all -- forever. Sanitizing first means the
    // style is gone before the parser ever sees the markup, and only the class
    // the preservation layer legitimately keeps survives.
    const view = editor('post', '<p>alpha beta</p>')
    replace({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<div class="callout" style="color:red"><p>injected</p></div>',
    })
    expect(html(view)).toContain('class="callout"')
    expect(html(view)).not.toContain('color:red')
  })

  it('does not let the HTML choose which normalizer runs', () => {
    // `normalizePastedHtml` dispatches on `detectSource`, and `data-pm-slice` --
    // the attribute ProseMirror stamps on its own clipboard HTML -- selects the
    // normalizer that KEEPS inline styles, because a copy out of this editor is
    // in the same trust domain as its destination. An agent writes its own
    // argument, so that signal is one it can set: without the override in
    // `write.ts` the style below survives verbatim and an agent has put markup
    // into the document that no person could have pasted there.
    const view = editor('post', '<p>alpha beta</p>')
    replace({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<div class="callout" data-pm-slice="1 1 []" style="position:fixed">injected</div>',
    })
    expect(html(view)).toContain('injected')
    expect(html(view)).not.toContain('position:fixed')
  })

  it('refuses content the policy leaves nothing of, and writes nothing', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const before = html(view)
    const result = replace({
      id: 'post',
      handle: handleFor('post', 'beta'),
      html: '<script>alert(1)</script>',
    })
    expect(result).toMatchObject({ ok: false, error: 'rejected-content' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses an empty replacement rather than reading it as a deletion', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const before = html(view)
    expect(replace({ id: 'post', handle: handleFor('post', 'beta'), html: '' })).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
    expect(html(view)).toBe(before)
  })
})

describe('preserved markup', () => {
  const WITH_CALLOUT =
    '<p>alpha beta</p>\n<div class="callout" data-callout-id="7"><p>Load-bearing wrapper.</p></div>\n<p>omega</p>'

  it('serializes byte-identically after a write it did not touch', () => {
    // The promise most at risk from a new writer: the wrapper is stored as an
    // opaque atom carrying its own markup, and a write elsewhere in the
    // document must not disturb a byte of it.
    const view = editor('post', WITH_CALLOUT)
    const before = html(view)
    replace({ id: 'post', handle: handleFor('post', 'beta'), html: 'delta' })
    const after = html(view)
    expect(after).not.toBe(before)
    expect(after).toContain('<div class="callout" data-callout-id="7"><p>Load-bearing wrapper.</p></div>')
    expect(after).toBe(before.replace('alpha beta', 'alpha delta'))
  })

  it('refuses a range that covers it, and changes nothing', () => {
    // Not reachable through a search -- a preserved block holds no text to
    // find -- but reachable the moment anything else hands out a range, and a
    // write in here is the one thing that would break the promise above.
    const view = editor('post', WITH_CALLOUT)
    const before = html(view)
    const registered = findEditor('post')
    expect(registered).toBeTruthy()
    const [spanning] = createHandles(registered!, [
      { from: 1, to: view.state.doc.content.size - 1 },
    ])
    dispatched = []

    const result = replace({ id: 'post', handle: spanning?.handle, html: 'nope' })
    expect(result).toMatchObject({ ok: false, error: 'preserved-region' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses inline preserved markup an agent found by searching for it', () => {
    // The reachable route, and the reason the guard is not merely defensive:
    // the search stands an inline atom in for one object-replacement
    // character, so an agent that searches for that character is handed a
    // handle onto preserved markup.
    const view = editor('post', '<p>alpha <ins>tracked</ins> beta</p>')
    const before = html(view)
    expect(before).toContain('<ins>tracked</ins>')

    const result = replace({ id: 'post', handle: handleFor('post', '￼'), html: 'plain' })
    expect(result).toMatchObject({ ok: false, error: 'preserved-region' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })
})

describe('a handle that cannot be written through', () => {
  it('refuses one whose text is gone, without touching the document', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    replace({ id: 'post', handle, html: 'gamma' })
    const before = html(view)
    dispatched = []

    // The same handle a second time: the first write deleted the text it named,
    // so it must refuse rather than land on whatever is at those positions now.
    const result = replace({ id: 'post', handle, html: 'delta' })
    expect(result).toMatchObject({ ok: false, error: 'stale-handle' })
    expect(html(view)).toBe(before)
    expect(dispatched).toEqual([])
  })

  it('refuses a handle that names text in another editor', () => {
    const first = editor('post', '<p>alpha beta</p>')
    const second = editor('notes', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')

    const result = replace({ id: 'notes', handle, html: 'gamma' })
    expect(result).toMatchObject({ ok: false, error: 'invalid-argument' })
    expect(result.message).toContain('post')
    expect(html(first)).toBe('<p>alpha beta</p>')
    expect(html(second)).toBe('<p>alpha beta</p>')
  })

  it('refuses a string this page never issued', () => {
    const view = editor('post', '<p>alpha beta</p>')
    expect(replace({ id: 'post', handle: 'not-a-handle', html: 'gamma' })).toMatchObject({
      ok: false,
      error: 'stale-handle',
    })
    expect(html(view)).toBe('<p>alpha beta</p>')
  })

  it('refuses a call with no handle at all', () => {
    editor('post', '<p>alpha beta</p>')
    expect(replace({ id: 'post', html: 'gamma' })).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
  })

  it('refuses an editor that is not on the page', () => {
    editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    expect(replace({ id: 'gone', handle, html: 'gamma' })).toMatchObject({
      ok: false,
      error: 'unknown-editor',
    })
  })
})
