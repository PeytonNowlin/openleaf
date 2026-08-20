/**
 * The toolbar item registry.
 *
 * The extension point exists now, before any plugin needs it, because
 * retrofitting one later means either a breaking change or a second parallel
 * mechanism. `@openleaf-editor/plugins-table` will call `registerToolbarItem` at import
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

/**
 * A control a `custom` item builds for itself.
 *
 * The contract is narrow on purpose. A custom item owns its own markup, so it
 * can be a colour grid or a table-size picker, but it does not get to own the
 * toolbar's keyboard model: the element it returns must contain exactly one
 * focusable `button.ol-btn`, because that is what the roving tabindex walks. A
 * control with two focusable buttons in the bar would make the toolbar two tab
 * stops where the author expects one; a control with none would be unreachable
 * by keyboard. Anything else the control needs -- a popover, a grid of swatches
 * -- belongs outside the toolbar element, in the top layer or on the host.
 */
export interface ToolbarControl {
  /** The element placed in the toolbar. */
  el: HTMLElement
  /**
   * Reflect the editor state. Called on every transaction, so it must be cheap
   * and must not throw; a throw is caught and logged once, like a predicate.
   */
  update?: (state: EditorState) => void
  /** Release listeners, and remove anything the control put in the document. */
  destroy?: () => void
}

/** One choice in a `type: 'select'` toolbar item. */
export interface ToolbarSelectOption {
  value: string
  label: string
}

export interface ToolbarItemSpec {
  /** Stable id used in the `toolbar` layout attribute. */
  id: string
  /**
   * What kind of control this is.
   *
   * `button` is the common case. `custom` hands the item a chance to build its
   * own DOM through `render`, which is how the colour picker exists at all: a
   * swatch grid is not a button, and modelling it as one would have meant
   * special-casing it in the toolbar by id.
   *
   * `select` builds a native `<select>` from `options` / `getValue` /
   * `applyValue`. The block-type control stays special-cased by id because it
   * owns formats the host injects at mount time; everything else that is a
   * preset list (font family, size, line height) uses this type.
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
  /**
   * For `type: 'custom'`: build the control. Required for that type, ignored
   * otherwise.
   */
  render?: (ctx: ToolbarContext) => ToolbarControl
  /**
   * For `type: 'select'`: the choices shown. Required for that type. An empty
   * `value` is the "Default" / clear option.
   */
  options?: readonly ToolbarSelectOption[]
  /**
   * For `type: 'select'`: the value that matches the selection. Empty string
   * means no explicit formatting (the Default option).
   */
  getValue?: (state: EditorState) => string
  /**
   * For `type: 'select'`: turn a chosen value into a command. Empty string
   * clears.
   */
  applyValue?: (value: string) => Command
  /**
   * Optional CSS modifier for a select (e.g. `wide` for long font names).
   * Becomes `ol-select--{mod}` on the element.
   */
  selectMod?: string
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
  // Isolated per listener: one toolbar failing to re-render must not stop the
  // others, and must not propagate into the plugin that registered the item.
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('@openleaf-editor/ui: a toolbar failed to re-render', error)
    }
  }
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
 * paragraph *is* precedes decorating it. Font family, size and line height sit
 * beside it as the next layer of look. Then character marks, alignment, indent,
 * lists, insertions, and finally source view -- the one control that changes
 * the editor's mode rather than the document, kept away from the rest so it is
 * not hit by accident.
 */
export const DEFAULT_LAYOUT =
  'undo redo | blockType | fontFamily fontSize lineHeight | bold italic underline strikethrough code | ' +
  'alignLeft alignCenter alignRight alignJustify | ' +
  'indent outdent | bulletList orderedList blockquote codeBlock | link unlink image horizontalRule | source'

/**
 * The default layout with the colour controls in it.
 *
 * Not the default, and deliberately not: the colour picker ships in an opt-in
 * bundle, and naming an item that is not registered logs a warning for every
 * deployment that did not load it. An integrator who loads the colour bundle
 * either uses this layout or names `textColour` and `highlightColour` in their own.
 *
 * The colour bundle does NOT rewrite the default layout on install. Installing a
 * plugin must not silently rearrange somebody's toolbar -- that is the whole
 * reason capability and layout are separate concerns here.
 */
export const LAYOUT_WITH_COLOUR = DEFAULT_LAYOUT.replace(
  'alignLeft',
  'textColour highlightColour | alignLeft',
)
