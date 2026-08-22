/**
 * The glyph picker's construction: ARIA shape and keyboard model.
 *
 * Focus movement against a real layout is asserted in
 * packages/element/test/e2e/insert.spec.ts -- jsdom has no layout, so a
 * popover's position is not something it can tell you about. What is worth
 * checking here is the wiring: a grid with rows, a roving tabindex, and
 * arrows that move by one and by a row.
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { CHARACTERS, EMOJI, GLYPH_COLUMNS } from '../src/glyphs.js'
import { buildGlyphPicker } from '../src/grid.js'

let lastControl: { destroy?: () => void } | undefined

function picker(items = CHARACTERS, label = 'Character map') {
  let state = EditorState.create({ doc: parseHtml('<p>hello</p>', { schema: coreSchema() }) })

  const host = document.createElement('div')
  document.body.appendChild(host)

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
  // On engines with popover, the panel is appended to document.body so the
  // toolbar's roving tabindex cannot find its buttons.
  return (host.querySelector('[role="grid"]') ??
    host.ownerDocument.querySelector('.ol-insert-grid[role="grid"]')) as HTMLElement
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

  it('does not swallow Tab, which used to close the panel on the first glyph', () => {
    const { host } = picker()
    trigger(host).click()
    const event = press(cells(host)[0]!, 'Tab')
    expect(event.defaultPrevented).toBe(false)
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true')
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
})
