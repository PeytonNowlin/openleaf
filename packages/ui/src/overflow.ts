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
  /**
   * A pending coalesced layout.
   *
   * A ResizeObserver fires once per observed element, so a ten-group bar paid
   * for ten layouts in one frame. One rAF collapses them, and the frame is
   * cancelled on destroy so a queued layout cannot run against a torn-down bar.
   */
  #frame: number | null = null
  /**
   * A layout that arrived while the panel was open, and the guard that keeps
   * `#close` from re-entering the reflow that called it.
   */
  #deferred = false
  #reflowing = false

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
      this.#observer = new ResizeObserver(() => this.#schedule())
      this.#observer.observe(toolbar)
    }
    this.layout()
  }

  /** Re-home the trigger after the toolbar rebuilt its children. */
  reattach(): void {
    // Closed first: the panel is about to be emptied, and an open panel would
    // both defer the layout below and leave the author holding an empty one.
    this.#deferred = false
    this.#close()
    // The groups in the panel belong to the render that was just thrown away.
    // Restoring them would put two of every control in the bar.
    this.#panel.replaceChildren()
    if (!this.#more.isConnected) this.#toolbar.appendChild(this.#more)
    this.layout()
  }

  /**
   * Coalesce resize notifications into one layout per frame.
   *
   * The observer watches the very element `layout` resizes, so an unthrottled
   * callback fed itself: hiding a group changes the bar's size, which notifies
   * the observer, which lays out again. A frame is the right budget for work
   * whose only purpose is deciding what the next paint shows.
   */
  #schedule(): void {
    if (this.#frame !== null) return
    const win = this.#toolbar.ownerDocument.defaultView
    if (!win?.requestAnimationFrame) {
      this.layout()
      return
    }
    this.#frame = win.requestAnimationFrame(() => {
      this.#frame = null
      this.layout()
    })
  }

  destroy(): void {
    // A queued frame outlives destroy() and would lay out a torn-down bar.
    if (this.#frame !== null) {
      this.#toolbar.ownerDocument.defaultView?.cancelAnimationFrame(this.#frame)
      this.#frame = null
    }
    this.#observer?.disconnect()
    // Dropped before the close, or the close would lay out a bar being torn down.
    this.#deferred = false
    this.#close()
    this.#restore()
    this.#more.remove()
    this.#panel.remove()
    this.#toolbar.classList.remove('ol-toolbar--overflow')
  }

  /**
   * Lay the bar out without stealing focus.
   *
   * `#reflow` moves real controls -- the trigger included -- between the bar and
   * the panel, and `appendChild` of an already-connected node is a removal
   * followed by an insertion. Every engine resets focus to the body when a
   * focused element is moved that way (chromium, firefox and webkit alike; it is
   * not a WebKit quirk, WebKit just loses the race more often on a loaded
   * machine). A ResizeObserver fires whenever the bar changes size -- a font
   * finishing, `--openleaf-button-size` changing density, a CMS sidebar
   * animating open -- so a keyboard user standing on More could have the button
   * pulled out from under them between focusing it and pressing Enter, and the
   * Enter went to the document.
   *
   * So the layout records what it is about to move focus off, and puts it back.
   */
  layout(): void {
    // Never reflow under an open panel. Measuring means putting every group
    // back in the bar, which means closing the panel the author is reading --
    // so a ResizeObserver pass that lands just after they opened it took it
    // away again, along with the focus inside it. A real viewport resize still
    // closes the panel through `#onViewportChange`, and that close runs the
    // deferred layout immediately; a font or a density change simply waits
    // until the author is done with the panel.
    if (!this.#panel.hidden) {
      this.#deferred = true
      return
    }

    const active = this.#doc.activeElement
    const held =
      active instanceof HTMLElement &&
      (this.#toolbar.contains(active) || this.#panel.contains(active))
        ? active
        : null

    this.#reflowing = true
    try {
      this.#reflow()
    } finally {
      this.#reflowing = false
    }

    if (!held || this.#doc.activeElement === held) return
    // A control the reflow pushed into the panel cannot hold focus: the panel is
    // hidden by now. The trigger is where the panel's own Escape sends focus, so
    // it is the honest destination for a control that just went behind it.
    const target = held.isConnected && !this.#panel.contains(held) ? held : this.#more
    if (!target.hidden && target.isConnected) target.focus()
  }

  #reflow(): void {
    this.#restore()
    // Revealed BEFORE the reads, not after the compute. The trigger takes a
    // width and a gap in the row the moment it is shown, and it cannot be
    // measured while hidden -- `display: none` reports 0. Showing it here means
    // its footprint is inside the same `scrollWidth` as everything else, so the
    // arithmetic needs no second measurement and no second layout pass.
    //
    // Measured every time rather than cached: the width follows
    // `--openleaf-button-size`, which a skin or an integrator token changes at
    // runtime (compact is 28px, the default 32px, coarse-pointer 40px), so a
    // value pinned at first layout goes quietly wrong on the next density
    // change.
    this.#more.hidden = false
    this.#close()

    // READ. Every measurement is taken here, while the bar is fully expanded,
    // because a width read after a style write forces the browser to lay the
    // whole bar out again. The old loop alternated the two once per group, so a
    // ten-group bar paid for ten layouts -- from a ResizeObserver watching the
    // element it was resizing.
    const budget = this.#toolbar.clientWidth
    const groups = this.#groups()
    const total = this.#toolbar.scrollWidth
    const widths = groups.map((group) => group.offsetWidth)
    const moreWidth = this.#more.offsetWidth
    const gap =
      Number.parseFloat(
        this.#toolbar.ownerDocument.defaultView?.getComputedStyle(this.#toolbar).columnGap ?? '',
      ) || 0

    if (budget === 0) {
      this.#more.hidden = true
      return
    }

    // COMPUTE. In overflow mode the bar is a nowrap flex row with one uniform
    // gap, so moving the last k groups out takes exactly their widths and k
    // gaps off the scroll width. Nothing has to be re-measured between them.
    //
    // The trigger's footprint has to come back OUT to answer "does this bar
    // overflow at all", because a bar that fits never shows one -- and charging
    // it for a button it will not show would collapse a group for nothing.
    const trigger = moreWidth > 0 ? moreWidth + gap : 0
    if (total - trigger <= budget + 1) {
      this.#more.hidden = true
      return
    }

    // Past here the trigger stays, so `total` -- which already includes it -- is
    // the right starting point. Leaving it out is what let a bar stay
    // overflowing by roughly the width of the More button: the groups fit, then
    // revealing the trigger pushed the row back over its budget, and it
    // converged only on the next ResizeObserver pass, with a visible flash in
    // between.
    let used = total
    let count = 0
    while (used > budget + 1 && count < groups.length) {
      used -= (widths[groups.length - 1 - count] ?? 0) + gap
      count += 1
    }
    if (count === 0) {
      this.#more.hidden = true
      return
    }

    // WRITE. Backwards, inserted at the front, so the panel keeps the bar's
    // order. The controls themselves move -- they are not cloned -- which is
    // what makes the panel operable rather than a picture of the bar.
    for (let i = groups.length - 1; i >= groups.length - count; i -= 1) {
      const group = groups[i]
      if (group) this.#panel.insertBefore(group, this.#panel.firstChild)
    }

    // The trigger is already visible -- revealed before the reads, above. And
    // there are no separator elements to hide: the divider is a border on the
    // group, so a group that moved into the panel takes its own rule with it
    // and cannot leave one stranded at the end of the bar.
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
    // The reflow's own `#close` must not turn round and call it again.
    if (this.#deferred && !this.#reflowing) {
      this.#deferred = false
      this.layout()
    }
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
    // puts them back where they were. The trigger stays last -- but only if it
    // is not already there. An unconditional `appendChild` re-inserts it on
    // every pass, and a re-insertion is what drops focus, so the steady-state
    // layout of a bar that fits now moves nothing at all.
    if (this.#more.isConnected && this.#toolbar.lastElementChild !== this.#more) {
      this.#toolbar.appendChild(this.#more)
    }
  }

  #groups(): HTMLElement[] {
    return [...this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-group')]
  }
}
