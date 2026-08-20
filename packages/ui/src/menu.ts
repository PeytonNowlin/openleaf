/**
 * Menubar and popup menus.
 *
 * Built with `role="menubar"` / `role="menu"` rather than a toolbar, because
 * the two widgets have different keyboard contracts: a toolbar is one tab stop
 * of peer buttons, a menubar is a row of menus that open on Down/Enter and
 * close on Escape. Mixing them is what makes "the File menu is also a toolbar
 * button" feel broken to a screen reader.
 *
 * Items are toolbar ids. The same command a button runs is the command a menu
 * item runs, so a host that hides the toolbar still has a complete Edit menu.
 */

import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { t, withLocale } from './i18n.js'
import { getToolbarItem, type ToolbarItemSpec } from './registry.js'
import { ensureStyles } from './styles.js'

export interface MenuItemRef {
  id: string
  /** Override the toolbar item's label. */
  label?: string
}

export type MenuEntry = MenuItemRef | '|'

export interface MenuSpec {
  id: string
  label: string
  items: readonly MenuEntry[]
}

export const DEFAULT_MENUBAR: readonly MenuSpec[] = [
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'undo' },
      { id: 'redo' },
      '|',
      { id: 'bold' },
      { id: 'italic' },
      { id: 'underline' },
      { id: 'strikethrough' },
      { id: 'code' },
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    items: [{ id: 'link' }, { id: 'image' }, { id: 'horizontalRule' }, { id: 'insertTable' }],
  },
  {
    id: 'format',
    label: 'Format',
    items: [
      { id: 'alignLeft' },
      { id: 'alignCenter' },
      { id: 'alignRight' },
      { id: 'alignJustify' },
      '|',
      { id: 'indent' },
      { id: 'outdent' },
      '|',
      { id: 'bulletList' },
      { id: 'orderedList' },
      { id: 'blockquote' },
      { id: 'codeBlock' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [{ id: 'source' }, { id: 'fullscreen' }, { id: 'visualAids' }],
  },
  {
    id: 'help',
    label: 'Help',
    items: [{ id: 'help' }],
  },
]

export const LINK_CONTEXT_ITEMS: readonly MenuEntry[] = [{ id: 'link' }, { id: 'unlink' }]
export const IMAGE_CONTEXT_ITEMS: readonly MenuEntry[] = [{ id: 'image' }]
export const TABLE_CONTEXT_ITEMS: readonly MenuEntry[] = [
  { id: 'addRowBefore' },
  { id: 'addRowAfter' },
  { id: 'deleteRow' },
  '|',
  { id: 'addColumnBefore' },
  { id: 'addColumnAfter' },
  { id: 'deleteColumn' },
  '|',
  { id: 'deleteTable' },
]

function invoke(spec: ToolbarItemSpec, view: EditorView, host: HTMLElement): void {
  if (host.hasAttribute('readonly')) return
  try {
    if (spec.run) {
      spec.run({ view, host })
      return
    }
    if (spec.command) {
      spec.command(view.state, view.dispatch, view)
      view.focus()
    }
  } catch (error) {
    console.error(`@openleaf-editor/ui: menu item "${spec.id}" threw`, error)
  }
}

function enabled(spec: ToolbarItemSpec, state: EditorState, host: HTMLElement): boolean {
  if (host.hasAttribute('readonly')) return false
  if (spec.isEnabled) {
    try {
      return spec.isEnabled(state)
    } catch {
      return false
    }
  }
  if (spec.command) return spec.command(state)
  return true
}

/** Menus are named after the trigger that opened them, which needs an id. */
let menuCounter = 0

export interface PopupMenuOptions {
  /** The control that opened this menu. Owns the name and the focus return. */
  trigger?: HTMLElement
  /** Accessible name, when there is no trigger to borrow one from. */
  label?: string
  onClose?: () => void
}

export class PopupMenu {
  readonly el: HTMLDivElement
  #doc: Document
  #host: HTMLElement
  #view: EditorView | null = null
  #items: readonly MenuEntry[] = []
  #onClose: (() => void) | undefined
  #trigger: HTMLElement | null = null

  constructor(host: HTMLElement, doc: Document) {
    this.#host = host
    this.#doc = doc
    ensureStyles(doc)
    this.el = doc.createElement('div')
    this.el.className = 'ol-menu'
    this.el.id = `ol-menu-${(menuCounter += 1)}`
    this.el.setAttribute('role', 'menu')
    this.el.hidden = true
    this.el.addEventListener('keydown', this.#onKeydown)
    this.el.addEventListener('click', this.#onClick)
  }

  attach(view: EditorView): void {
    this.#view = view
  }

  destroy(): void {
    this.close()
    this.el.removeEventListener('keydown', this.#onKeydown)
    this.el.removeEventListener('click', this.#onClick)
    this.el.remove()
  }

  get open(): boolean {
    return !this.el.hidden
  }

  /**
   * Open at a point, named by whatever opened it.
   *
   * `trigger` is not optional decoration: without it the menu has no accessible
   * name at all -- a screen reader announces "menu", with nothing to say which
   * one -- and Escape has nowhere to put focus back, so it lands on the document
   * and the author is out of the menubar entirely.
   */
  show(items: readonly MenuEntry[], x: number, y: number, options: PopupMenuOptions = {}): void {
    this.#items = items
    this.#onClose = options.onClose
    const trigger = options.trigger ?? null
    this.#trigger = trigger
    if (trigger) {
      if (!trigger.id) trigger.id = `${this.el.id}-trigger`
      this.el.setAttribute('aria-labelledby', trigger.id)
      this.el.removeAttribute('aria-label')
      trigger.setAttribute('aria-controls', this.el.id)
    } else {
      this.el.removeAttribute('aria-labelledby')
      this.el.setAttribute('aria-label', t(options.label ?? 'Editor menu'))
    }
    this.#render()
    this.el.hidden = false
    this.#place(x, y)
    this.#focusItem(this.el.querySelector<HTMLElement>('[role="menuitem"]'))
  }

  /**
   * Keep the menu on screen.
   *
   * A right-click near the bottom of the viewport otherwise renders it below the
   * fold, where the item the author asked for cannot be seen or scrolled to --
   * the menu is positioned, so the page does not grow to contain it.
   */
  #place(x: number, y: number): void {
    const hostBox = this.#host.getBoundingClientRect()
    const box = this.el.getBoundingClientRect()
    const win = this.#doc.defaultView
    const vw = win?.innerWidth ?? 0
    const vh = win?.innerHeight ?? 0
    const left = vw > 0 ? Math.max(4, Math.min(x, vw - box.width - 4)) : x
    const top = vh > 0 && y + box.height > vh ? Math.max(4, y - box.height - 4) : y
    this.el.style.left = `${Math.round(left - hostBox.left)}px`
    this.el.style.top = `${Math.round(top - hostBox.top)}px`
  }

  /**
   * Close, and put focus somewhere real.
   *
   * `replaceChildren()` removes the node that currently has focus, and a browser
   * whose focused element disappears falls back to `<body>` -- so without the
   * return the author's next Tab starts from the top of the page.
   */
  close(returnFocus = false): void {
    if (this.el.hidden) return
    const trigger = this.#trigger
    if (returnFocus && trigger?.isConnected) trigger.focus()
    this.el.hidden = true
    this.el.replaceChildren()
    trigger?.removeAttribute('aria-controls')
    this.#trigger = null
    const close = this.#onClose
    this.#onClose = undefined
    close?.()
  }

  #focusItem(next: HTMLElement | null | undefined): void {
    if (!next) return
    // Roving, so Tab leaves the menu instead of walking through every item in it.
    for (const item of this.el.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      item.tabIndex = item === next ? 0 : -1
    }
    next.focus()
  }

  #render(): void {
    this.el.replaceChildren()
    const view = this.#view
    if (!view) return
    for (const entry of this.#items) {
      if (entry === '|') {
        const sep = this.#doc.createElement('div')
        sep.setAttribute('role', 'separator')
        sep.className = 'ol-menu-sep'
        this.el.appendChild(sep)
        continue
      }
      const spec = getToolbarItem(entry.id)
      if (!spec) continue
      const button = this.#doc.createElement('button')
      button.type = 'button'
      button.className = 'ol-menu-item'
      button.setAttribute('role', 'menuitem')
      button.dataset['olId'] = spec.id
      button.textContent = t(entry.label ?? spec.label)
      const isEnabled = enabled(spec, view.state, this.#host)
      button.setAttribute('aria-disabled', isEnabled ? 'false' : 'true')
      button.tabIndex = -1
      this.el.appendChild(button)
    }
  }

  #onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-ol-id]')
    if (!target || target.getAttribute('aria-disabled') === 'true') return
    const spec = getToolbarItem(target.dataset['olId'] ?? '')
    const view = this.#view
    if (!spec || !view) return
    // Closed first, but with focus put back on the trigger before the item is
    // removed. Running the command first instead would let `close()` steal focus
    // from a dialog the command had just opened.
    this.close(true)
    invoke(spec, view, this.#host)
  }

  #onKeydown = (event: KeyboardEvent): void => {
    const items = [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(event.target as HTMLElement)

    // Tab closes rather than walking on through the menu: a menu left open
    // behind a keyboard user is a widget with no exit.
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      const trigger = this.#trigger
      this.close(true)
      if (!trigger) this.#view?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      this.#focusItem(items[(index + delta + items.length) % items.length])
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      this.#focusItem(event.key === 'Home' ? items[0] : items[items.length - 1])
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      ;(event.target as HTMLElement).click()
      return
    }
    // Typeahead. A menubar user looking for "Italic" presses I, the way they do
    // in every other menu they have ever used.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const char = event.key.toLowerCase()
      const from = index + 1
      const found = [...items.slice(from), ...items.slice(0, Math.max(0, from))].find((item) =>
        (item.textContent ?? '').trim().toLowerCase().startsWith(char),
      )
      if (found) {
        event.preventDefault()
        this.#focusItem(found)
      }
    }
  }
}

/**
 * The menus an integrator asked for, in the order they asked for them.
 *
 * `menubar` with no value means "give me the menubar", so an empty list is every
 * default menu. Named ids are honoured as written: `menubar="edit help"` used to
 * render Insert, Format and View as well, because the attribute was read as a
 * boolean and the list thrown away. An unknown id is skipped rather than fatal,
 * so a layout written against a later version degrades instead of breaking.
 */
export function selectMenus(
  attr: string | null | undefined,
  menus: readonly MenuSpec[] = DEFAULT_MENUBAR,
): readonly MenuSpec[] {
  const ids = (attr ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id !== '')
  if (ids.length === 0) return menus
  const byId = new Map(menus.map((menu) => [menu.id, menu]))
  const picked: MenuSpec[] = []
  for (const id of ids) {
    const menu = byId.get(id)
    if (menu && !picked.includes(menu)) picked.push(menu)
  }
  return picked
}

export class MenuBar {
  readonly el: HTMLDivElement
  #doc: Document
  #host: HTMLElement
  #view: EditorView | null = null
  #menus: readonly MenuSpec[]
  #popup: PopupMenu
  #openId: string | null = null

  #locale: string | null

  constructor(
    host: HTMLElement,
    doc: Document,
    menus: readonly MenuSpec[] = DEFAULT_MENUBAR,
    locale: string | null = null,
  ) {
    this.#host = host
    this.#doc = doc
    this.#menus = menus
    this.#locale = locale
    ensureStyles(doc)
    this.el = doc.createElement('div')
    this.el.className = 'ol-menubar'
    this.el.setAttribute('role', 'menubar')
    withLocale(locale, () => {
      this.el.setAttribute('aria-label', t('Editor menu'))
    })
    this.#popup = new PopupMenu(host, doc)
    this.#render()
    this.el.addEventListener('keydown', this.#onKeydown)
    doc.addEventListener('pointerdown', this.#onPointerDown, true)
  }

  mount(view: EditorView): void {
    this.#view = view
    this.#popup.attach(view)
    if (!this.#popup.el.isConnected) this.#host.appendChild(this.#popup.el)
  }

  destroy(): void {
    this.#doc.removeEventListener('pointerdown', this.#onPointerDown, true)
    this.el.removeEventListener('keydown', this.#onKeydown)
    this.#popup.destroy()
  }

  #render(): void {
    withLocale(this.#locale, () => this.#renderScoped())
  }

  #renderScoped(): void {
    this.el.replaceChildren()
    for (const menu of this.#menus) {
      const button = this.#doc.createElement('button')
      button.type = 'button'
      button.className = 'ol-menu-trigger'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-haspopup', 'true')
      button.setAttribute('aria-expanded', 'false')
      button.dataset['olMenu'] = menu.id
      button.textContent = t(menu.label)
      // Roving: `role="menubar"` is ONE tab stop, and five native buttons at the
      // default tabindex made it five -- so Tab from the content walked the
      // author through every menu before reaching anything they wanted.
      button.tabIndex = this.el.childElementCount === 0 ? 0 : -1
      button.addEventListener('click', () => this.#toggle(menu, button))
      this.el.appendChild(button)
    }
  }

  #focusTrigger(next: HTMLElement | null | undefined): void {
    if (!next) return
    for (const button of this.el.querySelectorAll<HTMLElement>('.ol-menu-trigger')) {
      button.tabIndex = button === next ? 0 : -1
    }
    next.focus()
  }

  #toggle(menu: MenuSpec, trigger: HTMLButtonElement): void {
    if (this.#openId === menu.id && this.#popup.open) {
      this.#close()
      return
    }
    this.#open(menu, trigger)
  }

  #open(menu: MenuSpec, trigger: HTMLButtonElement): void {
    this.#close()
    this.#openId = menu.id
    trigger.setAttribute('aria-expanded', 'true')
    const rect = trigger.getBoundingClientRect()
    this.#popup.show(menu.items, rect.left, rect.bottom + 2, {
      trigger,
      onClose: () => {
        trigger.setAttribute('aria-expanded', 'false')
        this.#openId = null
      },
    })
  }

  #close(returnFocus = false): void {
    this.#popup.close(returnFocus)
    for (const button of this.el.querySelectorAll<HTMLElement>('[aria-expanded]')) {
      button.setAttribute('aria-expanded', 'false')
    }
    this.#openId = null
  }

  #onKeydown = (event: KeyboardEvent): void => {
    const triggers = [...this.el.querySelectorAll<HTMLButtonElement>('.ol-menu-trigger')]
    const index = triggers.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next =
        event.key === 'Home'
          ? triggers[0]
          : event.key === 'End'
            ? triggers[triggers.length - 1]
            : triggers[(index + (event.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length]
      this.#focusTrigger(next)
      if (this.#popup.open && next) {
        const menu = this.#menus.find((m) => m.id === next.dataset['olMenu'])
        if (menu) this.#open(menu, next)
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const menu = this.#menus.find((m) => m.id === triggers[index]?.dataset['olMenu'])
      const trigger = triggers[index]
      if (menu && trigger) this.#open(menu, trigger)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.#close()
      this.#view?.focus()
    }
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (!this.#popup.open) return
    const target = event.target as Node | null
    if (target && (this.el.contains(target) || this.#popup.el.contains(target))) return
    this.#close()
  }
}
