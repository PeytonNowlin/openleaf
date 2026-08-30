import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { registerDefaultItems } from '@openleaf-editor/ui'
import { history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCommandTool } from '../src/apply-command.js'
import { findTextTool } from '../src/find-text.js'
import { agentHandles } from '../src/handles.js'
import { agentRegistry } from '../src/registry.js'
import { replaceAtTool } from '../src/replace-at.js'

/**
 * One agent action is one press of undo.
 *
 * An author who watches an agent restructure a document is watching a burst of
 * tool calls, and the question the moment it finishes is how many times to
 * press Ctrl+Z. `prosemirror-history` cannot answer it: the element installs a
 * bare `history()` whose grouping is elapsed time and adjacency, so the same
 * six-paragraph rewrite collapses into one step or fragments into six depending
 * on how quickly the model answered and how far apart the paragraphs were. The
 * write path groups on the agent marker instead, and these are the properties
 * that has to have.
 *
 * jsdom rather than Playwright for the same reason `write.test.ts` is: history
 * is document-model bookkeeping, identical in every engine, and `undoDepth` is
 * the only place the answer is legible at all. `packages/core/test/history-
 * grouping.test.ts` is the model for the shape, and it is also the regression
 * this must not break -- a human's own typing groups exactly as it did.
 */

const views: EditorView[] = []

/** An editor with undo, in the shape the register expects. */
function editor(id: string, html: string): EditorView {
  const host = document.createElement('openleaf-editor')
  host.id = id
  document.body.appendChild(host)
  const mount = document.createElement('div')
  host.appendChild(mount)

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      // The plugin list the element installs, in the part that matters here:
      // a bare `history()`, with no `newGroupDelay` and no `depth`. A plugin
      // cannot change those options -- there is no hook -- which is why the
      // grouping decision has to travel on the transactions themselves.
      plugins: [history(), agentRegistry(), agentHandles()],
    }),
  })
  views.push(view)
  return view
}

const html = (view: EditorView): string => serializeHtml(view.state.doc)

interface Result {
  ok: boolean
  error?: string
  id?: string
}

/** The handle for the first occurrence of `text`, which is what a tool would hold. */
function handleFor(id: string, text: string): string {
  const found = JSON.parse(findTextTool.execute({ id, text })) as {
    matches?: { handle: string }[]
  }
  const handle = found.matches?.[0]?.handle
  if (handle === undefined) throw new Error(`no match for ${text}`)
  return handle
}

/** One agent write: search, then replace what was found. A write spends its handle. */
function agentWrite(id: string, text: string, replacement: string): Result {
  const handle = handleFor(id, text)
  const result = JSON.parse(
    replaceAtTool.execute({ id, handle, html: replacement }),
  ) as Result
  expect(result).toMatchObject({ ok: true })
  return result
}

/** One agent format: the other write path, which dispatches its own transaction. */
function agentFormat(id: string, text: string, command: string): Result {
  const handle = handleFor(id, text)
  const result = JSON.parse(applyCommandTool.execute({ id, command, handle })) as Result
  expect(result).toMatchObject({ ok: true })
  return result
}

/** The author, typing. A plain transaction, exactly as a keystroke produces one. */
function humanTypes(view: EditorView, text: string, pos: number): void {
  view.dispatch(view.state.tr.insertText(text, pos))
}

const undoOnce = (view: EditorView): boolean => undo(view.state, (tr) => view.dispatch(tr))
const redoOnce = (view: EditorView): boolean => redo(view.state, (tr) => view.dispatch(tr))

/**
 * The clock history groups on, under this file's control.
 *
 * `Transaction` stamps itself with `Date.now()`, and `newGroupDelay` is 500ms.
 * Every call in a test file lands in the same millisecond, so without a clock
 * to move, "a slow sequence of agent calls still groups" is a property no
 * assertion here could tell apart from "everything within 500ms groups" --
 * which is the default this whole feature exists to stop relying on.
 */
let now = 0

/** Longer than `newGroupDelay` by a wide margin: an agent that stopped to think. */
function aLongPause(): void {
  now += 10_000
}

beforeAll(() => {
  // The command registry is page-global and populated by whatever the
  // deployment loaded. Nothing imports the element here, so `bold` has to be
  // registered explicitly for `openleaf_apply_command` to have anything to run.
  registerDefaultItems()
})

beforeEach(() => {
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('a run of agent writes', () => {
  it('is one undo, however many calls it took', () => {
    const view = editor('post', '<p>alpha</p><p>beta</p><p>gamma</p>')
    const before = html(view)

    agentWrite('post', 'alpha', 'one')
    agentWrite('post', 'beta', 'two')
    agentWrite('post', 'gamma', 'three')
    expect(html(view)).toBe('<p>one</p><p>two</p><p>three</p>')

    // Three transactions, one event. This is the whole ticket: the author saw
    // one thing happen and presses undo once.
    expect(undoDepth(view.state)).toBe(1)
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe(before)
    expect(undoDepth(view.state)).toBe(0)
  })

  it('groups however slowly the calls arrive', () => {
    // The acceptance criterion the marker exists for. Ten seconds is twenty
    // times `newGroupDelay`, so a run grouped by elapsed time would be three
    // separate events here and the author would have to guess how many times
    // to press. A model that stops to think between calls is the normal case,
    // not the edge case.
    const view = editor('post', '<p>alpha</p><p>beta</p><p>gamma</p>')
    const before = html(view)

    agentWrite('post', 'alpha', 'one')
    aLongPause()
    agentWrite('post', 'beta', 'two')
    aLongPause()
    agentWrite('post', 'gamma', 'three')

    expect(undoDepth(view.state)).toBe(1)
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe(before)
  })

  it('groups across both write paths', () => {
    // `openleaf_apply_command` dispatches a transaction the editor's own
    // command built rather than one the write path assembled, so it is the
    // place a marker or a grouping decision would go missing. An agent that
    // rewrites a sentence and then bolds a word did one thing.
    const view = editor('post', '<p>alpha beta</p>')

    agentWrite('post', 'alpha', 'sigma')
    agentFormat('post', 'beta', 'bold')
    expect(html(view)).toBe('<p>sigma <strong>beta</strong></p>')

    expect(undoDepth(view.state)).toBe(1)
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>alpha beta</p>')
  })

  it('comes back whole on redo', () => {
    const view = editor('post', '<p>alpha</p><p>beta</p>')

    agentWrite('post', 'alpha', 'one')
    agentWrite('post', 'beta', 'two')
    const done = html(view)

    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>alpha</p><p>beta</p>')
    expect(redoDepth(view.state)).toBe(1)

    // Symmetry is not decoration: an author who undoes to look at the original
    // and then changes their mind gets the agent's work back in one press, not
    // half of it.
    expect(redoOnce(view)).toBe(true)
    expect(html(view)).toBe(done)
    expect(redoDepth(view.state)).toBe(0)
  })
})

describe('an author editing alongside the agent', () => {
  it('breaks the run, so undo does not swallow their own work', () => {
    const view = editor('post', '<p>alpha</p><p>beta</p><p>gamma</p>')

    agentWrite('post', 'alpha', 'one')
    // The author types in a paragraph the agent has not touched, which is what
    // watching an agent work looks like from the other side of the keyboard.
    humanTypes(view, 'mine', view.state.doc.content.size - 1)
    expect(html(view)).toBe('<p>one</p><p>beta</p><p>gammamine</p>')
    agentWrite('post', 'beta', 'two')

    // Three events, not one: the author's sentence is its own, with an agent
    // event either side of it.
    expect(undoDepth(view.state)).toBe(3)

    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>one</p><p>beta</p><p>gammamine</p>')
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>one</p><p>beta</p><p>gamma</p>')
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>alpha</p><p>beta</p><p>gamma</p>')
  })

  it('keeps a run before it out of the agent event that follows', () => {
    // The other direction, and the reason the first write of a run closes the
    // history group rather than merely not joining one. An agent write that
    // landed inside `newGroupDelay` of the author's last keystroke would
    // otherwise be merged into it by adjacency, and one undo would take back
    // the agent's change *and* the word the author had just typed.
    const view = editor('post', '<p>alpha beta</p>')
    humanTypes(view, 'zulu ', 1)
    expect(html(view)).toBe('<p>zulu alpha beta</p>')

    agentWrite('post', 'alpha', 'sigma')
    expect(undoDepth(view.state)).toBe(2)
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>zulu alpha beta</p>')
  })

  it('still groups their own consecutive typing', () => {
    // The regression guard. Nothing here touches a transaction the author
    // produced, so ordinary typing coalesces on time and adjacency exactly as
    // it does in an editor this package was never installed in -- including
    // after an agent write, which must not leave the history in a state where
    // every keystroke is its own event.
    const view = editor('post', '<p>alpha</p>')
    agentWrite('post', 'alpha', 'one')

    humanTypes(view, 'a', 4)
    humanTypes(view, 'b', 5)
    humanTypes(view, 'c', 6)
    expect(html(view)).toBe('<p>oneabc</p>')

    expect(undoDepth(view.state)).toBe(2)
    expect(undoOnce(view)).toBe(true)
    expect(html(view)).toBe('<p>one</p>')
  })
})
