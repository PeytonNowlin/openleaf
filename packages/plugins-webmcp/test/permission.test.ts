import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, type Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '../src/permission.js'

/**
 * The integrator's veto, from the outside: what an agent is handed back when a
 * host refuses, and what the document looks like afterwards.
 *
 * Everything here goes through `agentTools` and the JSON string a tool returns
 * -- the same value the browser's execute path resolves to -- rather than
 * through the gate's own module. That is deliberate: a test that asserted on
 * the predicate having been called would pass for an implementation that called
 * it and then wrote anyway.
 *
 * The package is re-imported for every test rather than imported at the top,
 * because the policy is set-once module state and that is the property under
 * test: nothing may replace it, this file included. `vi.resetModules()` gives
 * each test a page of its own, and the register and the handle table have to
 * come from the same fresh instance the tools are reading -- an editor
 * registered in one copy of `registry.ts` does not exist to another.
 *
 * jsdom rather than Playwright, on the same grounds as `write.test.ts`: nothing
 * here is selection, focus or contenteditable. `webmcp.spec.ts` drives the same
 * refusal through the shipped bundle in three real browsers and asserts on what
 * the form would post.
 */

const views: EditorView[] = []

let webmcp: typeof import('../src/index.js')
/** The two per-editor plugins, from the same module instance as the tools. */
let editorPlugins: () => Plugin[]

beforeEach(async () => {
  vi.resetModules()
  webmcp = await import('../src/index.js')
  const registry = await import('../src/registry.js')
  const handles = await import('../src/handles.js')
  editorPlugins = () => [registry.agentRegistry(), handles.agentHandles()]
})

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.closest('openleaf-editor')?.remove()
    view.destroy()
  }
})

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
      plugins: editorPlugins(),
    }),
  })
  views.push(view)
  return view
}

interface ToolResult {
  ok: boolean
  error?: string
  message?: string
  editors?: { id: string }[]
  matches?: { handle: string }[]
}

/** Call a tool the way the browser does: by name, off the published set. */
function call(name: string, args: Record<string, unknown> = {}): ToolResult {
  const tool = webmcp.agentTools.find((candidate) => candidate.name === name)
  expect(tool, name).toBeTruthy()
  return JSON.parse(tool!.execute(args)) as ToolResult
}

describe('with no predicate installed', () => {
  it('leaves every tool exactly as it was', () => {
    editor('post-body', '<p>alpha beta</p>')

    // The whole of "costs nothing when unused": the default is not a permissive
    // predicate, it is no predicate, and the tools answer as they always have.
    expect(call('openleaf_list_editors').editors?.map((e) => e.id)).toEqual(['post-body'])
    expect(call('openleaf_get_document', { id: 'post-body' }).ok).toBe(true)
    expect(call('openleaf_find_text', { id: 'post-body', text: 'beta' }).ok).toBe(true)
  })
})

describe('a predicate that refuses', () => {
  it('gates every tool in the set, including the one that names no editor', () => {
    editor('post-body', '<p>alpha beta</p>')
    webmcp.registerAgentPermission(() => false)

    // Asserted over the set rather than over a list of names, because the point
    // of applying the gate where the set is composed is that a tool added later
    // is gated by having been added. This fails if one ever reaches the array
    // ungated -- which is the failure no per-handler check could catch.
    for (const tool of webmcp.agentTools) {
      const result = JSON.parse(tool.execute({ id: 'post-body' })) as ToolResult
      expect(result.ok, tool.name).toBe(false)
      expect(result.error, tool.name).toBe('refused')
    }
  })

  it('tells the agent it is policy rather than a mistake it can correct', () => {
    editor('post-body', '<p>alpha beta</p>')
    webmcp.registerAgentPermission(() => false)

    const result = call('openleaf_get_document', { id: 'post-body' })
    expect(result.message).toContain('openleaf_get_document')
    expect(result.message).toContain('not a mistake in the call')
  })

  it('changes nothing', () => {
    const view = editor('post-body', '<p>alpha beta</p>')

    // Taken while the page still allows it, so the refusal below is about the
    // write and not about the search that would otherwise have to precede it.
    const handle = call('openleaf_find_text', { id: 'post-body', text: 'beta' }).matches?.[0]
      ?.handle
    expect(handle).toBeTruthy()

    const before = serializeHtml(view.state.doc)
    webmcp.registerAgentPermission(() => false)

    expect(call('openleaf_replace_at', { id: 'post-body', handle, html: '<em>gamma</em>' })).toEqual(
      { ok: false, error: 'refused', message: expect.stringContaining('openleaf_replace_at') },
    )
    // Not "no visible difference": the gate runs before any argument is
    // resolved and before anything touches the view, so a refusal is not a
    // partial write, it is not a write.
    expect(serializeHtml(view.state.doc)).toBe(before)
  })
})

describe('what the predicate is told', () => {
  it('names the tool and the editor, and says whether the call only reads', () => {
    editor('post-body', '<p>alpha beta</p>')
    const seen: AgentToolCall[] = []
    webmcp.registerAgentPermission((request) => {
      seen.push(request)
      return true
    })

    call('openleaf_list_editors')
    call('openleaf_get_document', { id: 'post-body' })
    call('openleaf_apply_command', { id: 'post-body', command: 'bold', handle: 'nope' })

    expect(seen).toEqual([
      // The listing is the one tool that takes no editor, so there is no
      // identifier to give -- and `null` rather than an empty string, so a host
      // testing `editor === 'draft'` cannot match it by accident.
      { tool: 'openleaf_list_editors', editor: null, readOnly: true },
      { tool: 'openleaf_get_document', editor: 'post-body', readOnly: true },
      { tool: 'openleaf_apply_command', editor: 'post-body', readOnly: false },
    ])
  })

  it('is asked before the arguments are checked, so an unknown editor is still the host to decide', () => {
    const seen: AgentToolCall[] = []
    webmcp.registerAgentPermission((request) => {
      seen.push(request)
      return false
    })

    // No editor of that name exists. The host is asked anyway and its refusal
    // is what the agent is told -- a gate that ran after resolution would leak
    // which editors are on a page the host had just said an agent may not touch.
    expect(call('openleaf_get_document', { id: 'ghost' }).error).toBe('refused')
    expect(seen).toEqual([{ tool: 'openleaf_get_document', editor: 'ghost', readOnly: true }])
  })

  it('lets a host allow reads and refuse writes without naming a single tool', () => {
    const view = editor('post-body', '<p>alpha beta</p>')
    const handle = call('openleaf_find_text', { id: 'post-body', text: 'beta' }).matches?.[0]
      ?.handle

    // The worked example from the README, and the reason `readOnly` is on the
    // request at all: a host writing this today keeps the policy it meant when
    // a tool is added, which a list of names does not.
    webmcp.registerAgentPermission(({ readOnly }) => readOnly)

    expect(call('openleaf_get_document', { id: 'post-body' }).ok).toBe(true)
    expect(call('openleaf_replace_at', { id: 'post-body', handle, html: '<em>g</em>' }).error).toBe(
      'refused',
    )
    expect(serializeHtml(view.state.doc)).toBe('<p>alpha beta</p>')
  })

  it('lets a host refuse one editor and allow another', () => {
    editor('post-body', '<p>alpha</p>')
    editor('comment-box', '<p>beta</p>')
    webmcp.registerAgentPermission(({ editor: id }) => id !== 'comment-box')

    expect(call('openleaf_get_document', { id: 'post-body' }).ok).toBe(true)
    expect(call('openleaf_get_document', { id: 'comment-box' }).error).toBe('refused')
  })
})

describe('a predicate that throws', () => {
  it('refuses instead of reaching the agent as a crashed call', () => {
    const view = editor('post-body', '<p>alpha beta</p>')
    const handle = call('openleaf_find_text', { id: 'post-body', text: 'beta' }).matches?.[0]
      ?.handle

    webmcp.registerAgentPermission(() => {
      throw new Error('the host session store was unreachable')
    })

    // A host predicate that throws has not said yes, and "did not say yes" on a
    // write path reads as no. A throw let out of a handler reaches the agent as
    // a rejected call with no shape to it and nothing to retry against.
    const result = call('openleaf_replace_at', { id: 'post-body', handle, html: '<em>g</em>' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('refused')
    // And nothing of the host's internals travels back with it.
    expect(result.message).not.toContain('session store')
    expect(serializeHtml(view.state.doc)).toBe('<p>alpha beta</p>')
  })
})

/**
 * The policy is the integrator's, and it stays theirs.
 *
 * `registerAgentPermission` is a function on the page's own `OpenLeaf` global,
 * because a script-tag integrator has no other way to reach `allowTool`. That
 * makes it reachable by everything else on the page too, so it is set-once and
 * non-clearing -- the same way `installAgentTools` takes its options from the
 * first call and ignores the rest.
 */
describe('a policy that is already installed', () => {
  it('is not replaced by a second registration', () => {
    editor('post-body', '<p>alpha beta</p>')
    webmcp.registerAgentPermission(() => false)
    webmcp.registerAgentPermission(() => true)

    expect(call('openleaf_get_document', { id: 'post-body' }).error).toBe('refused')
  })

  it('is not cleared by a caller passing nothing', () => {
    editor('post-body', '<p>alpha beta</p>')
    webmcp.registerAgentPermission(() => false)
    // `null` was how a policy used to be cleared, and it is what an untyped
    // script tag would still reach for. It is now the no-op that leaves the
    // integrator's policy standing.
    ;(webmcp.registerAgentPermission as (allow: unknown) => void)(null)
    ;(webmcp.registerAgentPermission as (allow: unknown) => void)(undefined)

    expect(call('openleaf_get_document', { id: 'post-body' }).error).toBe('refused')
  })

  it('survives a later install that supplies its own predicate', () => {
    editor('post-body', '<p>alpha beta</p>')
    webmcp.registerAgentPermission(() => false)
    webmcp.installAgentTools({ allowTool: () => true })

    expect(call('openleaf_get_document', { id: 'post-body' }).error).toBe('refused')
  })
})

describe('supplying the predicate at install time', () => {
  it('takes it from the options, and keeps the first call’s', () => {
    webmcp.installAgentTools({ allowTool: () => false })
    webmcp.installAgentTools({ allowTool: () => true })

    const listing = webmcp.agentTools[0]!
    expect(JSON.parse(listing.execute({})) as ToolResult).toEqual({
      ok: false,
      error: 'refused',
      message: expect.stringContaining('openleaf_list_editors'),
    })
  })

  it('does not clear a predicate registered before it', () => {
    webmcp.registerAgentPermission(() => false)
    // A script tag installs on load, so an integrator's own
    // `installAgentTools()` is routinely the second call and routinely has no
    // options. Reading `allowTool` unconditionally would wipe the policy.
    webmcp.installAgentTools()

    const listing = webmcp.agentTools[0]!
    expect((JSON.parse(listing.execute({})) as ToolResult).error).toBe('refused')
  })
})
