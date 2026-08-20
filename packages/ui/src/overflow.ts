/**
 * Collapse overflowing toolbar groups into a "More" menu.
 *
 * Wrapping is the default for a reason: a control that moved behind a click is
 * a control the author does not have. Overflow is therefore opt-in. When it is
 * on, groups that do not fit the current width are hidden in the bar and
 * offered in a menu at the end, so a narrow CMS sidebar still has every item
 * without a two-row bar.
 */

import { t } from './i18n.js'
import { iconElement } from './icons.js'

export class ToolbarOverflow {
  #toolbar: HTMLElement
  #host: HTMLElement
  #more: HTMLButtonElement
  #menu: HTMLDivElement
  #observer: ResizeObserver | null = null
  #frame: number | null = null

  constructor(toolbar: HTMLElement, host: HTMLElement, doc: Document) {
    this.#toolbar = toolbar
    this.#host = host
    toolbar.classList.add('ol-toolbar--overflow')

    this.#more = doc.createElement('button')
    this.#more.type = 'button'
    this.#more.className = 'ol-btn ol-overflow-more'
    this.#more.setAttribute('aria-label', t('More'))
    this.#more.setAttribute('aria-haspopup', 'true')
    this.#more.setAttribute('aria-expanded', 'false')
    this.#more.hidden = true
    this.#more.appendChild(iconElement('more', doc))

    this.#menu = doc.createElement('div')
    this.#menu.className = 'ol-menu ol-overflow-menu'
    this.#menu.setAttribute('role', 'menu')
    this.#menu.hidden = true

    this.#more.addEventListener('click', () => {
      const opening = this.#menu.hidden
      // Rebuild on open so selects reflect the caret after layout last ran.
      // Without this, moving between differently formatted text leaves the
      // overflow copy showing a stale font, size or heading.
      if (opening) this.#fillMenu(this.#groups().filter((group) => group.hidden))
      this.#menu.hidden = !opening
      this.#more.setAttribute('aria-expanded', opening ? 'true' : 'false')
    })

    // Cloning controls duplicates listener-less buttons. Activation on a clone
    // is forwarded to the original, which still owns the command.
    this.#menu.onclick = (event) => {
      const target = event.target as HTMLElement | null
      // A <select> is driven by `change`, not `click`. Forwarding a click here
      // fired before any option was chosen and carried no value with it.
      if (target?.closest('select')) return
      const clone = target?.closest<HTMLElement>('[data-ol-id]')
      if (!clone) return
      const original = this.#toolbar.querySelector<HTMLElement>(
        `[data-ol-id="${clone.dataset['olId']}"]`,
      )
      original?.click()
      this.#close()
    }

    // The clone has no listeners of its own, so a chosen value has to be written
    // onto the real control and announced there. Clicking the original was the
    // previous behaviour and never carried the value, so headings and custom
    // formats could not be applied from the overflow menu at all.
    this.#menu.onchange = (event) => {
      const clone = event.target
      if (!(clone instanceof HTMLSelectElement)) return
      const original = this.#toolbar.querySelector<HTMLSelectElement>(
        `select[data-ol-id="${clone.dataset['olId']}"]`,
      )
      if (!original) return
      original.value = clone.value
      original.dispatchEvent(new Event('change', { bubbles: true }))
      this.#close()
    }

    host.appendChild(this.#menu)
    toolbar.appendChild(this.#more)

    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.#schedule())
      this.#observer.observe(toolbar)
    }
    this.layout()
  }

  reattach(): void {
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
    this.#observer?.disconnect()
    // A queued frame outlives disconnect() and would lay out a torn-down bar.
    if (this.#frame !== null) {
      this.#toolbar.ownerDocument.defaultView?.cancelAnimationFrame(this.#frame)
      this.#frame = null
    }
    this.#more.remove()
    this.#menu.remove()
    this.#toolbar.classList.remove('ol-toolbar--overflow')
    for (const group of this.#groups()) group.hidden = false
  }

  layout(): void {
    const groups = this.#groups()
    for (const group of groups) group.hidden = false
    this.#more.hidden = true
    this.#menu.hidden = true
    this.#menu.replaceChildren()
    this.#more.setAttribute('aria-expanded', 'false')

    // READ. Every measurement is taken here, while the bar is fully expanded,
    // because a width read after a style write forces the browser to lay the
    // whole bar out again. The old loop alternated the two once per group, so a
    // ten-group bar paid for ten layouts -- from a ResizeObserver watching the
    // element it was resizing.
    const budget = this.#toolbar.clientWidth
    if (budget === 0) return
    const total = this.#toolbar.scrollWidth
    const widths = groups.map((group) => group.offsetWidth)
    const gap =
      Number.parseFloat(
        this.#toolbar.ownerDocument.defaultView?.getComputedStyle(this.#toolbar).columnGap ?? '',
      ) || 0

    // COMPUTE. In overflow mode the bar is a nowrap flex row with one uniform
    // gap, so hiding the last k groups takes exactly their widths and k gaps off
    // the scroll width. No re-measurement needed between them.
    let used = total
    let count = 0
    while (used > budget + 1 && count < groups.length) {
      used -= (widths[groups.length - 1 - count] ?? 0) + gap
      count += 1
    }
    if (count === 0) return

    // WRITE.
    const overflowing = groups.slice(groups.length - count)
    for (const group of overflowing) group.hidden = true
    this.#more.hidden = false
    this.#fillMenu(overflowing)
    void this.#host
  }

  /**
   * Clone the controls that live in overflowing groups into the More menu.
   *
   * Called from `layout` and again each time the menu opens, so a select that
   * gained options or changed value since the last resize is not shown stale.
   */
  #fillMenu(overflowing: readonly HTMLElement[]): void {
    this.#menu.replaceChildren()
    for (const group of overflowing) {
      for (const control of group.querySelectorAll<HTMLElement>('[aria-label], select')) {
        const item = control.cloneNode(true) as HTMLElement
        item.removeAttribute('tabindex')
        // cloneNode copies the option elements but not the select's current
        // value, which the toolbar sets as a property rather than an attribute.
        // Without this the menu opens showing the first option instead of the
        // block the caret is actually in.
        if (control instanceof HTMLSelectElement && item instanceof HTMLSelectElement) {
          item.value = control.value
        }
        this.#menu.appendChild(item)
      }
    }
  }

  #close(): void {
    this.#menu.hidden = true
    this.#more.setAttribute('aria-expanded', 'false')
  }

  #groups(): HTMLElement[] {
    return [...this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-group')]
  }
}
