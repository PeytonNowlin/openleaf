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

import { activeHeadingLevel, shortcutFor, toggleHeading, setParagraph } from '@openleaf/core'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ensureSprite, iconElement } from './icons.js'
import {
  DEFAULT_LAYOUT,
  getToolbarItem,
  onRegistryChange,
  type ToolbarItemSpec,
} from './registry.js'
import { ensureStyles } from './styles.js'

export interface ToolbarOptions {
  /** Accessible name for the toolbar landmark. */
  label?: string
  /** Space-separated item ids, `|` for a separator. */
  layout?: string
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

const BLOCK_TYPE_ID = 'blockType'

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
        `@openleaf/ui: the ${kind} predicate for toolbar item "${itemId}" threw. ` +
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
  #select: HTMLSelectElement | null = null
  #live: HTMLDivElement
  #liveTimer: ReturnType<typeof setTimeout> | undefined
  #layout: string
  #unsubscribe: (() => void) | undefined
  /** Focusable buttons in DOM order; the roving tabindex walks this. */
  #focusables: HTMLButtonElement[] = []
  #rovingIndex = 0

  constructor(host: HTMLElement, doc: Document, options: ToolbarOptions = {}) {
    this.#host = host
    this.#doc = doc
    this.#layout = options.layout ?? DEFAULT_LAYOUT

    ensureStyles(doc)
    ensureSprite(doc)

    this.el = doc.createElement('div')
    this.el.className = 'ol-toolbar'
    this.el.setAttribute('role', 'toolbar')
    this.el.setAttribute('aria-label', options.label ?? 'Formatting')

    this.#live = doc.createElement('div')
    this.#live.className = 'ol-live'
    // Polite and atomic: an assertive region would interrupt the author
    // mid-word, and a non-atomic one can read partial updates.
    this.#live.setAttribute('role', 'status')
    this.#live.setAttribute('aria-live', 'polite')
    this.#live.setAttribute('aria-atomic', 'true')

    this.el.addEventListener('keydown', this.#onKeydown)
    // Re-render when a plugin registers late. Import-time registration races
    // code-split chunks, and a button that silently never appears is worse than
    // a re-render.
    this.#unsubscribe = onRegistryChange(() => {
      this.#render()
      // A fresh render leaves every control's state uncomputed, so a control
      // that should be disabled is briefly clickable. Recompute at once when
      // there is a view to compute from.
      if (this.#view) this.update(this.#view.state)
    })
  }

  /** Attach to a view and build the controls. */
  mount(view: EditorView): void {
    this.#view = view
    this.#render()
    this.update(view.state)
  }

  destroy(): void {
    this.#unsubscribe?.()
    clearTimeout(this.#liveTimer)
    this.el.removeEventListener('keydown', this.#onKeydown)
    this.#controls.clear()
    this.#view = null
  }

  /** The live region element, which the host mounts once. */
  get liveRegion(): HTMLDivElement {
    return this.#live
  }

  /* -------------------------------------------------------------- *
   * Rendering
   * -------------------------------------------------------------- */

  #render(): void {
    this.el.replaceChildren()
    this.#controls.clear()
    this.#select = null

    let group = this.#newGroup()

    for (const token of this.#layout.split(/\s+/).filter(Boolean)) {
      if (token === '|') {
        if (group.childElementCount > 0) this.el.appendChild(group)
        this.el.appendChild(this.#newSeparator())
        group = this.#newGroup()
        continue
      }

      if (token === BLOCK_TYPE_ID) {
        group.appendChild(this.#buildBlockTypeSelect())
        continue
      }

      const spec = getToolbarItem(token)
      // Silently skipping an unknown id would hide a typo in an integrator's
      // `toolbar` attribute forever.
      if (!spec) {
        console.warn(`@openleaf/ui: no toolbar item registered for "${token}"`)
        continue
      }
      // Only `button` is implemented. The `type` discriminant exists so that
      // adding variants later is not a breaking change to a published config
      // shape -- but a declared-and-inert variant is worse than an absent one,
      // because the author sees a plausible button and no signal that the
      // control they asked for was not built.
      if (spec.type && spec.type !== 'button') {
        console.warn(
          `@openleaf/ui: toolbar item "${spec.id}" declares type "${spec.type}", ` +
            'which is not implemented yet. It is rendering as a button.',
        )
      }
      group.appendChild(this.#buildButton(spec))
    }

    if (group.childElementCount > 0) this.el.appendChild(group)

    this.#refreshFocusables()
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
    button.setAttribute('aria-label', spec.label)

    const shortcut = spec.shortcut ? shortcutFor(spec.shortcut) : null
    button.title = shortcut ? `${spec.label} (${shortcut})` : spec.label

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
   * The block-type control.
   *
   * A native `<select>`. A custom listbox would be several hundred lines of
   * ARIA that would then owe real screen reader testing to be worth anything,
   * and the native control is already tested by the browser vendors. It carries
   * its own accessible name because the toolbar's own label does not describe it.
   */
  #buildBlockTypeSelect(): HTMLSelectElement {
    const select = this.#doc.createElement('select')
    select.className = 'ol-select'
    select.setAttribute('aria-label', 'Paragraph style')
    select.dataset['olId'] = BLOCK_TYPE_ID

    const options: Array<[string, string]> = [
      ['p', 'Paragraph'],
      ['1', 'Heading 1'],
      ['2', 'Heading 2'],
      ['3', 'Heading 3'],
      ['4', 'Heading 4'],
      ['5', 'Heading 5'],
      ['6', 'Heading 6'],
    ]
    for (const [value, label] of options) {
      const option = this.#doc.createElement('option')
      option.value = value
      option.textContent = label
      select.appendChild(option)
    }

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
      const value = select.value
      const command = value === 'p' ? setParagraph : toggleHeading(Number(value))
      command(view.state, view.dispatch, view)
      // Return the caret to the content only when the author committed the
      // choice by pointer. Keyboard users keep focus and leave with Tab or
      // Escape.
      if (pointerDriven) {
        pointerDriven = false
        view.focus()
      }
    })

    this.#select = select
    return select
  }

  /* -------------------------------------------------------------- *
   * Invocation
   * -------------------------------------------------------------- */

  #invoke(spec: ToolbarItemSpec): void {
    const view = this.#view
    if (!view) return

    const control = this.#controls.get(spec.id)
    if (control && control.enabled === false) return

    try {
      if (spec.run) {
        spec.run({ view, host: this.#host })
        return
      }
      if (spec.command) {
        spec.command(view.state, view.dispatch, view)
        view.focus()
      }
    } catch (error) {
      console.error(
        `@openleaf/ui: toolbar item "${spec.id}" threw when activated. ` +
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
    // Announce only on a discrete formatting transition, never on cursor
    // movement through already-formatted text. That gate is the whole
    // difference between a useful announcement and a chatty one.
    const isFormattingChange = !!tr && (tr.docChanged || tr.storedMarksSet)
    const transitions: string[] = []

    for (const control of this.#controls.values()) {
      const { spec } = control

      const enabled =
        control.forcedEnabled ??
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
            transitions.push(`${spec.label} ${active ? 'on' : 'off'}`)
          }
        }
      }
    }

    if (this.#select) {
      const level = activeHeadingLevel(state)
      const value = level === null ? 'p' : String(level)
      if (this.#select.value !== value) this.#select.value = value
    }

    if (transitions.length > 0) this.#announce(transitions.join(', '))
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
    // Clear then set on a timer: replacing identical text does not re-announce,
    // and the delay coalesces a held shortcut into one utterance.
    this.#live.textContent = ''
    clearTimeout(this.#liveTimer)
    this.#liveTimer = setTimeout(() => {
      this.#live.textContent = message
    }, 60)
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
    // A toolbar that is only the block-type select has no roving buttons.
    // The shortcut is still documented; swallowing it with nowhere to go
    // would make a valid `toolbar` attribute a silent no-op.
    this.#select?.focus()
  }

  /** Return focus and the prior selection to the editable region. */
  returnFocusToContent(): void {
    this.#view?.focus()
  }
}
