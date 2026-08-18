/**
 * The toolbar item registry.
 *
 * The extension point exists now, before any plugin needs it, because
 * retrofitting one later means either a breaking change or a second parallel
 * mechanism. `@openleaf/plugins-table` will call `registerToolbarItem` at import
 * time and the toolbar will pick it up without ever importing the plugin.
 *
 * Two responsibilities are deliberately split:
 *
 *   A plugin declares CAPABILITY -- here is a button, here is what it does,
 *   here is when it is active.
 *   An integrator declares LAYOUT -- via the `toolbar` attribute, which names
 *   item ids and separators in the order they want them.
 *
 * So installing a plugin never silently rearranges somebody's toolbar, and an
 * integrator can omit a registered item without uninstalling anything.
 */

import type { Command, EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { IconName } from './icons.js'

/** What a custom `run` handler receives. */
export interface ToolbarContext {
  view: EditorView
  /** The `<openleaf-editor>` element, for dispatching events or hosting dialogs. */
  host: HTMLElement
}

export interface ToolbarItemSpec {
  /** Stable id used in the `toolbar` layout attribute. */
  id: string
  /**
   * What kind of control this is.
   *
   * Present from day one even though only `button` and `select` are
   * implemented. A flat spec models a button and nothing else, and adding this
   * discriminant *after* the config shape is public is precisely the breaking
   * change the registry exists to avoid. Colour grids, table-insert popovers
   * and link editors will all be `custom`.
   */
  type?: 'button' | 'select' | 'custom'
  /** Accessible name. Kept constant across states -- the platform announces pressed. */
  label: string
  icon?: IconName
  /**
   * `toggle` gets `aria-pressed` and reflects `isActive`. `action` does not:
   * marking Undo as "pressed" is meaningless and screen readers say so.
   */
  kind?: 'toggle' | 'action'
  /** A plain ProseMirror command. Its no-dispatch call also drives enabled state. */
  command?: Command
  /** For items needing more than the editor state -- dialogs, mode switches. */
  run?: (ctx: ToolbarContext) => void
  isActive?: (state: EditorState) => boolean
  /** Defaults to asking `command` whether it would apply. */
  isEnabled?: (state: EditorState) => boolean
  /** Label to look up in the core shortcut table, for the tooltip. */
  shortcut?: string
}

const registry = new Map<string, ToolbarItemSpec>()

/**
 * Registry change notifications.
 *
 * Import-time registration races code-split plugins: if a lazily loaded chunk
 * resolves after a toolbar has already read the registry and rendered, its
 * button would silently never appear. Toolbars subscribe and re-render instead
 * of reading once at mount.
 */
const listeners = new Set<() => void>()

export function onRegistryChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Register a toolbar item. Last registration for an id wins, which lets an
 * integrator replace a built-in (a different link dialog, say) without forking.
 */
export function registerToolbarItem(spec: ToolbarItemSpec): void {
  registry.set(spec.id, spec)
  notify()
}

export function getToolbarItem(id: string): ToolbarItemSpec | undefined {
  return registry.get(id)
}

export function allToolbarItems(): ToolbarItemSpec[] {
  return [...registry.values()]
}

/** Testing seam. Not part of the public API. */
export function clearToolbarItems(): void {
  registry.clear()
  notify()
}

/**
 * The default layout. `|` is a separator.
 *
 * Order reasoning: history sits leftmost because it is the control an author
 * reaches for under stress and muscle memory puts it at the start of the bar in
 * every office application. Block type comes next because choosing what a
 * paragraph *is* precedes decorating it. Then character marks, then block
 * structure, then insertions, and finally source view -- the one control that
 * changes the editor's mode rather than the document, kept away from the rest
 * so it is not hit by accident.
 */
export const DEFAULT_LAYOUT =
  'undo redo | blockType | bold italic underline strikethrough code | ' +
  'bulletList orderedList blockquote codeBlock | link unlink image horizontalRule | source'
