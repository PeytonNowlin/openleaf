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
import { clearToolbarItems } from '../src/testing.js'
import { Toolbar } from '../src/toolbar.js'

/*
 * Two sharp edges this fixture is shaped around, both worth knowing about before
 * writing another test here.
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

describe('a button with a keyboard shortcut', () => {
  /*
   * Per accname, `title` becomes the DESCRIPTION when an element already has a
   * name. `title="Bold (Ctrl+B)"` beside `aria-label="Bold"` therefore made
   * NVDA say "Bold, button, Bold Ctrl+B" -- the label read twice, with the
   * shortcut smuggled in as prose. `aria-keyshortcuts` is the attribute that
   * exists to carry it.
   */
  it('carries the shortcut in aria-keyshortcuts, not in a doubling title', () => {
    const { toolbar } = mount('bold')
    const bold = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="bold"]')
    expect(bold?.getAttribute('aria-label')).toBe('Bold')
    expect(bold?.getAttribute('aria-keyshortcuts')).toBe('Control+B')
    // Identical to the name, so accname drops it rather than reading it again.
    expect(bold?.title).toBe('Bold')
  })

  it('leaves the attribute off a control that has no shortcut', () => {
    const { toolbar } = mount('source')
    const source = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="source"]')
    expect(source?.hasAttribute('aria-keyshortcuts')).toBe(false)
  })

  it('spells a multi-modifier shortcut the way aria-keyshortcuts requires', () => {
    const { toolbar } = mount('bulletList')
    const list = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="bulletList"]')
    expect(list?.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+8')
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
  /**
   * jsdom has no layout, so the measurement the panel is driven by has to be
   * supplied. Two groups at 200 against a budget of 250 puts exactly one of them
   * in the panel, which is the interesting case: something in, something out.
   */
  function forceOverflow(toolbar: Toolbar, host: HTMLElement): ToolbarOverflow {
    Object.defineProperty(toolbar.el, 'clientWidth', { get: () => 250, configurable: true })
    Object.defineProperty(toolbar.el, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelectorAll(':scope > .ol-group').length * 200
      },
    })
    return new ToolbarOverflow(toolbar.el, host, document)
  }

  function panel(host: HTMLElement): HTMLElement {
    const el = host.querySelector<HTMLElement>('.ol-overflow-menu')
    if (!el) throw new Error('no overflow panel')
    return el
  }

  function press(target: Element, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }

  /*
   * The clone is gone, and with it three bugs that only existed because there
   * were two of everything: a forwarded click that carried no value, a lookup
   * that found the wrong control, and a copy that went stale when the caret
   * moved. The control in the panel IS the control, which is not a thing that
   * can be got wrong later.
   */
  it('moves the real control into the panel rather than a copy of it', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)

    const inPanel = panel(host).querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
    expect(inPanel).not.toBeNull()
    // Not a second copy left behind in the bar.
    expect(toolbar.el.querySelectorAll('[data-ol-id="fontFamily"]')).toHaveLength(0)

    inPanel!.value = 'Georgia'
    inPanel!.dispatchEvent(new Event('change', { bubbles: true }))
    // The control still owns its own listener, so the value applied itself.
    expect(inPanel!.value).toBe('Georgia')
    overflow.destroy()
    // Destroying puts the bar back the way it was found.
    expect(toolbar.el.querySelectorAll('[data-ol-id="fontFamily"]')).toHaveLength(1)
  })

  it('sits immediately after the bar, not at the end of the editor', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    // The editable region, which is what the panel used to be appended after.
    host.appendChild(document.createElement('div'))
    const overflow = forceOverflow(toolbar, host)
    // Appended to the host it landed after the editable region, so Tab from
    // More walked into the content instead of into the panel.
    expect(toolbar.el.nextElementSibling).toBe(panel(host))
    overflow.destroy()
  })

  it('opens on the trigger and moves focus into the panel', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)
    const more = toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!
    expect(panel(host).hidden).toBe(true)

    more.click()

    expect(panel(host).hidden).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.getAttribute('aria-controls')).toBe(panel(host).id)
    // Opening a popup and leaving focus behind it is the same as not opening it.
    expect(panel(host).contains(document.activeElement)).toBe(true)
    overflow.destroy()
  })

  it('is one tab stop while it is open', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)
    toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!.click()

    const items = [...panel(host).querySelectorAll<HTMLElement>('button.ol-btn, select.ol-select')]
    expect(items.length).toBeGreaterThan(1)
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1)
    overflow.destroy()
  })

  it('moves between controls on the arrow keys', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily italic')
    const overflow = forceOverflow(toolbar, host)
    toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!.click()

    const items = [...panel(host).querySelectorAll<HTMLElement>('button.ol-btn, select.ol-select')]
    const first = items[0]!
    const last = items[items.length - 1]!
    expect(document.activeElement).toBe(first)
    press(first, 'ArrowDown')
    expect(document.activeElement).toBe(items[1])
    press(items[1]!, 'ArrowUp')
    expect(document.activeElement).toBe(first)
    press(last, 'Home')
    expect(document.activeElement).toBe(first)
    press(first, 'ArrowUp')
    // Wraps, the way the bar it came from does.
    expect(document.activeElement).toBe(last)
    overflow.destroy()
  })

  /*
   * The same bargain the bar strikes, turned ninety degrees: the panel takes the
   * keys it needs to be a widget, and leaves the select the ones it needs to be
   * a select. Home and End are the select's own first and last option.
   */
  it('leaves Home and End to a select', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily italic')
    const overflow = forceOverflow(toolbar, host)
    toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!.click()

    const items = [...panel(host).querySelectorAll<HTMLElement>('button.ol-btn, select.ol-select')]
    const select = items.find((el) => el.tagName === 'SELECT')!
    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
    select.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(false)
    // And the panel is genuinely listening on the same element, so the pass
    // through above is a decision rather than the absence of a handler.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    select.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    overflow.destroy()
  })

  it('closes on Escape and puts focus back on the trigger', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)
    const more = toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!
    more.click()

    press(document.activeElement!, 'Escape')

    expect(panel(host).hidden).toBe(true)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    // Not the document: a panel that dumps focus at the top of the page has not
    // returned the author to where they were.
    expect(document.activeElement).toBe(more)
    overflow.destroy()
  })

  it('closes on Tab rather than letting focus walk out of an open panel', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)
    const more = toolbar.el.querySelector<HTMLButtonElement>('.ol-overflow-more')!
    more.click()

    press(document.activeElement!, 'Tab')

    expect(panel(host).hidden).toBe(true)
    expect(document.activeElement).toBe(more)
    overflow.destroy()
  })

  it('gives the panel a role with a content model that fits what is in it', () => {
    const { toolbar, host } = mount('bold | blockType fontFamily')
    const overflow = forceOverflow(toolbar, host)
    // Not role="menu": a menu owns menuitem children, and four of the default
    // bar's controls are <select>, which is not one.
    expect(panel(host).getAttribute('role')).toBe('toolbar')
    expect(panel(host).getAttribute('aria-orientation')).toBe('vertical')
    expect(panel(host).getAttribute('aria-label')).toBeTruthy()
    overflow.destroy()
  })
})

describe('registry reset', () => {
  it('can repopulate defaults after tests clear the registry', () => {
    for (const toolbar of mounted.splice(0)) toolbar.destroy()
    clearToolbarItems()
    registerDefaultItems()
    const { toolbar } = mount('undo blockType source')
    expect(toolbar.el.querySelectorAll('button, select')).toHaveLength(3)
  })
})
