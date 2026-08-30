import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { registerDefaultItems, registerToolbarItem } from '@openleaf-editor/ui'
import { history } from 'prosemirror-history'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyCommandTool } from '../src/apply-command.js'
import { findTextTool } from '../src/find-text.js'
import { agentHandles, createHandles, type HandleRange } from '../src/handles.js'
import { agentKey } from '../src/write.js'
import { agentRegistry, findEditor } from '../src/registry.js'

/**
 * What running a real command against a handle's range actually does.
 *
 * jsdom rather than Playwright for the same reason `handles.test.ts` is: none
 * of this is selection, focus or contenteditable behaviour. It is which
 * transaction a command produces and whether the editor accepts it, which is
 * document-model arithmetic and identical in every engine. `webmcp.spec.ts`
 * drives the same tool through the shipped bundle in three real browsers and
 * asserts on what the form would submit.
 *
 * Three cases live here and not there, because the browser harness cannot
 * reach them: a range spanning preserved markup (no tool issues such a handle
 * yet -- `openleaf_find_text` cannot find text inside an atom that has none),
 * a command that genuinely declines at a position, and the count of
 * transactions one call produces.
 */

const views: EditorView[] = []
/** Transactions the editor under test received, once `watch` is armed. */
let seen: Transaction[] = []

/** An editor in the shape the register expects: a view inside a host element. */
function editor(id: string, html: string, toolbar?: string): EditorView {
  const host = document.createElement('openleaf-editor')
  host.id = id
  if (toolbar !== undefined) host.setAttribute('toolbar', toolbar)
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

/**
 * Record every transaction from here on.
 *
 * Armed after the handles are taken, because issuing a handle dispatches one of
 * its own -- step-free, so it changes nothing, but it would still be counted.
 */
function watch(view: EditorView): void {
  seen = []
  view.setProps({
    dispatchTransaction(tr) {
      seen.push(tr)
      view.updateState(view.state.apply(tr))
    },
  })
}

interface Result {
  ok: boolean
  error?: string
  message?: string
  id?: string
  command?: string
}

/** The handle for the first occurrence of `text`, which is what a tool would hold. */
function handleFor(id: string, text: string): string {
  const result = JSON.parse(findTextTool.execute({ id, text })) as {
    matches?: { handle: string }[]
  }
  const handle = result.matches?.[0]?.handle
  if (handle === undefined) throw new Error(`no match for ${text}`)
  return handle
}

const apply = (args: Record<string, unknown>): Result =>
  JSON.parse(applyCommandTool.execute(args)) as Result

/**
 * A handle over a range this file names itself.
 *
 * `openleaf_get_structure` mints handles over a whole block's node range and
 * `openleaf_find_text` mints them over inline text, and nothing in a handle
 * says which it is. That tool is not on this branch, so the ranges it produces
 * are written out here rather than gone without.
 */
function handleOver(id: string, range: HandleRange): string {
  const target = findEditor(id)
  if (!target) throw new Error(`no editor named ${id}`)
  const [ranged] = createHandles(target, [range])
  if (!ranged) throw new Error('no handle issued')
  return ranged.handle
}

/** The node range of the `n`th top-level block, as an outline handle names it. */
function blockRange(view: EditorView, n: number): HandleRange {
  let from = 0
  for (let i = 0; i < n; i += 1) from += view.state.doc.child(i).nodeSize
  return { from, to: from + view.state.doc.child(n).nodeSize }
}

const html = (view: EditorView): string => serializeHtml(view.state.doc)

beforeAll(() => {
  // The registry is page-global and populated at import time by whatever the
  // deployment loaded. Nothing imports the element here, so the default items
  // are registered explicitly -- which is also the point: this tool can only
  // run what the registry holds.
  registerDefaultItems()
})

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
  seen = []
})

describe('applying a command', () => {
  it('formats the text the handle names, and nothing else', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const result = apply({ id: 'post', command: 'bold', handle: handleFor('post', 'beta') })
    expect(result).toEqual({ ok: true, id: 'post', command: 'bold' })
    expect(html(view)).toBe('<p>alpha <strong>beta</strong> gamma</p>')
  })

  it('leaves the handle naming the same text, so a second command can follow', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const handle = handleFor('post', 'beta')
    apply({ id: 'post', command: 'bold', handle })
    apply({ id: 'post', command: 'italic', handle })
    expect(html(view)).toBe('<p>alpha <strong><em>beta</em></strong> gamma</p>')
  })

  it('produces exactly one transaction, marked as the agent\'s', () => {
    // One transaction is what makes one undo reverse one agent action, and the
    // marker is what groups a run of them into that one action.
    //
    // The marker names the TOOL, not the command. It used to carry `bold` here
    // -- the command id -- so a field called `tool` meant one thing on this
    // path and another on `openleaf_replace_at`'s, and a reader of a marked
    // transaction could not tell which. Which command ran is reported in the
    // result, where the agent reads it; the marker says who wrote.
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    watch(view)
    expect(apply({ id: 'post', command: 'bold', handle })).toEqual({
      ok: true,
      id: 'post',
      command: 'bold',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.getMeta(agentKey)).toEqual({ tool: 'openleaf_apply_command' })
  })

  it("captures a command that dispatches through the view rather than its callback", () => {
    // A `Command` is `(state, dispatch, view)`, and the third argument is a way
    // out of the second: a command handed the live view can dispatch for
    // itself, unmarked, ungrouped, past the did-it-land check and past "exactly
    // one transaction per call". Commands are third-party code here --
    // `registerToolbarItem` is last-wins, so even a built-in id may be an
    // integrator's -- so the view it is handed captures the same way the
    // callback does, and the one dispatch is still this package's.
    registerToolbarItem({
      id: 'sideways',
      label: 'Sideways',
      command: (state, _dispatch, editorView) => {
        editorView?.dispatch(state.tr.insertText('!', state.selection.to))
        return true
      },
    })
    const view = editor('post', '<p>alpha beta</p>', 'sideways')
    const handle = handleFor('post', 'beta')
    watch(view)

    expect(apply({ id: 'post', command: 'sideways', handle })).toEqual({
      ok: true,
      id: 'post',
      command: 'sideways',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.getMeta(agentKey)).toEqual({ tool: 'openleaf_apply_command' })
    expect(html(view)).toBe('<p>alpha beta!</p>')
  })

  it('leaves the author where they were rather than moving the caret', () => {
    // The agent's range is staged as a selection so the command knows what to
    // act on. Leaving it there would jump a caret that may be in another
    // paragraph, and the next thing the author typed would land in it.
    const view = editor('post', '<p>alpha beta</p><p>second</p>')
    const handle = handleFor('post', 'beta')
    const caret = view.state.doc.content.size - 2
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)))
    apply({ id: 'post', command: 'bold', handle })
    expect(view.state.selection.from).toBe(caret)
  })
})

describe('a command the editor will not run', () => {
  it('reports a decline rather than success, and changes nothing', () => {
    // A code block holds no marks at all (`marks: ''` in the schema), so
    // `toggleMark` answers false -- which is exactly the greyed-out button a
    // person sees, and exactly what must not be reported as applied.
    const view = editor('post', '<pre><code>alpha beta</code></pre>')
    const before = html(view)
    const result = apply({ id: 'post', command: 'bold', handle: handleFor('post', 'beta') })
    expect(result).toMatchObject({ ok: false, error: 'refused' })
    expect(html(view)).toBe(before)
  })

  it('refuses a control that only works through the interface', () => {
    // `blockType` is registered, is on the default bar, and applies a heading --
    // and is a `custom` item with a `render` and no command, so there is
    // nothing to run. Reporting it as applied would be the worst answer of the
    // three, because the agent would move on believing the heading exists.
    const view = editor('post', '<p>alpha beta</p>')
    const result = apply({ id: 'post', command: 'blockType', handle: handleFor('post', 'beta') })
    expect(result).toMatchObject({ ok: false, error: 'unsupported-command' })
    expect(html(view)).toBe('<p>alpha beta</p>')
  })

  it('refuses a command this editor\'s toolbar does not carry', () => {
    // Registered in this deployment, and not offered here. The restriction is a
    // layout decision, so the answer has to be per editor rather than per page.
    editor('narrow', '<p>alpha beta</p>', 'bold italic')
    expect(apply({ id: 'narrow', command: 'blockquote', handle: handleFor('narrow', 'beta') })).toMatchObject(
      { ok: false, error: 'unknown-command' },
    )
  })

  it('refuses a command nothing registered', () => {
    editor('post', '<p>alpha beta</p>')
    const result = apply({ id: 'post', command: 'insertTable', handle: handleFor('post', 'beta') })
    expect(result).toMatchObject({ ok: false, error: 'unknown-command' })
    expect(result.message).toContain('openleaf_get_capabilities')
  })

  /**
   * The one refusal that is about what a command ACTS on rather than whether it
   * can run at all.
   *
   * `undo` is registered, is first on the default bar, and has a plain command
   * -- so every other guard in this file passes it through. It is also the one
   * pair of commands that ignores the selection: it reverts the last history
   * event wherever in the document it happened. Applied through a handle, it
   * would revert an author's own edit in another paragraph and answer `{"ok":
   * true, "command":"undo"}`, which is the exact shape of an agent reporting
   * work it did not do.
   */
  it("refuses a command that acts on the document's history rather than a range", () => {
    const host = document.createElement('openleaf-editor')
    host.id = 'historied'
    document.body.appendChild(host)
    const mount = document.createElement('div')
    host.appendChild(mount)
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: parseHtml('<p>alpha beta</p><p>author paragraph</p>', { schema: coreSchema() }),
        plugins: [history(), agentRegistry(), agentHandles()],
      }),
    })
    views.push(view)

    // The author's own edit, in the paragraph the agent's handle does not name.
    // This is what an accepted `undo` would have thrown away.
    const at = view.state.doc.child(0).nodeSize + view.state.doc.child(1).content.size
    view.dispatch(view.state.tr.insertText(' edited', at))
    const before = html(view)

    const result = apply({
      id: 'historied',
      command: 'undo',
      handle: handleFor('historied', 'beta'),
    })
    expect(result).toMatchObject({ ok: false, error: 'unsupported-command' })
    expect(result.message).toContain('history')
    expect(html(view)).toBe(before)
  })

  it('refuses a command that throws instead of letting it reach the agent', () => {
    // A toolbar item is third-party code and the registry is last-wins per id,
    // so even a built-in id may not be the built-in command. A throw out of a
    // handler reaches the agent as a rejected call with no shape to it.
    registerToolbarItem({
      id: 'explode',
      label: 'Explode',
      command: () => {
        throw new Error('nope')
      },
    })
    editor('post', '<p>alpha beta</p>', 'explode')
    expect(apply({ id: 'post', command: 'explode', handle: handleFor('post', 'beta') })).toMatchObject({
      ok: false,
      error: 'refused',
    })
  })
})

describe('where an agent may not write at all', () => {
  it('refuses a range that holds preserved markup', () => {
    // The preservation layer's promise is that markup it did not understand
    // comes back byte for byte, and it only holds if nothing edits inside it.
    // The handle is made by hand because no tool issues one like this yet:
    // `openleaf_find_text` reads text, and a preserved atom has none.
    const view = editor('post', '<p>alpha <x-widget>held</x-widget> beta</p>')
    const handle = handleOver('post', blockRange(view, 0))
    const before = html(view)
    expect(apply({ id: 'post', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'preserved-region',
    })
    expect(html(view)).toBe(before)
  })

  it('refuses a readonly editor, the way its own toolbar does', () => {
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    view.dom.closest('openleaf-editor')?.setAttribute('readonly', '')
    expect(apply({ id: 'post', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'refused',
    })
    expect(html(view)).toBe('<p>alpha beta</p>')
  })

  it('refuses while the HTML source view is open', () => {
    // Every toolbar control goes unavailable in source view, because the change
    // would be applied to the hidden document that closing the view parses over
    // the top of. An agent told the command applied would be told a lie that
    // survives exactly until the author closes the source box.
    const view = editor('post', '<p>alpha beta</p>')
    const handle = handleFor('post', 'beta')
    Object.assign(view.dom.closest('openleaf-editor') as object, { sourceMode: true })
    expect(apply({ id: 'post', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'refused',
    })
    expect(html(view)).toBe('<p>alpha beta</p>')
  })
})

describe('a handle that names a whole block', () => {
  it('applies the command to that block and to no neighbour', () => {
    // The outline mints `[offset, offset + nodeSize]`: both ends are boundary
    // tokens rather than text positions, so the range has to be brought inside
    // the block before a command sees it.
    const view = editor('post', '<p>alpha</p><h2>beta</h2><p>gamma</p>')
    const result = apply({ id: 'post', command: 'bold', handle: handleOver('post', blockRange(view, 1)) })
    expect(result.ok).toBe(true)
    expect(html(view)).toBe('<p>alpha</p><h2><strong>beta</strong></h2><p>gamma</p>')
  })

  it('reaches inside a container rather than stopping at its wrapper', () => {
    const view = editor('post', '<blockquote><p>alpha beta</p></blockquote>')
    expect(apply({ id: 'post', command: 'bold', handle: handleOver('post', blockRange(view, 0)) }).ok).toBe(
      true,
    )
    // The sole paragraph is unwrapped on the way out, which is the serializer's
    // business and not this tool's -- what matters is that the mark landed on
    // the text inside the wrapper rather than on nothing.
    expect(html(view)).toBe('<blockquote><strong>alpha beta</strong></blockquote>')
  })

  it('declines on a block with no text, instead of formatting its neighbour', () => {
    // The regression this shape exists for. A rule holds no marks and has no
    // inside, so `bold` must decline -- and the paragraph in front of it, which
    // is where a search outward from a boundary token lands, must be untouched.
    const view = editor('post', '<p>alpha</p><hr><p>gamma</p>')
    const before = html(view)
    expect(apply({ id: 'post', command: 'bold', handle: handleOver('post', blockRange(view, 1)) })).toMatchObject(
      { ok: false, error: 'refused' },
    )
    expect(html(view)).toBe(before)
  })
})

describe('arguments that name nothing', () => {
  it('refuses a handle whose text has gone, rather than a nearby position', () => {
    const view = editor('post', '<p>alpha beta gamma</p>')
    const handle = handleFor('post', 'beta')
    view.dispatch(view.state.tr.delete(7, 11))
    expect(apply({ id: 'post', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'stale-handle',
    })
  })

  it('refuses a handle that belongs to a different editor', () => {
    // The two arguments can disagree, and neither is safe to prefer: the handle
    // would run a command against a document the agent did not name, and the id
    // would check the wrong editor's bar for what is allowed.
    editor('post', '<p>alpha beta</p>')
    const other = editor('other', '<p>alpha beta</p>')
    const result = apply({ id: 'post', command: 'bold', handle: handleFor('other', 'beta') })
    expect(result).toMatchObject({ ok: false, error: 'invalid-argument' })
    expect(html(other)).toBe('<p>alpha beta</p>')
  })

  it('refuses a call with no command named', () => {
    editor('post', '<p>alpha beta</p>')
    expect(apply({ id: 'post', handle: handleFor('post', 'beta') })).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
  })

  it('refuses an editor that is not on the page', () => {
    editor('post', '<p>alpha beta</p>')
    expect(
      apply({ id: 'no-such-editor', command: 'bold', handle: handleFor('post', 'beta') }),
    ).toMatchObject({ ok: false, error: 'unknown-editor' })
  })
})
