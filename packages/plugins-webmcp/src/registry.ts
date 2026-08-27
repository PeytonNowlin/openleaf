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

/**
 * The identifier for a host: its `id` attribute, or an ordinal.
 *
 * Integrators already give these elements ids to bind them to a textarea, so in
 * practice the identifier is one the integrator recognizes and can act on.
 *
 * An `id` already claimed by another live editor falls back to the ordinal
 * rather than being handed out twice. Duplicate ids are invalid HTML and the
 * browser does not enforce it; two editors answering to one name would send an
 * agent's writes to whichever the register happened to find first.
 */
function identify(host: EditorHost): string {
  const held = identifiers.get(host)
  if (held) return held

  // Counted for every editor, not only for the ones that need the fallback, so
  // `editor-2` is the second editor on the page rather than the second one that
  // happened to be missing an id.
  const ordinal = ++registered
  const attr = host.id.trim()
  const claimed = attr !== '' && [...editors.values()].some((editor) => editor.id === attr)
  const id = attr !== '' && !claimed ? attr : `editor-${ordinal}`
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
