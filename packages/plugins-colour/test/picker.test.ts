/**
 * The colour picker's construction and its palette.
 *
 * Focus movement, arrow-key navigation in the grid and the popover's own
 * dismissal are tested against real engines in
 * packages/element/test/e2e/format.spec.ts -- jsdom has no layout, so a popover's
 * position and a `focusout` race are not things it can tell you about. What is
 * worth checking here is the wiring: that the control applies the command it was
 * given, reflects the colour in force, and cleans up after itself.
 */

import {
  activeTextColor,
  clearTextColor,
  coreSchema,
  parseHtml,
  serializeHtml,
  setTextColor,
} from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, PALETTE_COLUMNS, nameFor } from '../src/palette.js'
import { buildColorPicker } from '../src/picker.js'

function picker(html = '<p>hello</p>') {
  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  // Selected throughout, because a colour command with an empty cursor writes
  // stored marks and leaves the document alone -- correct, and not what these
  // tests are about.
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
  )

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

  const control = buildColorPicker(
    { view, host },
    {
      label: 'Text colour',
      icon: 'textColour',
      palette: DEFAULT_PALETTE,
      active: activeTextColor,
      apply: setTextColor,
      clear: clearTextColor,
    },
  )
  host.appendChild(control.el)
  control.update?.(state)

  return {
    control,
    host,
    refresh: () => control.update?.(state),
    serialize: () => serializeHtml(state.doc),
  }
}

function trigger(host: HTMLElement): HTMLButtonElement {
  return host.querySelector('button.ol-btn') as HTMLButtonElement
}

function popover(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.ol-color-pop')
}

describe('the palette', () => {
  it('names every colour, and names them uniquely', () => {
    // The name is the button's accessible name and its tooltip. Two swatches with
    // the same name are indistinguishable to a screen reader, and a swatch with no
    // name is unusable by one.
    const names = DEFAULT_PALETTE.map((s) => s.name)
    expect(names.every((n) => n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('fills whole rows, so the grid has no gaps to arrow into', () => {
    expect(DEFAULT_PALETTE.length % PALETTE_COLUMNS).toBe(0)
  })

  it('uses six-digit hex, which is what the native colour input accepts', () => {
    for (const swatch of DEFAULT_PALETTE) {
      expect(swatch.value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('names a colour it knows, and reports an unknown one as itself', () => {
    expect(nameFor(DEFAULT_PALETTE, '#dc2626')).toBe('Red')
    expect(nameFor(DEFAULT_PALETTE, '#DC2626')).toBe('Red')
    expect(nameFor(DEFAULT_PALETTE, '#123456')).toBe('#123456')
    expect(nameFor(DEFAULT_PALETTE, null)).toBeNull()
  })
})

describe('the control', () => {
  it('announces itself as a collapsed popover trigger', () => {
    const { host } = picker()
    expect(trigger(host).getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
    expect(trigger(host).getAttribute('aria-label')).toBe('Text colour')
  })

  it('keeps the grid out of the element it puts in the toolbar', () => {
    // The toolbar's roving tabindex walks every `button.ol-btn` inside itself. The
    // grid's 32 buttons must not be found there, or one tab stop becomes 33.
    const { control } = picker()
    expect(control.el.querySelectorAll('button')).toHaveLength(1)
  })

  it('is not in the document until it is opened', () => {
    const { host } = picker()
    expect(popover(host)).toBeNull()
  })

  it('applies the colour of the swatch that was clicked', () => {
    const { host, serialize } = picker()
    trigger(host).click()
    popover(host)?.querySelector<HTMLButtonElement>('[data-ol-colour="#dc2626"]')?.click()
    expect(serialize()).toBe('<p><span style="color:#dc2626">hello</span></p>')
  })

  it('closes after a choice', () => {
    const { host } = picker()
    trigger(host).click()
    popover(host)?.querySelector<HTMLButtonElement>('[data-ol-colour="#dc2626"]')?.click()
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('removes the colour', () => {
    const { host, serialize } = picker('<p><span style="color:#dc2626">hello</span></p>')
    trigger(host).click()
    popover(host)?.querySelector<HTMLButtonElement>('.ol-color-clear')?.click()
    expect(serialize()).toBe('<p>hello</p>')
  })

  it('marks the colour in force as the pressed swatch', () => {
    const { host, refresh } = picker('<p><span style="color:#dc2626">hello</span></p>')
    trigger(host).click()
    refresh()
    const pressed = popover(host)?.querySelectorAll('[aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed?.[0]?.getAttribute('data-ol-colour')).toBe('#dc2626')
  })

  it('refuses to open on a readonly editor', () => {
    const { host } = picker()
    host.setAttribute('readonly', '')
    trigger(host).click()
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('takes its popover with it when destroyed', () => {
    const { host, control } = picker()
    trigger(host).click()
    expect(popover(host)).not.toBeNull()
    control.destroy?.()
    expect(popover(host)).toBeNull()
  })
})

describe('installing', () => {
  it('registers both controls, once, and does not touch the layout', async () => {
    const { getToolbarItem, DEFAULT_LAYOUT } = await import('@openleaf-editor/ui')
    const { installColourPicker } = await import('../src/index.js')

    installColourPicker()
    // Idempotent: a bundle loaded twice, which happens in CMS templates more often
    // than anyone would like, must not produce two sets of controls.
    installColourPicker()

    for (const id of ['textColour', 'highlightColour']) {
      const item = getToolbarItem(id)
      expect(item?.type).toBe('custom')
      expect(item?.render).toBeTypeOf('function')
    }

    // Installing a plugin must never silently rearrange somebody's toolbar; that
    // is the whole reason capability and layout are separate concerns.
    expect(DEFAULT_LAYOUT).not.toContain('textColour')
  })
})
