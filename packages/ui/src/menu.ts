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

export class PopupMenu {
  readonly el: HTMLDivElement
  #doc: Document
  #host: HTMLElement
  #view: EditorView | null = null
  #items: readonly MenuEntry[] = []
  #onClose: (() => void) | undefined

  constructor(host: HTMLElement, doc: Document) {
    this.#host = host
    this.#doc = doc
    ensureStyles(doc)
    this.el = doc.createElement('div')
    this.el.className = 'ol-menu'
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

  show(items: readonly MenuEntry[], x: number, y: number, onClose?: () => void): void {
    this.#items = items
    this.#onClose = onClose
    this.#render()
    this.el.hidden = false
    const hostBox = this.#host.getBoundingClientRect()
    this.el.style.left = `${Math.max(0, x - hostBox.left)}px`
    this.el.style.top = `${Math.max(0, y - hostBox.top)}px`
    const first = this.el.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.el.replaceChildren()
    const close = this.#onClose
    this.#onClose = undefined
    close?.()
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
      this.el.appendChild(button)
    }
  }

  #onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-ol-id]')
    if (!target || target.getAttribute('aria-disabled') === 'true') return
    const spec = getToolbarItem(target.dataset['olId'] ?? '')
    const view = this.#view
    if (!spec || !view) return
    this.close()
    invoke(spec, view, this.#host)
  }

  #onKeydown = (event: KeyboardEvent): void => {
    const items = [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(event.target as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      this.#view?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = items[(index + delta + items.length) % items.length]
      next?.focus()
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      ;(event.target as HTMLElement).click()
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
      button.addEventListener('click', () => this.#toggle(menu, button))
      this.el.appendChild(button)
    }
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
    this.#popup.show(menu.items, rect.left, rect.bottom + 2, () => {
      trigger.setAttribute('aria-expanded', 'false')
      this.#openId = null
    })
  }

  #close(): void {
    this.#popup.close()
    for (const button of this.el.querySelectorAll<HTMLElement>('[aria-expanded]')) {
      button.setAttribute('aria-expanded', 'false')
    }
    this.#openId = null
  }

  #onKeydown = (event: KeyboardEvent): void => {
    const triggers = [...this.el.querySelectorAll<HTMLButtonElement>('.ol-menu-trigger')]
    const index = triggers.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = triggers[(index + delta + triggers.length) % triggers.length]
      next?.focus()
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
