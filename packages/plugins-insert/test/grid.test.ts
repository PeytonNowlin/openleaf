/**
 * The glyph picker's construction: ARIA shape, keyboard model, and where
 * the panel is mounted.
 *
 * Focus movement against a real layout is asserted in
 * packages/element/test/e2e/insert.spec.ts -- jsdom has no layout, so a
 * popover's position is not something it can tell you about. What is worth
 * checking here is the wiring: a grid with rows, a roving tabindex, arrows
 * that move by one and by a row, and a panel that lives on the editor host
 * rather than document.body (the colour picker's mount, which keeps focus
 * and IME inside a shadow-root editor).
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { CHARACTERS, EMOJI, GLYPH_COLUMNS } from '../src/glyphs.js'
import { buildGlyphPicker } from '../src/grid.js'

let lastControl: { destroy?: () => void } | undefined

function picker(items = CHARACTERS, label = 'Character map', parent: ParentNode = document.body) {
  let state = EditorState.create({ doc: parseHtml('<p>hello</p>', { schema: coreSchema() }) })

  const host = document.createElement('div')
  parent.appendChild(host)

  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus: () => undefined,
  } as unknown as EditorView

  const control = buildGlyphPicker(
    { view, host },
    { label, icon: 'charmap', items },
  )
  host.appendChild(control.el)
  lastControl = control

  return {
    control,
    host,
    serialize: () => serializeHtml(state.doc),
  }
}

function trigger(host: HTMLElement): HTMLButtonElement {
  return host.querySelector('button.ol-btn') as HTMLButtonElement
}

function grid(host: HTMLElement): HTMLElement {
  // On the host, not document.body -- same mount as the colour picker. A
  // body-mounted popover left the editor's shadow tree.
  return host.querySelector('[role="grid"]') as HTMLElement
}

function cells(host: HTMLElement): HTMLButtonElement[] {
  return [...grid(host).querySelectorAll<HTMLButtonElement>('[role="gridcell"]')]
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  lastControl?.destroy?.()
  lastControl = undefined
  document.body.innerHTML = ''
})

describe('the glyph lists', () => {
  it('fills whole rows, so the grid has no gaps to arrow into', () => {
    expect(CHARACTERS.length % GLYPH_COLUMNS).toBe(0)
    expect(EMOJI.length % GLYPH_COLUMNS).toBe(0)
  })
})

describe('the control', () => {
  it('uses the same grid for emoji as for the character map', () => {
    const { host } = picker(EMOJI, 'Emoji')
    trigger(host).click()
    expect(grid(host).getAttribute('aria-label')).toBe('Emoji')
    expect(cells(host)).toHaveLength(EMOJI.length)
    expect(grid(host).querySelectorAll('[role="row"]')).toHaveLength(EMOJI.length / GLYPH_COLUMNS)
  })

  it('is a grid, so a reader can say which row and column a glyph is in', () => {
    const { host } = picker()
    trigger(host).click()
    const rows = grid(host).querySelectorAll('[role="row"]')
    expect(rows).toHaveLength(CHARACTERS.length / GLYPH_COLUMNS)
    for (const row of rows) {
      expect(row.querySelectorAll('[role="gridcell"]')).toHaveLength(GLYPH_COLUMNS)
    }
  })

  it('opens with a single tab stop on the first glyph', () => {
    const { host } = picker()
    trigger(host).click()
    const tabStops = cells(host).filter((cell) => cell.tabIndex === 0)
    expect(tabStops).toHaveLength(1)
    expect(tabStops[0]?.getAttribute('aria-label')).toBe('Copyright')
  })

  it('moves by one and by a row, and Home and End stay on the row', () => {
    const { host } = picker()
    trigger(host).click()
    const [copyright, registered, , , , , , bullet, ellipsis] = cells(host)
    expect(copyright?.getAttribute('aria-label')).toBe('Copyright')
    press(copyright!, 'ArrowRight')
    expect(registered?.tabIndex).toBe(0)
    press(registered!, 'End')
    expect(bullet?.tabIndex).toBe(0)
    expect(bullet?.getAttribute('aria-label')).toBe('Bullet')
    press(bullet!, 'Home')
    expect(copyright?.tabIndex).toBe(0)
    press(copyright!, 'ArrowDown')
    expect(ellipsis?.tabIndex).toBe(0)
    expect(ellipsis?.getAttribute('aria-label')).toBe('Ellipsis')
  })

  /*
   * This asserted the panel was still open after Tab, and that was a jsdom
   * artifact standing in for a browser behaviour. Nothing here moves focus, so
   * the `focusout` close never fired and the panel stayed open in this
   * environment only -- in a real engine Tab moves focus, focus leaves, and the
   * panel closes. Firefox was the exception, and not in a good way: it moved
   * focus nowhere at all, so the panel stayed open with focus trapped on the
   * first glyph (WCAG 2.1.2).
   *
   * The contract is now explicit rather than emergent: Tab closes the panel and
   * hands focus back to the trigger, and it does NOT preventDefault, so the
   * browser's own Tab then carries on from the trigger. That last part is why
   * Shift+Tab needs no separate implementation.
   */
  it('closes on Tab and returns focus to the trigger, without swallowing the key', () => {
    const { host } = picker()
    trigger(host).click()
    const event = press(cells(host)[0]!, 'Tab')
    expect(event.defaultPrevented).toBe(false)
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
    expect(host.shadowRoot?.activeElement ?? document.activeElement).toBe(trigger(host))
  })

  it('closes on Escape', () => {
    const { host } = picker()
    trigger(host).click()
    press(cells(host)[0]!, 'Escape')
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('inserts the glyph that was clicked and closes', () => {
    const { host, serialize } = picker()
    trigger(host).click()
    cells(host)[0]?.click()
    expect(serialize()).toContain('©')
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('refuses to open on a readonly editor', () => {
    const { host } = picker()
    host.setAttribute('readonly', '')
    trigger(host).click()
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('opens as a descendant of the editor host, not of document.body', () => {
    // Colour swatches already mount on the host so they stay in the editor's
    // tree. The character map used document.body, which is the wrong root in
    // any CMS that puts <openleaf-editor> in a shadow tree, and the wrong
    // palette: skin tokens are scoped to .ol-editor.
    const { host } = picker()
    trigger(host).click()
    const panel = grid(host)
    expect(host.contains(panel)).toBe(true)
    expect(panel.parentElement).toBe(host)
    if (host !== document.body) expect(panel.parentElement).not.toBe(document.body)
  })

  it('opens inside a shadow-root host rather than leaking onto document.body', () => {
    const shell = document.createElement('div')
    document.body.appendChild(shell)
    const { host } = picker(CHARACTERS, 'Character map', shell.attachShadow({ mode: 'open' }))
    trigger(host).click()
    const panel = host.querySelector('.ol-insert-grid')
    expect(panel).not.toBeNull()
    expect(panel?.parentElement).toBe(host)
    expect(document.body.querySelector(':scope > .ol-insert-grid')).toBeNull()
  })

  it('stays open when focusout relatedTarget is a glyph in the grid', async () => {
    // In a shadow tree document.activeElement is the host, not the focused
    // glyph, so the 0ms timeout that trusted activeElement closed the panel
    // the moment focus moved between cells. relatedTarget is the node that
    // actually received focus.
    const shell = document.createElement('div')
    document.body.appendChild(shell)
    const { host } = picker(CHARACTERS, 'Character map', shell.attachShadow({ mode: 'open' }))
    trigger(host).click()
    const panel = grid(host)
    const [first, second] = cells(host)
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    first!.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: second ?? null }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true')
    expect(panel.isConnected).toBe(true)
  })

  it('closes when focusout relatedTarget is outside the grid', async () => {
    const { host } = picker()
    trigger(host).click()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    grid(host).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('takes the grid with it when destroyed', () => {
    const { host, control } = picker()
    trigger(host).click()
    expect(grid(host).isConnected).toBe(true)
    control.destroy?.()
    lastControl = undefined
    expect(host.querySelector('.ol-insert-grid')).toBeNull()
    expect(document.querySelector('.ol-insert-grid')).toBeNull()
  })
})
