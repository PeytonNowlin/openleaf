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
        this.#menu.appendChild(item)
      }
    }

    // Cloning controls duplicates listeners-less buttons. Clicks on the clones
    // are forwarded to the originals, which still own the commands.
    this.#menu.onclick = (event) => {
      const clone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-ol-id], select')
      if (!clone) return
      const id = clone instanceof HTMLSelectElement ? 'blockType' : clone.dataset['olId']
      const original = this.#toolbar.querySelector<HTMLElement>(
        id === 'blockType' ? 'select' : `[data-ol-id="${id}"]`,
      )
      original?.click()
      this.#menu.hidden = true
      this.#more.setAttribute('aria-expanded', 'false')
    }
    void this.#host
  }

  #groups(): HTMLElement[] {
    return [...this.#toolbar.querySelectorAll<HTMLElement>(':scope > .ol-group')]
  }
}
