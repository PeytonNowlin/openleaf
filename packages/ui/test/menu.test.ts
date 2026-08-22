/**
 * The menubar and popup menus, against the APG menu pattern.
 *
 * These drive real `keydown` events rather than calling the handlers, because
 * every defect they cover was a key that reached the widget and was ignored.
 * The view is the same stand-in the toolbar tests use: state, dispatch, focus.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerDefaultItems } from '../src/items.js'
import { DEFAULT_MENUBAR, MenuBar, PopupMenu } from '../src/menu.js'

registerDefaultItems()

let focused = 0

function fakeView(html = '<p>hello</p>'): EditorView {
  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
  )
  return {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus: () => {
      focused += 1
    },
  } as unknown as EditorView
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function items(menu: PopupMenu): HTMLElement[] {
  return [...menu.el.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

let host: HTMLElement
let trigger: HTMLButtonElement

beforeEach(() => {
  document.body.replaceChildren()
  focused = 0
  host = document.createElement('div')
  host.className = 'ol-editor'
  document.body.appendChild(host)
  trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.textContent = 'Edit'
  host.appendChild(trigger)
})

afterEach(() => {
  document.body.replaceChildren()
})

function openMenu(): PopupMenu {
  const menu = new PopupMenu(host, document)
  host.appendChild(menu.el)
  menu.attach(fakeView())
  menu.show([{ id: 'bold' }, { id: 'italic' }, '|', { id: 'underline' }], 10, 10, { trigger })
  return menu
}

describe('a popup menu', () => {
  /*
   * NVDA announced "menu", with nothing to say which one. A menu with no name is
   * the a11y equivalent of an unlabelled button, and there was never a code path
   * that set one.
   */
  it('takes its accessible name from the trigger that opened it', () => {
    const menu = openMenu()
    expect(trigger.id).not.toBe('')
    expect(menu.el.getAttribute('aria-labelledby')).toBe(trigger.id)
    // And the relationship goes both ways, so AT can find the popup from the
    // control that owns it.
    expect(trigger.getAttribute('aria-controls')).toBe(menu.el.id)
    menu.destroy()
  })

  it('is one tab stop, not one per item', () => {
    const menu = openMenu()
    const all = items(menu)
    expect(all.length).toBeGreaterThan(1)
    expect(all.filter((el) => el.tabIndex === 0)).toHaveLength(1)
    expect(document.activeElement).toBe(all[0])
    menu.destroy()
  })

  it('moves on the arrow keys and on Home and End', () => {
    const menu = openMenu()
    const all = items(menu)
    press(all[0]!, 'ArrowDown')
    expect(document.activeElement).toBe(all[1])
    press(all[1]!, 'End')
    expect(document.activeElement).toBe(all[all.length - 1])
    press(all[all.length - 1]!, 'Home')
    expect(document.activeElement).toBe(all[0])
    menu.destroy()
  })

  it('jumps to an item by its first letter', () => {
    const menu = openMenu()
    const all = items(menu)
    press(all[0]!, 'i')
    expect(document.activeElement?.textContent).toBe('Italic')
    press(document.activeElement!, 'u')
    expect(document.activeElement?.textContent).toBe('Underline')
    menu.destroy()
  })

  /*
   * Escape used to close the menu and leave focus on the document, which drops
   * the author out of the menubar entirely -- their next Tab starts from the top
   * of the page rather than from the menu they just left.
   */
  it('returns focus to the trigger on Escape', () => {
    const menu = openMenu()
    press(document.activeElement!, 'Escape')
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    menu.destroy()
  })

  it('closes on Tab instead of letting focus walk through it', () => {
    const menu = openMenu()
    const event = press(document.activeElement!, 'Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    menu.destroy()
  })

  /*
   * `close()` calls `replaceChildren()`, which removes the element that has
   * focus -- and a browser whose focused node disappears falls back to <body>.
   * Activating "Bold" therefore stranded the author at the top of the page.
   */
  it('leaves focus somewhere real after an item is activated', () => {
    const menu = openMenu()
    const bold = items(menu)[0]!
    bold.click()
    expect(document.activeElement).not.toBe(document.body)
    menu.destroy()
  })

  it('names itself even with no trigger to borrow a name from', () => {
    const menu = new PopupMenu(host, document)
    host.appendChild(menu.el)
    menu.attach(fakeView())
    menu.show([{ id: 'bold' }], 10, 10, { label: 'Editor menu' })
    expect(menu.el.getAttribute('aria-label')).toBe('Editor menu')
    menu.destroy()
  })
})

describe('the menubar', () => {
  function mountBar(): MenuBar {
    const bar = new MenuBar(host, document, DEFAULT_MENUBAR)
    host.appendChild(bar.el)
    bar.mount(fakeView())
    return bar
  }

  /*
   * `role="menubar"` is ONE tab stop. Five native buttons at the default
   * tabindex made it five, so Tab from the content walked the author through
   * every menu before it reached anything they wanted.
   */
  it('is one tab stop', () => {
    const bar = mountBar()
    const triggers = [...bar.el.querySelectorAll<HTMLElement>('.ol-menu-trigger')]
    expect(triggers.length).toBeGreaterThan(1)
    expect(triggers.filter((el) => el.tabIndex === 0)).toHaveLength(1)
    bar.destroy()
  })

  /*
   * A menubar shares ONE PopupMenu across every menu on it, and builds its
   * triggers without ids. `show()` auto-assigned an id derived from the popup's
   * own name, so every trigger it touched got the same string: open Edit, then
   * Insert, and two buttons carried one DOM id. `aria-labelledby` resolves to
   * the first match in tree order, so the Insert menu was announced as "Edit".
   * The old single-trigger test could not see it.
   */
  it('names each menu after the trigger that opened it', () => {
    const bar = mountBar()
    const triggers = [...bar.el.querySelectorAll<HTMLButtonElement>('.ol-menu-trigger')]
    expect(triggers.length).toBeGreaterThan(1)

    const names: string[] = []
    const ids: string[] = []
    for (const button of triggers) {
      button.click()
      const menu = host.querySelector<HTMLElement>('.ol-menu:not([hidden])')
      expect(menu).not.toBeNull()
      const labelledBy = menu!.getAttribute('aria-labelledby')!
      ids.push(labelledBy)
      // Resolved the way a screen reader resolves it: the FIRST element in the
      // document with that id, not the trigger we happen to hold.
      names.push(document.getElementById(labelledBy)!.textContent ?? '')
      button.click()
    }

    expect(names).toEqual(triggers.map((el) => el.textContent))
    expect(new Set(ids).size).toBe(ids.length)
    bar.destroy()
  })

  it('leaves no duplicate ids behind in the document', () => {
    const bar = mountBar()
    const triggers = [...bar.el.querySelectorAll<HTMLButtonElement>('.ol-menu-trigger')]
    for (const button of triggers) {
      button.click()
      button.click()
    }
    // `close()` deliberately keeps the id it assigned -- an id that comes and
    // goes breaks any aria reference a host set up against it -- so the ids
    // accumulate and every one of them has to be unique.
    const assigned = triggers.map((el) => el.id).filter(Boolean)
    expect(assigned).toHaveLength(triggers.length)
    for (const id of assigned) {
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
    }
    bar.destroy()
  })

  it('keeps one tab stop as the arrow keys move along it', () => {
    const bar = mountBar()
    const triggers = [...bar.el.querySelectorAll<HTMLElement>('.ol-menu-trigger')]
    triggers[0]!.focus()
    press(triggers[0]!, 'ArrowRight')
    expect(document.activeElement).toBe(triggers[1])
    expect(triggers.filter((el) => el.tabIndex === 0)).toEqual([triggers[1]])
    press(triggers[1]!, 'End')
    expect(document.activeElement).toBe(triggers[triggers.length - 1])
    bar.destroy()
  })
})
