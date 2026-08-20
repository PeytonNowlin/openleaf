/**
 * The toolbar's `custom` control type, and the alignment items.
 *
 * The view here is a stand-in object carrying the three members the toolbar
 * actually touches -- state, dispatch and focus. A real `EditorView` in jsdom
 * would be testing jsdom's contenteditable emulation, which is not a thing worth
 * knowing about; the keyboard and focus behaviour that needs a real engine is
 * tested in packages/element/test/e2e.
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDefaultItems } from '../src/items.js'
import { ToolbarOverflow } from '../src/overflow.js'
import { DEFAULT_LAYOUT, LAYOUT_WITH_COLOUR, registerToolbarItem } from '../src/registry.js'
import { Toolbar } from '../src/toolbar.js'

/*
 * Two sharp edges this fixture is shaped around, both worth knowing about before
 * writing another test here.
 *
 * `clearToolbarItems()` is not usable between tests in this file. It notifies
 * every live toolbar, which re-renders and warns about the ids it can no longer
 * find -- and `registerDefaultItems` is idempotent, so it will not repopulate what
 * was cleared. So the defaults are registered once and the registry is left
 * alone; registration is last-wins, which makes reusing an id across tests safe.
 *
 * Toolbars are destroyed after each test for the same reason: a live one is a
 * registry subscriber, and leaving twelve of them attached makes every later
 * assertion about a console call count meaningless.
 */
registerDefaultItems()

const mounted: Toolbar[] = []

function fakeView(html = '<p>hello</p>'): EditorView {
  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  // Select the whole paragraph text so mark commands have a range to decorate.
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
    focus: () => undefined,
  } as unknown as EditorView
}

function mount(
  layout: string,
  options: { host?: HTMLElement; html?: string } = {},
): { toolbar: Toolbar; host: HTMLElement; view: EditorView } {
  const host = options.host ?? document.createElement('div')
  document.body.appendChild(host)
  const toolbar = new Toolbar(host, document, { layout })
  mounted.push(toolbar)
  host.appendChild(toolbar.el)
  const view = fakeView(options.html)
  toolbar.mount(view)
  return { toolbar, host, view }
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  for (const toolbar of mounted.splice(0)) toolbar.destroy()
  vi.restoreAllMocks()
})

describe('custom controls', () => {
  function registerPicker(): { updates: number; destroyed: number } {
    const counters = { updates: 0, destroyed: 0 }
    registerToolbarItem({
      id: 'picker',
      type: 'custom',
      label: 'Picker',
      render: () => {
        const el = document.createElement('div')
        const trigger = document.createElement('button')
        trigger.className = 'ol-btn'
        trigger.setAttribute('aria-label', 'Picker')
        el.appendChild(trigger)
        return {
          el,
          update: () => {
            counters.updates += 1
          },
          destroy: () => {
            counters.destroyed += 1
          },
        }
      },
    })
    return counters
  }

  it('renders the element the item built', () => {
    registerPicker()
    const { toolbar } = mount('picker')
    expect(toolbar.el.querySelector('button.ol-btn')?.getAttribute('aria-label')).toBe('Picker')
  })

  it('drives it on every state change', () => {
    const counters = registerPicker()
    const { toolbar } = mount('picker')
    const before = counters.updates
    toolbar.update(fakeView().state)
    expect(counters.updates).toBeGreaterThan(before)
  })

  it('includes its trigger in the roving tabindex', () => {
    // The whole reason the contract requires exactly one `button.ol-btn`: that is
    // what the toolbar walks, so a control that does not provide one is
    // unreachable by keyboard.
    registerPicker()
    const { toolbar } = mount('picker')
    expect(toolbar.el.querySelector<HTMLButtonElement>('button.ol-btn')?.tabIndex).toBe(0)
  })

  it('reflects readonly onto the trigger without the control asking', () => {
    registerPicker()
    const host = document.createElement('div')
    host.setAttribute('readonly', '')
    const { toolbar } = mount('picker', { host })
    toolbar.update(fakeView().state)
    expect(toolbar.el.querySelector('button.ol-btn')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('destroys it, so a popover it owns cannot outlive the toolbar', () => {
    const counters = registerPicker()
    const { toolbar } = mount('picker')
    toolbar.destroy()
    expect(counters.destroyed).toBe(1)
  })

  it('warns and skips a custom item with no render function', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registerToolbarItem({ id: 'broken', type: 'custom', label: 'Broken' })
    const { toolbar } = mount('broken')
    expect(toolbar.el.querySelectorAll('button')).toHaveLength(0)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('survives a render that throws, and keeps the other controls', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerToolbarItem({
      id: 'explodes',
      type: 'custom',
      label: 'Explodes',
      render: () => {
        throw new Error('boom')
      },
    })
    const { toolbar } = mount('explodes bold')
    // Bold is still there. A third-party colour picker must not be able to take
    // Undo and Save down with it.
    expect(toolbar.el.querySelector('[data-ol-id="bold"]')).not.toBeNull()
    expect(error).toHaveBeenCalledOnce()
  })

  it('survives an update that throws, reporting it once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerToolbarItem({
      id: 'picker',
      type: 'custom',
      label: 'Picker',
      render: () => ({
        el: document.createElement('div'),
        update: () => {
          throw new Error('boom')
        },
      }),
    })
    const { toolbar } = mount('picker')
    toolbar.update(fakeView().state)
    toolbar.update(fakeView().state)
    // Once per item and callback, however many transactions follow: a predicate
    // that throws every keystroke would otherwise bury the one useful stack.
    expect(error).toHaveBeenCalledOnce()
  })

  it('warns and skips a select item missing its contract', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registerToolbarItem({ id: 'dropdown', type: 'select', label: 'Dropdown' })
    const { toolbar } = mount('dropdown')
    expect(toolbar.el.querySelector('select')).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('select controls', () => {
  it('renders font family, size and line height in the default layout', () => {
    const { toolbar } = mount(DEFAULT_LAYOUT)
    expect(toolbar.el.querySelector('[data-ol-id="fontFamily"]')).not.toBeNull()
    expect(toolbar.el.querySelector('[data-ol-id="fontSize"]')).not.toBeNull()
    expect(toolbar.el.querySelector('[data-ol-id="lineHeight"]')).not.toBeNull()
    expect(toolbar.el.querySelector('[data-ol-id="indent"]')).not.toBeNull()
    expect(toolbar.el.querySelector('[data-ol-id="outdent"]')).not.toBeNull()
  })

  it('applies a font family from the select', () => {
    const { toolbar, view } = mount('fontFamily')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
    expect(select).not.toBeNull()
    select!.value = 'Georgia'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(serializeHtml(view.state.doc)).toContain('font-family:Georgia')
  })

  it('keeps multi-word families matched after validation quotes them', () => {
    const { toolbar, view } = mount('fontFamily')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
    const quoted = '"Times New Roman"'
    expect([...select!.options].some((option) => option.value === quoted)).toBe(true)
    select!.value = quoted
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    toolbar.update(view.state)
    expect(select!.value).toBe(quoted)
  })

  it('reflects an active font size, including values outside the presets', () => {
    const { toolbar } = mount('fontSize', {
      html: '<p><span style="font-size:15px">hello</span></p>',
    })
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontSize"]')
    expect(select?.value).toBe('15px')
    expect([...select!.options].some((option) => option.value === '15px')).toBe(true)
  })

  it('indents the current block', () => {
    const { toolbar, view } = mount('indent')
    toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="indent"]')?.click()
    expect(serializeHtml(view.state.doc)).toContain('padding-inline-start')
  })
})

describe('the alignment items', () => {
  it('are registered as toggles with the alignment they apply', () => {
    const { toolbar } = mount('alignLeft alignCenter alignRight alignJustify')
    const labels = [...toolbar.el.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['Align left', 'Align centre', 'Align right', 'Justify'])
    for (const button of toolbar.el.querySelectorAll('button')) {
      expect(button.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('reports the alignment in force as pressed', () => {
    const { toolbar } = mount('alignCenter', { html: '<p style="text-align:center">hi</p>' })
    expect(toolbar.el.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('are in the default layout, and colour deliberately is not', () => {
    expect(DEFAULT_LAYOUT).toContain('alignLeft alignCenter alignRight alignJustify')
    expect(DEFAULT_LAYOUT).toContain('fontFamily fontSize lineHeight')
    expect(DEFAULT_LAYOUT).toContain('indent outdent')
    // The picker ships in an opt-in bundle, and naming an unregistered item logs a
    // warning for every deployment that did not load it.
    expect(DEFAULT_LAYOUT).not.toContain('textColour')
    expect(LAYOUT_WITH_COLOUR).toContain('textColour highlightColour')
  })
})

describe('the overflow menu', () => {
  /*
   * Two selects in the menu, and the second one chosen.
   *
   * The forwarding used to find its target with `querySelector('select')` -- the
   * FIRST select in the bar. With only block type that was right by accident;
   * with a font family beside it, choosing a family applied a heading instead.
   * The lookup is by `data-ol-id` now, and this is what holds it there.
   */
  it('forwards a chosen value to its own control, not the first select', () => {
    const { toolbar, host } = mount('blockType fontFamily | bold')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    for (const group of toolbar.el.querySelectorAll<HTMLElement>(':scope > .ol-group')) {
      group.hidden = true
    }
    const more = toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')
    more!.hidden = false
    more!.click()

    const blockOriginal = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')
    const fontOriginal = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
    expect(blockOriginal).not.toBeNull()
    expect(fontOriginal).not.toBeNull()
    const blockBefore = blockOriginal!.value

    const fontClone = host.querySelector<HTMLSelectElement>(
      '.ol-overflow-menu select[data-ol-id="fontFamily"]',
    )
    expect(fontClone).not.toBeNull()
    fontClone!.value = 'Georgia'
    fontClone!.dispatchEvent(new Event('change', { bubbles: true }))

    expect(fontOriginal!.value).toBe('Georgia')
    // The block-type control must be untouched: it is the one the old lookup hit.
    expect(blockOriginal!.value).toBe(blockBefore)
    overflow.destroy()
  })

  it('rebuilds select clones when opened so they match current state', () => {
    const { toolbar, host } = mount('fontFamily | bold')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    // Force groups into overflow without depending on jsdom layout metrics.
    // layout() just un-hid them; hide again so fillMenu has something to clone.
    for (const group of toolbar.el.querySelectorAll<HTMLElement>(':scope > .ol-group')) {
      group.hidden = true
    }

    const original = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
    expect(original).not.toBeNull()
    original!.value = 'Georgia'

    const more = toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')
    expect(more).not.toBeNull()
    more!.hidden = false
    more!.click()

    const clone = host.querySelector<HTMLSelectElement>(
      '.ol-overflow-menu select[data-ol-id="fontFamily"]',
    )
    expect(clone?.value).toBe('Georgia')

    original!.value = 'Arial'
    // Close then reopen: the clone must pick up the new value.
    more!.click()
    more!.click()
    const refreshed = host.querySelector<HTMLSelectElement>(
      '.ol-overflow-menu select[data-ol-id="fontFamily"]',
    )
    expect(refreshed?.value).toBe('Arial')
    overflow.destroy()
  })
})
