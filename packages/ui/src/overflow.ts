/**
 * Collapse overflowing toolbar groups into a "More" panel.
 *
 * Wrapping is the default for a reason: a control that moved behind a click is
 * a control the author does not have. Overflow is therefore opt-in. When it is
 * on, groups that do not fit the current width are moved out of the bar and
 * offered in a panel at the end, so a narrow CMS sidebar still has every item
 * without a two-row bar.
 *
 * ## Why the real controls move rather than being cloned
 *
 * The first implementation cloned each control into a `role="menu"`. Cloning a
 * live control produces a listener-free copy that has to forward every
 * interaction back to an original it can only find by id, duplicates that id
 * and the accessible name, and goes stale the moment the caret moves -- three
 * bugs that only exist because there were two of everything. Moving the group
 * node itself has none of them: the control in the panel IS the control, so it
 * carries its own listeners, its own state and its own accessible name, and
 * nothing can drift.
 *
 * ## The keyboard pattern
 *
 * The panel is a vertical `role="toolbar"`, not a `role="menu"`: a menu owns a
 * content model of `menuitem` children, and a `<select>` is not one -- the
 * default bar has four. So the panel is the same widget as the bar it came
 * from, turned ninety degrees, and it keeps the same contract: one tab stop,
 * arrow keys to move, Home/End to the ends, Escape back to the trigger. Tab
 * closes, because a panel a keyboard user can walk out of and leave open is the
 * failure mode of every hand-rolled popup.
 *
 * Up/Down are taken from a `<select>` inside the panel the same way Left/Right
 * are taken from one in the bar; Alt+Down still opens its list, and typeahead
 * still selects. Home/End are left to the select, which uses them for its own
 * first and last option.
 */

import { t } from './i18n.js'
import { iconElement } from './icons.js'

/** Focusable controls, matching what the toolbar's own roving walks. */
const FOCUSABLE = 'button.ol-btn, select.ol-select'

let panelCounter = 0

export class ToolbarOverflow {
  #toolbar: HTMLElement
  #host: HTMLElement
  #doc: Document
  #more: HTMLButtonElement
  #panel: HTMLDivElement
  #observer: ResizeObserver | null = null
  #onLayout: (() => void) | undefined

  constructor(toolbar: HTMLElement, host: HTMLElement, doc: Document, onLayout?: () => void) {
    this.#toolbar = toolbar
    this.#host = host
    this.#doc = doc
    this.#onLayout = onLayout
    toolbar.classList.add('ol-toolbar--overflow')

    this.#panel = doc.createElement('div')
    this.#panel.className = 'ol-menu ol-overflow-menu'
    this.#panel.id = `ol-overflow-${(panelCounter += 1)}`
    this.#panel.setAttribute('role', 'toolbar')
    this.#panel.setAttribute('aria-orientation', 'vertical')
    this.#panel.setAttribute('aria-label', t('More formatting'))
    this.#panel.hidden = true
    this.#panel.addEventListener('keydown', this.#onKeydown)

    this.#more = doc.createElement('button')
    this.#more.type = 'button'
    this.#more.className = 'ol-btn ol-overflow-more'
    this.#more.setAttribute('aria-label', t('More'))
    // Not `aria-haspopup`: none of its values describes a toolbar, and "true"
    // means menu, which is what this deliberately is not. Expanded plus a
    // pointer at the panel is the honest relationship.
    this.#more.setAttribute('aria-expanded', 'false')
    this.#more.setAttribute('aria-controls', this.#panel.id)
    this.#more.hidden = true
    this.#more.appendChild(iconElement('more', doc))
    this.#more.addEventListener('mousedown', (event) => event.preventDefault())
    this.#more.addEventListener('click', () => {
      if (this.#panel.hidden) this.#open()
      else this.#close(true)
    })

    // Immediately after the bar, never at the end of the editor: appended to the
    // host it landed after the editable region, so Tab from More walked into the
    // content and the panel could only be reached by going backwards.
    if (toolbar.parentNode) toolbar.after(this.#panel)
    else host.appendChild(this.#panel)
    toolbar.appendChild(this.#more)

    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.layout())
      this.#observer.observe(toolbar)
    }
    this.layout()
  }

  /** Re-home the trigger after the toolbar rebuilt its children. */
  reattach(): void {
    // The groups in the panel belong to the render that was just thrown away.
    // Restoring them would put two of every control in the bar.
    this.#panel.replaceChildren()
    if (!this.#more.isConnected) this.#toolbar.appendChild(this.#more)
    this.layout()
  }

  destroy(): void {
    this.#observer?.disconnect()
    this.#close()
    this.#restore()
    this.#more.remove()
    this.#panel.remove()
    this.#toolbar.classList.remove('ol-toolbar--overflow')
  }

  layout(): void {
    this.#restore()
    this.#more.hidden = true
    this.#close()

    const budget = this.#toolbar.clientWidth
    if (budget === 0) return

    const groups = this.#groups()
    let moved = false
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      if (this.#toolbar.scrollWidth <= budget + 1) break
      const group = groups[i]
      if (!group) break
      // Backwards, inserted at the front: the panel keeps the bar's order.
      this.#panel.insertBefore(group, this.#panel.firstChild)
      moved = true
    }

    if (moved) {
      this.#more.hidden = false
      // A separator whose group left would otherwise sit at the end of the bar
      // as a rule with nothing on either side of it.
      let prev = this.#more.previousElementSibling
      while (prev instanceof HTMLElement && prev.classList.contains('ol-sep')) {
        prev.hidden = true
        prev = prev.previousElementSibling
      }
    }
    this.#onLayout?.()
    void this.#host
  }

  /* -------------------------------------------------------------- *
   * Open, close, and the keyboard
   * -------------------------------------------------------------- */

  #open(): void {
    this.#panel.hidden = false
    this.#more.setAttribute('aria-expanded', 'true')
    this.#position()
    this.#doc.addEventListener('pointerdown', this.#onPointerDown, true)
    this.#doc.defaultView?.addEventListener('scroll', this.#onViewportChange, true)
    this.#doc.defaultView?.addEventListener('resize', this.#onViewportChange)
    this.#focus(0)
  }

  #close(returnFocus = false): void {
    if (this.#panel.hidden) return
    this.#panel.hidden = true
    this.#more.setAttribute('aria-expanded', 'false')
    this.#doc.removeEventListener('pointerdown', this.#onPointerDown, true)
    this.#doc.defaultView?.removeEventListener('scroll', this.#onViewportChange, true)
    this.#doc.defaultView?.removeEventListener('resize', this.#onViewportChange)
    if (returnFocus) this.#more.focus()
  }

  /**
   * Under the trigger, in viewport coordinates and clamped to it.
   *
   * Fixed rather than absolute because the bar may sit inside a host with
   * `overflow: hidden`, which is the case the whole feature exists for.
   */
  #position(): void {
    const rect = this.#more.getBoundingClientRect()
    const box = this.#panel.getBoundingClientRect()
    const view = this.#doc.defaultView
    const width = view?.innerWidth ?? 0
    const height = view?.innerHeight ?? 0
    const below = rect.bottom + 4
    const top = below + box.height > height ? Math.max(4, rect.top - box.height - 4) : below
    this.#panel.style.position = 'fixed'
    this.#panel.style.left = `${Math.round(Math.max(4, Math.min(rect.left, width - box.width - 4)))}px`
    this.#panel.style.top = `${Math.round(top)}px`
  }

  #focusables(): HTMLElement[] {
    return [...this.#panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
  }

  #focus(index: number): void {
    const items = this.#focusables()
    if (items.length === 0) return
    const next = items[(index + items.length) % items.length]
    for (const item of items) item.tabIndex = item === next ? 0 : -1
    next?.focus()
  }

  #onKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      this.#close(true)
      return
    }
    const items = this.#focusables()
    const index = items.indexOf(target as HTMLElement)
    if (index < 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Alt+Down is how a keyboard user opens a native select's list.
      if (event.altKey) return
      event.preventDefault()
      this.#focus(index + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      // Left to the select, which uses them for its own first and last option.
      if (target?.tagName === 'SELECT') return
      event.preventDefault()
      this.#focus(event.key === 'Home' ? 0 : items.length - 1)
    }
  }

  #onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    if (this.#panel.contains(target) || this.#more.contains(target)) return
    this.#close()
  }

  #onViewportChange = (): void => this.#close()

  /* -------------------------------------------------------------- *
   * Moving groups back and forth
   * -------------------------------------------------------------- */

  #restore(): void {
    for (const group of [...this.#panel.children]) this.#toolbar.appendChild(group)
    // Overflow always takes a suffix of the groups, so appending in panel order
    // puts them back where they were. The trigger stays last.
    if (this.#more.isConnected) this.#toolbar.appendChild(this.#more)
    for (const sep of this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-sep')) {
      sep.hidden = false
    }
  }

  #groups(): HTMLElement[] {
    return [...this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-group')]
  }
}
