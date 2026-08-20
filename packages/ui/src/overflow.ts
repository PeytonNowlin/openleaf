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
      const open = this.#menu.hidden
      this.#menu.hidden = !open
      this.#more.setAttribute('aria-expanded', open ? 'true' : 'false')
    })

    host.appendChild(this.#menu)
    toolbar.appendChild(this.#more)

    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.layout())
      this.#observer.observe(toolbar)
    }
    this.layout()
  }

  reattach(): void {
    if (!this.#more.isConnected) this.#toolbar.appendChild(this.#more)
    this.layout()
  }

  destroy(): void {
    this.#observer?.disconnect()
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

    const budget = this.#toolbar.clientWidth
    if (budget === 0) return

    const overflowing: HTMLElement[] = []
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const fits = this.#toolbar.scrollWidth <= budget + 1
      if (fits) break
      const group = groups[i]
      if (!group) break
      group.hidden = true
      overflowing.unshift(group)
    }

    if (overflowing.length === 0) return
    this.#more.hidden = false
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

    // Cloning controls duplicates listener-less buttons. Activation on a clone is
    // forwarded to the original, which still owns the command.
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
    void this.#host
  }

  #close(): void {
    this.#menu.hidden = true
    this.#more.setAttribute('aria-expanded', 'false')
  }

  #groups(): HTMLElement[] {
    return [...this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-group')]
  }
}
