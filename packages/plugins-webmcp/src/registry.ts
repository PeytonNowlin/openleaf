/**
 * The page-global register of live editors.
 *
 * Registration with the browser is page-global and happens once, and that is
 * forced rather than chosen: a second `registerTool` under a name already taken
 * rejects with `InvalidStateError: Duplicate tool name`, so a tool set per
 * editor would fail on the second editor -- and a page with several editors is
 * the normal case here, not the edge case. So one tool set for the document,
 * and this register, which each editor adds itself to through the editor
 * plugin's per-view lifecycle and removes itself from on teardown.
 *
 * Everything here is held per host element rather than in the plugin view's
 * closure. Registering any other opt-in plugin reconfigures the editor state,
 * and ProseMirror destroys and recreates every plugin view when it does; an
 * identifier that lived in the closure would be reassigned on the way back up,
 * so an identifier an agent was handed one call ago would name nothing.
 */

import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/** The `<openleaf-editor>` element, in the shape a tool needs it. */
export interface EditorHost extends HTMLElement {
  value: string
  view: EditorView | null
}

export interface RegisteredEditor {
  /** The identifier an agent is handed and passes back. */
  id: string
  host: EditorHost
  view: EditorView
}

/**
 * Insertion-ordered, which is document order: custom elements upgrade in
 * document order, so the listing an agent reads matches the page it is looking
 * at. A late-mounted editor joins at the end, where it belongs.
 */
const editors = new Map<EditorHost, RegisteredEditor>()

/** Identifiers, held across the reconfigure teardown described above. */
const identifiers = new WeakMap<EditorHost, string>()

/** Never reused, so a removed editor's name cannot be handed to a new one. */
let registered = 0

function editorHost(from: HTMLElement): EditorHost | null {
  return from.closest('openleaf-editor') as EditorHost | null
}

/** Whether a live editor already answers to this name. */
function taken(id: string): boolean {
  for (const editor of editors.values()) if (editor.id === id) return true
  return false
}

/**
 * `editor-<n>`, walked forward until it names nothing on the page yet.
 *
 * The generated name shares one namespace with the integrator's own `id`, and
 * `editor-2` is a name an integrator really writes -- the README documents that
 * exact spelling as what the fallback produces. So on a page whose first editor
 * is `id="editor-2"`, the second editor, which has no id and is the second on
 * the page, was handed `editor-2` as well. Both then answered to it,
 * `openleaf_list_editors` returned the name twice, and every later call
 * resolved to whichever the register found first: an agent replacing text in
 * one editor rewrote the other, and was told `{"ok":true}`.
 *
 * Walking rather than suffixing keeps the names in one shape. The count is
 * shared with the ordinal, so a name skipped here is never handed out later.
 */
function unclaimed(ordinal: number): string {
  let candidate = `editor-${ordinal}`
  while (taken(candidate)) candidate = `editor-${++registered}`
  return candidate
}

/**
 * The identifier for a host: its `id` attribute, or an ordinal.
 *
 * Integrators already give these elements ids to bind them to a textarea, so in
 * practice the identifier is one the integrator recognizes and can act on.
 *
 * Neither path hands out a name that is already live. An `id` claimed by
 * another editor falls back to the ordinal, and the ordinal itself is walked
 * past anything an `id` has already taken. Duplicate ids are invalid HTML and
 * the browser does not enforce it; two editors answering to one name would send
 * an agent's writes to whichever the register happened to find first.
 */
function identify(host: EditorHost): string {
  const held = identifiers.get(host)
  if (held) return held

  // Counted for every editor, not only for the ones that need the fallback, so
  // `editor-2` is the second editor on the page rather than the second one that
  // happened to be missing an id.
  const ordinal = ++registered
  const attr = host.id.trim()
  const id = attr !== '' && !taken(attr) ? attr : unclaimed(ordinal)
  identifiers.set(host, id)
  return id
}

/**
 * The per-editor half of the feature: it contributes no behaviour, no
 * decorations and no keybindings, only presence in the register.
 */
export function agentRegistry(): Plugin {
  return new Plugin({
    view(view) {
      const host = editorHost(view.dom)
      if (!host) return {}
      const entry: RegisteredEditor = { id: identify(host), host, view }
      editors.set(host, entry)
      return {
        destroy: () => {
          // Only if this view is still the registered one. A reconfigure that
          // creates the replacement before destroying the departing view would
          // otherwise delete the entry that just replaced this one.
          if (editors.get(host) === entry) editors.delete(host)
        },
      }
    },
  })
}

/** Every editor currently on the page, in document order. */
export function listEditors(): RegisteredEditor[] {
  return [...editors.values()]
}

/**
 * The editor an agent named, or nothing.
 *
 * A linear scan over a handful of editors: a page with enough of them for an
 * index to matter does not exist, and an index would be a second thing to keep
 * in step with the register on every mount and teardown.
 *
 * A miss is never resolved to "the first editor". An agent that was handed a
 * stale identifier and silently got somebody else's document would write into
 * it, so the tools answer a miss with a failure that says to list again.
 */
export function findEditor(id: string): RegisteredEditor | null {
  for (const editor of editors.values()) if (editor.id === id) return editor
  return null
}
