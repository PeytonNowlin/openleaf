/**
 * The toolbar.
 *
 * A plain class rather than a custom element: the editor is already a custom
 * element, buttons are just DOM, and per-button custom elements would cost
 * bundle size and upgrade-timing complexity for no benefit.
 *
 * ## Keyboard model
 *
 * `role="toolbar"` with a roving tabindex, so the whole bar is ONE tab stop.
 * Without that, Tab from the editable region walks a keyboard user through
 * twenty buttons before they reach their content.
 *
 * Two details that are easy to get wrong and both matter:
 *
 * 1. **Arrow-key roving is applied only to `<button>` elements.** The block-type
 *    control is a native `<select>`, and when focus is on it, Left/Right have two
 *    competing owners -- the roving handler wants to move to the next item, the
 *    select natively wants to change its value. Intercepting those keys breaks
 *    the select; not intercepting them breaks the toolbar contract. The
 *    resolution is that the select owns all of its own key events and is a
 *    genuine second tab stop rather than part of the roving scheme.
 *
 * 2. **Escape returns focus and the selection to the content.** Preventing mouse
 *    clicks from stealing focus solves the mouse case and leaves the keyboard
 *    case undefined: once a screen reader user deliberately enters the toolbar,
 *    focus really is on a button, and without a return path their only way out
 *    is blind-Tabbing through the rest of the host's form. `Alt+F10` enters,
 *    Escape leaves, matching TinyMCE and CKEditor 5 so muscle memory transfers.
 */

import { shortcutFor, type FormatSpec } from '@openleaf-editor/core'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ensureSprite, iconElement } from './icons.js'
import { t, onLocaleChange, withLocale } from './i18n.js'
import { announce, liveRegion } from './live.js'
import { ToolbarOverflow } from './overflow.js'
import {
  DEFAULT_LAYOUT,
  getToolbarItem,
  onRegistryChange,
  type ToolbarControl,
  type ToolbarItemSpec,
} from './registry.js'
import { ensureStyles } from './styles.js'

export interface ToolbarOptions {
  /** Accessible name for the toolbar landmark. */
  label?: string
  /** Space-separated item ids, `|` for a separator. */
  layout?: string
  /**
   * Collapse groups that do not fit into a More menu. Off by default: wrapping
   * keeps every control visible, which is the safer accessibility default.
   */
  overflow?: boolean
  /** Extra block formats, typically classes from the host's content CSS. */
  formats?: readonly FormatSpec[]
  /**
   * Language for this toolbar's labels, independent of every other editor's.
   * Absent means the document-wide locale.
   */
  locale?: string | null
}

interface Control {
  spec: ToolbarItemSpec
  el: HTMLButtonElement
  /** Last rendered state, so the DOM is touched only on a real change. */
  active: boolean | null
  enabled: boolean | null
  /** Set by setItemState; overrides the predicate result when present. */
  forcedActive?: boolean
  forcedEnabled?: boolean
}

/** A `custom` item's control, and the id it was built for. */
interface MountedControl {
  id: string
  control: ToolbarControl
}

/** Item+callback pairs already reported, so a per-keystroke failure logs once. */
const reported = new Set<string>()

/**
 * Call a third-party predicate, falling back rather than propagating.
 *
 * The fallback for BOTH `isActive` and `isEnabled` is `false`. Defaulting
 * `isEnabled` to true would invite a click straight into the code path that just
 * threw; a control whose enablement cannot be computed should read as
 * unavailable, which is the same reasoning the table plugin already applies to
 * commands that are meaningless outside a table.
 *
 * Logged once per item and callback. A predicate that throws on every
 * transaction would otherwise emit thousands of identical lines and bury the
 * first one, which is the only one with a useful stack.
 */
function guarded(itemId: string, kind: string, run: () => boolean): boolean {
  try {
    return run()
  } catch (error) {
    const key = `${itemId}:${kind}`
    if (!reported.has(key)) {
      reported.add(key)
      console.error(
        `@openleaf-editor/ui: the ${kind} predicate for toolbar item "${itemId}" threw. ` +
          'The control is shown as unavailable. This is a bug in whatever registered ' +
          'it, not in the editor.',
        error,
      )
    }
    return false
  }
}

export class Toolbar {
  readonly el: HTMLDivElement

  #doc: Document
  #host: HTMLElement
  #view: EditorView | null = null
  #controls = new Map<string, Control>()
  #customs: MountedControl[] = []
  /** Native selects keyed by item id (block type plus any `type: 'select'`). */
  #selects = new Map<string, HTMLSelectElement>()
  #layout: string
  #label: string
  #formats: readonly FormatSpec[]
  #locale: string | null
  #wantsOverflow: boolean
  #overflow: ToolbarOverflow | null = null
  #unsubscribe: (() => void) | undefined
  #unlocale: (() => void) | undefined
  /** Focusable buttons in DOM order; the roving tabindex walks this. */
  #focusables: HTMLButtonElement[] = []
  #rovingIndex = 0

  constructor(host: HTMLElement, doc: Document, options: ToolbarOptions = {}) {
    this.#host = host
    this.#doc = doc
    this.#layout = options.layout ?? DEFAULT_LAYOUT
    this.#label = options.label ?? 'Formatting'
    this.#formats = options.formats ?? []
    this.#locale = options.locale ?? null
    this.#wantsOverflow = options.overflow === true

    ensureStyles(doc)
    ensureSprite(doc)

    this.el = doc.createElement('div')
    this.el.className = 'ol-toolbar'
    this.el.setAttribute('role', 'toolbar')
    this.el.setAttribute('aria-label', t(this.#label))

    // Mounted on the HOST, and mounted now rather than on the first
    // announcement: a region a screen reader has never seen may not be observed
    // in time to read the text that appears in it. Shared with every other bar
    // on this editor, so a secondary or floating toolbar is never the one that
    // speaks into a detached node.
    liveRegion(host)

    this.el.addEventListener('keydown', this.#onKeydown)
    // Re-render when a plugin registers late. Import-time registration races
    // code-split chunks, and a button that silently never appears is worse than
    // a re-render.
    this.#unsubscribe = onRegistryChange(() => {
      this.#rerenderPreservingState()
    })
    this.#unlocale = onLocaleChange(() => {
      this.#rerenderPreservingState()
    })
  }

  /**
   * Change this toolbar's language and rebuild its labels.
   *
   * Per toolbar rather than per document, so one editor switching language does
   * not relabel every other editor on the page.
   */
  setLocale(next: string | null): void {
    const value = next ?? null
    if (value === this.#locale) return
    this.#locale = value
    if (this.#view) this.#rerenderPreservingState()
  }

  /** Attach to a view and build the controls. */
  mount(view: EditorView): void {
    this.#view = view
    this.#render()
    if (this.#wantsOverflow && !this.#overflow) {
      this.#overflow = new ToolbarOverflow(this.el, this.#host, this.#doc)
    }
    this.update(view.state)
  }

  destroy(): void {
    this.#unsubscribe?.()
    this.#unlocale?.()
    this.#overflow?.destroy()
    this.el.removeEventListener('keydown', this.#onKeydown)
    this.#destroyCustoms()
    this.#controls.clear()
    this.#view = null
  }

  /**
   * Tear down `custom` controls.
   *
   * Called on destroy AND before every re-render. A custom control may have put
   * a popover in the top layer, which is outside this element and therefore
   * survives `replaceChildren` -- so without this, a registry change while a
   * colour picker is open leaves an orphaned popover on the page with no trigger
   * attached to it.
   */
  #destroyCustoms(): void {
    for (const { id, control } of this.#customs) {
      try {
        control.destroy?.()
      } catch (error) {
        console.error(`@openleaf-editor/ui: toolbar item "${id}" threw while being destroyed`, error)
      }
    }
    this.#customs = []
  }

  /**
   * The editor's live region.
   *
   * One per host, shared by every bar on it, and already mounted -- so a host
   * that appends this is moving a node it already owns rather than adopting a
   * detached one. Kept on the class because integrations reach for it.
   */
  get liveRegion(): HTMLDivElement {
    return liveRegion(this.#host)
  }

  /* -------------------------------------------------------------- *
   * Rendering
   * -------------------------------------------------------------- */

  /**
   * Labels are produced inside this toolbar's own locale scope, so two editors
   * with different `lang` values on one page do not overwrite each other.
   */
  #render(): void {
    withLocale(this.#locale, () => this.#renderScoped())
  }

  #renderScoped(): void {
    this.#destroyCustoms()
    this.el.replaceChildren()
    this.#controls.clear()
    this.#selects.clear()

    let group = this.#newGroup()

    for (const token of this.#layout.split(/\s+/).filter(Boolean)) {
      if (token === '|') {
        if (group.childElementCount > 0) this.el.appendChild(group)
        this.el.appendChild(this.#newSeparator())
        group = this.#newGroup()
        continue
      }

      const spec = getToolbarItem(token)
      // Silently skipping an unknown id would hide a typo in an integrator's
      // `toolbar` attribute forever.
      if (!spec) {
        console.warn(`@openleaf-editor/ui: no toolbar item registered for "${token}"`)
        continue
      }
      if (spec.type === 'custom') {
        const el = this.#buildCustom(spec)
        if (el) group.appendChild(el)
        continue
      }
      if (spec.type === 'select') {
        const el = this.#buildSelect(spec)
        if (el) group.appendChild(el)
        continue
      }
      if (spec.type && spec.type !== 'button') {
        console.warn(
          `@openleaf-editor/ui: toolbar item "${spec.id}" declares type "${spec.type}", ` +
            'which is not implemented yet. It is rendering as a button.',
        )
      }
      group.appendChild(this.#buildButton(spec))
    }

    if (group.childElementCount > 0) this.el.appendChild(group)

    this.el.setAttribute('aria-label', t(this.#label))
    this.#refreshFocusables()
    this.#overflow?.reattach()
  }

  /**
   * Rebuild after a registry change without dropping host-pushed state.
   *
   * Source view's pressed state lives on the control via `setItemState`, not in
   * the document. Replacing every button would flash it off, and would yank
   * focus out of a control the author was on.
   */
  #rerenderPreservingState(): void {
    const forced = new Map<string, { active?: boolean; enabled?: boolean }>()
    for (const [id, control] of this.#controls) {
      const next: { active?: boolean; enabled?: boolean } = {}
      if (control.forcedActive !== undefined) next.active = control.forcedActive
      if (control.forcedEnabled !== undefined) next.enabled = control.forcedEnabled
      if (next.active !== undefined || next.enabled !== undefined) forced.set(id, next)
    }

    const active = this.#doc.activeElement
    const focusedId =
      active instanceof HTMLElement && this.el.contains(active)
        ? (active.dataset['olId'] ?? null)
        : null

    this.#render()
    for (const [id, state] of forced) this.setItemState(id, state)
    if (this.#view) this.update(this.#view.state)

    if (!focusedId) return
    const select = this.#selects.get(focusedId)
    if (select) {
      select.focus()
      return
    }
    const control = this.#controls.get(focusedId)
    if (control) {
      const index = this.#focusables.indexOf(control.el)
      if (index >= 0) {
        this.#rovingIndex = index
        this.#applyRoving()
      }
      control.el.focus()
      return
    }
    this.#customs.find(({ id }) => id === focusedId)?.control.focusable?.focus()
  }

  #newGroup(): HTMLDivElement {
    const group = this.#doc.createElement('div')
    group.className = 'ol-group'
    return group
  }

  #newSeparator(): HTMLDivElement {
    const sep = this.#doc.createElement('div')
    sep.className = 'ol-sep'
    // Decorative. A separator announced as "separator" twenty times is noise.
    sep.setAttribute('aria-hidden', 'true')
    return sep
  }

  #buildButton(spec: ToolbarItemSpec): HTMLButtonElement {
    const button = this.#doc.createElement('button')
    button.type = 'button'
    button.className = 'ol-btn'
    button.dataset['olId'] = spec.id

    // The accessible name stays constant across states. Baking "pressed" into
    // it would double up with what the platform already announces.
    button.setAttribute('aria-label', t(spec.label))

    const shortcut = spec.shortcut ? shortcutFor(spec.shortcut) : null
    const label = t(spec.label)
    button.title = shortcut ? `${label} (${shortcut})` : label

    if ((spec.kind ?? 'action') === 'toggle') {
      button.setAttribute('aria-pressed', 'false')
    }

    if (spec.icon) button.appendChild(iconElement(spec.icon, this.#doc))

    // Keep focus and the selection in the content. Without this the editor
    // blurs on mousedown, the selection collapses, and the command applies to
    // nothing.
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => this.#invoke(spec))

    this.#controls.set(spec.id, { spec, el: button, active: null, enabled: null })
    return button
  }

  /**
   * Build a `custom` control.
   *
   * Everything the item does is third-party code running inside the editor's
   * render path, so a throw here must cost that one control and nothing else: a
   * colour picker that fails to build must not take the rest of the toolbar --
   * and with it Bold, Undo and Save -- down with it.
   */
  #buildCustom(spec: ToolbarItemSpec): HTMLElement | null {
    const view = this.#view
    if (!spec.render) {
      console.warn(
        `@openleaf-editor/ui: toolbar item "${spec.id}" declares type "custom" but has no ` +
          'render function, so there is nothing to build.',
      )
      return null
    }
    // No view yet means this is a pre-mount re-render triggered by a late
    // registration. mount() renders again with a view, so the control appears
    // then rather than being built against nothing.
    if (!view) return null

    try {
      const control = spec.render({ view, host: this.#host, formats: this.#formats })
      this.#customs.push({ id: spec.id, control })
      return control.el
    } catch (error) {
      console.error(
        `@openleaf-editor/ui: toolbar item "${spec.id}" threw while rendering. ` +
          'It has been left out; the rest of the toolbar is unaffected.',
        error,
      )
      return null
    }
  }

  /**
   * Build a `type: 'select'` control from the item's options.
   *
   * Same keyboard contract as the block-type select: it is a second tab stop,
   * owns its own arrow keys, and only returns focus to the content when the
   * author commits by pointer.
   */
  #buildSelect(spec: ToolbarItemSpec): HTMLSelectElement | null {
    if (!spec.options || !spec.getValue || !spec.applyValue) {
      console.warn(
        `@openleaf-editor/ui: toolbar item "${spec.id}" declares type "select" but is ` +
          'missing options, getValue, or applyValue, so there is nothing to build.',
      )
      return null
    }

    const select = this.#doc.createElement('select')
    select.className = spec.selectMod ? `ol-select ol-select--${spec.selectMod}` : 'ol-select'
    select.setAttribute('aria-label', t(spec.label))
    select.dataset['olId'] = spec.id
    select.title = t(spec.label)

    for (const choice of spec.options) {
      const option = this.#doc.createElement('option')
      option.value = choice.value
      option.textContent = t(choice.label)
      select.appendChild(option)
    }

    this.#wireSelectInteraction(select, () => {
      const view = this.#view
      if (!view || !spec.applyValue) return
      const command = spec.applyValue(select.value)
      command(view.state, view.dispatch, view)
    })

    this.#selects.set(spec.id, select)
    return select
  }

  /**
   * Shared select wiring: keep pointer vs keyboard focus behaviour identical
   * across every native list in the bar.
   */
  #wireSelectInteraction(select: HTMLSelectElement, apply: () => void): void {
    select.addEventListener('mousedown', (event) => event.stopPropagation())

    /**
     * Whether the pending change came from a pointer rather than the keyboard.
     *
     * This distinction is load-bearing. In Firefox, and on macOS generally,
     * arrow keys on a closed `<select>` change its value on every press. If the
     * change handler returned focus to the content unconditionally, a keyboard
     * user arrowing through the options would be thrown back into the document
     * on the first press -- making the control unusable by keyboard while
     * working perfectly with a mouse. Caught by a cross-browser test that
     * passed in Chromium and failed in Firefox.
     */
    let pointerDriven = false
    select.addEventListener('pointerdown', () => {
      pointerDriven = true
    })

    select.addEventListener('keydown', (event) => {
      pointerDriven = false
      if (event.key === 'Enter') {
        // A <select> inside a <form> submits it on Enter. The editor almost
        // always sits inside the host's form, so this would post a half-written
        // article.
        event.preventDefault()
        this.returnFocusToContent()
      }
    })

    select.addEventListener('change', () => {
      const view = this.#view
      if (!view) return
      if (this.#host.hasAttribute('readonly')) return
      apply()
      // Return the caret to the content only when the author committed the
      // choice by pointer. Keyboard users keep focus and leave with Tab or
      // Escape.
      if (pointerDriven) {
        pointerDriven = false
        view.focus()
      }
    })
  }

  /* -------------------------------------------------------------- *
   * Invocation
   * -------------------------------------------------------------- */

  #invoke(spec: ToolbarItemSpec): void {
    const view = this.#view
    if (!view) return
    if (this.#host.hasAttribute('readonly')) return

    const control = this.#controls.get(spec.id)
    if (control && control.enabled === false) return

    try {
      if (spec.run) {
        spec.run({ view, host: this.#host, formats: this.#formats })
        return
      }
      if (spec.command) {
        spec.command(view.state, view.dispatch, view)
        view.focus()
      }
    } catch (error) {
      console.error(
        `@openleaf-editor/ui: toolbar item "${spec.id}" threw when activated. ` +
          'The editor is unaffected.',
        error,
      )
    }
  }

  /* -------------------------------------------------------------- *
   * State synchronisation
   * -------------------------------------------------------------- */

  /**
   * Reflect the editor state onto the controls.
   *
   * Deliberately synchronous, not batched into an animation frame. Twenty cheap
   * predicates plus a diffed attribute write is sub-millisecond work, and
   * batching would trade a perceptible frame of lag between pressing Bold and
   * the button lighting up for a performance problem that does not exist.
   *
   * `tr` is passed so announcements can be gated on a real formatting change.
   */
  update(state: EditorState, tr?: Transaction): void {
    withLocale(this.#locale, () => this.#updateScoped(state, tr))
  }

  #updateScoped(state: EditorState, tr?: Transaction): void {
    // Announce only on a discrete formatting transition, never on cursor
    // movement through already-formatted text. That gate is the whole
    // difference between a useful announcement and a chatty one.
    const isFormattingChange = !!tr && (tr.docChanged || tr.storedMarksSet)
    const transitions: string[] = []

    for (const control of this.#controls.values()) {
      const { spec } = control

      const readonly = this.#host.hasAttribute('readonly')
      const enabled =
        readonly
          ? false
          : control.forcedEnabled ??
            guarded(spec.id, 'isEnabled', () =>
              spec.isEnabled ? spec.isEnabled(state) : spec.command ? spec.command(state) : true,
            )

      if (enabled !== control.enabled) {
        control.enabled = enabled
        // aria-disabled, never the disabled attribute: a disabled button is
        // removed from the roving tabindex and cannot be reached or announced,
        // so an author using a screen reader cannot discover it exists.
        control.el.setAttribute('aria-disabled', enabled ? 'false' : 'true')
      }

      if ((spec.kind ?? 'action') === 'toggle') {
        const active =
          control.forcedActive ??
          guarded(spec.id, 'isActive', () => (spec.isActive ? spec.isActive(state) : false))
        if (active !== control.active) {
          const previous = control.active
          control.active = active
          control.el.setAttribute('aria-pressed', active ? 'true' : 'false')
          if (isFormattingChange && previous !== null) {
            // One template key per state rather than a label glued to a bare
            // "on"/"off". The old form pushed the RAW LOOKUP KEY, so a French
            // editor showed "Gras" and announced "Bold on" -- and the two state
            // words had no translation path at all. A template also keeps word
            // order translatable, which a concatenation never can.
            transitions.push(
              t(active ? '{label} on' : '{label} off').replace('{label}', t(spec.label)),
            )
          }
        }
      }
    }

    for (const { id, control } of this.#customs) {
      // Readonly is the toolbar's business, not each control's: reflecting it
      // here means a custom control gets the same disabled treatment as a button
      // without every plugin author having to remember the attribute exists.
      const trigger = control.el.querySelector<HTMLButtonElement>('button.ol-btn')
      trigger?.setAttribute('aria-disabled', this.#host.hasAttribute('readonly') ? 'true' : 'false')
      if (!control.update) continue
      guarded(id, 'update', () => {
        control.update?.(state)
        return true
      })
    }

    if (this.#selects.size > 0) {
      const readonly = this.#host.hasAttribute('readonly')
      // Only declared `type: 'select'` items live here. Block type is a rendered
      // control and keeps its own state in sync through its ToolbarControl.
      for (const [id, select] of this.#selects) {
        this.#syncRegisteredSelect(id, select, state, readonly)
      }
    }

    if (transitions.length > 0) this.#announce(transitions.join(', '))
  }

  #syncRegisteredSelect(
    id: string,
    select: HTMLSelectElement,
    state: EditorState,
    readonly: boolean,
  ): void {
    const spec = getToolbarItem(id)
    if (!spec?.getValue) {
      select.disabled = readonly
      return
    }

    let value = ''
    try {
      value = spec.getValue(state)
    } catch (error) {
      const key = `${id}:getValue`
      if (!reported.has(key)) {
        reported.add(key)
        console.error(
          `@openleaf-editor/ui: the getValue callback for toolbar item "${id}" threw. ` +
            'The control is shown as Default. This is a bug in whatever registered it, ' +
            'not in the editor.',
          error,
        )
      }
      value = ''
    }

    // Inherited sizes/families that are not in the preset list still need a
    // visible option, or the select snaps to Default and looks cleared.
    if (value !== '' && ![...select.options].some((option) => option.value === value)) {
      const option = this.#doc.createElement('option')
      option.value = value
      option.textContent = value
      select.appendChild(option)
    }

    if (select.value !== value) select.value = value

    const enabled = spec.isEnabled
      ? guarded(id, 'isEnabled', () => spec.isEnabled!(state))
      : true
    select.disabled = readonly || !enabled
  }

  /**
   * Push a state a predicate cannot derive.
   *
   * `isActive`/`isEnabled` assume everything follows from the document and
   * selection. Real plugin state does not: "upload in progress", "collab lock
   * held by another user", "rewrite running" all live outside the document, and
   * a pull-on-transaction model cannot see them.
   */
  setItemState(id: string, state: { active?: boolean; enabled?: boolean }): void {
    const control = this.#controls.get(id)
    if (!control) return
    if (state.active !== undefined) {
      control.forcedActive = state.active
      control.active = null
    }
    if (state.enabled !== undefined) {
      control.forcedEnabled = state.enabled
      control.enabled = null
    }
    if (this.#view) this.update(this.#view.state)
  }

  #announce(message: string): void {
    announce(this.#host, message)
  }

  /* -------------------------------------------------------------- *
   * Roving tabindex
   * -------------------------------------------------------------- */

  #refreshFocusables(): void {
    this.#focusables = [...this.el.querySelectorAll<HTMLButtonElement>('button.ol-btn')]
    this.#rovingIndex = 0
    this.#applyRoving()
  }

  #applyRoving(): void {
    this.#focusables.forEach((button, index) => {
      button.tabIndex = index === this.#rovingIndex ? 0 : -1
    })
  }

  #moveRoving(delta: number): void {
    if (this.#focusables.length === 0) return
    const count = this.#focusables.length
    this.#rovingIndex = (this.#rovingIndex + delta + count) % count
    this.#applyRoving()
    this.#focusables[this.#rovingIndex]?.focus()
  }

  #setRoving(index: number): void {
    if (this.#focusables.length === 0) return
    this.#rovingIndex = Math.max(0, Math.min(index, this.#focusables.length - 1))
    this.#applyRoving()
    this.#focusables[this.#rovingIndex]?.focus()
  }

  #onKeydown = (event: KeyboardEvent): void => {
    // Escape works from anywhere in the toolbar, including from the select.
    if (event.key === 'Escape') {
      event.preventDefault()
      this.returnFocusToContent()
      return
    }

    const target = event.target as HTMLElement | null

    // Arrow roving applies ONLY to buttons. The native <select> owns its own
    // key handling; hijacking Left/Right there would break value changing.
    if (!target || target.tagName !== 'BUTTON') return

    const index = this.#focusables.indexOf(target as HTMLButtonElement)
    if (index >= 0) this.#rovingIndex = index

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        this.#moveRoving(1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        this.#moveRoving(-1)
        break
      case 'Home':
        event.preventDefault()
        this.#setRoving(0)
        break
      case 'End':
        event.preventDefault()
        this.#setRoving(this.#focusables.length - 1)
        break
      default:
        break
    }
  }

  /** Move focus into the toolbar. Bound to Alt+F10 by the host. */
  focusToolbar(): void {
    if (this.#focusables.length > 0) {
      this.#applyRoving()
      this.#focusables[this.#rovingIndex]?.focus()
      return
    }
    // A toolbar of only selects or custom controls has no roving buttons. The
    // shortcut is still documented; swallowing it with nowhere to go would make
    // a valid `toolbar` attribute a silent no-op.
    const declared = this.#selects.values().next().value
    if (declared) {
      declared.focus()
      return
    }
    this.#customs.find(({ control }) => control.focusable)?.control.focusable?.focus()
  }

  /** Return focus and the prior selection to the editable region. */
  returnFocusToContent(): void {
    this.#view?.focus()
  }
}
