/**
 * The toolbar's `custom` control type, and the alignment items.
 *
 * The view here is a stand-in object carrying the three members the toolbar
 * actually touches -- state, dispatch and focus. A real `EditorView` in jsdom
 * would be testing jsdom's contenteditable emulation, which is not a thing worth
 * knowing about; the keyboard and focus behaviour that needs a real engine is
 * tested in packages/element/test/e2e.
 */

import {
  coreSchema,
  parseDeclarations,
  parseHtml,
  serializeHtml,
  type FormatSpec,
} from '@openleaf-editor/core'
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
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
  options: { host?: HTMLElement; html?: string; formats?: readonly FormatSpec[] } = {},
): { toolbar: Toolbar; host: HTMLElement; view: EditorView } {
  const host = options.host ?? document.createElement('div')
  document.body.appendChild(host)
  // Spread, not `formats: options.formats`: exactOptionalPropertyTypes draws a
  // line between an absent optional property and one explicitly undefined.
  const toolbar = new Toolbar(host, document, {
    layout,
    ...(options.formats ? { formats: options.formats } : {}),
  })
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

describe('secondary toolbar', () => {
  it('marks toolbar2 so sticky CSS does not depend on sibling order', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const toolbar = new Toolbar(host, document, { layout: 'bold', label: 'More formatting' })
    const primary = new Toolbar(host, document, { layout: 'bold' })
    mounted.push(toolbar, primary)
    expect(toolbar.el.classList.contains('ol-toolbar--secondary')).toBe(true)
    expect(primary.el.classList.contains('ol-toolbar--secondary')).toBe(false)
  })
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

  it('selects a stored single-quoted family rather than showing Default', () => {
    // The schema rewrites single quotes to double quotes. Option values are
    // that same spelling, so a stored `'Times New Roman'` has to land on the
    // preset rather than the empty Default option -- which is the reported
    // symptom when the two sides disagree. `'21st Century'` is not a preset;
    // it still has to appear as the selected value, not Default, or an
    // inherited face looks cleared.
    const cases: Array<[string, string]> = [
      ["<p><span style=\"font-family:'Times New Roman'\">hello</span></p>", '"Times New Roman"'],
      ["<p><span style=\"font-family:'21st Century'\">hello</span></p>", '"21st Century"'],
      ['<p><span style="font-family:&quot;Goudy\'s Old Style&quot;">hello</span></p>', '"Goudy\'s Old Style"'],
    ]
    for (const [html, family] of cases) {
      const { toolbar, view } = mount('fontFamily', { html })
      const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="fontFamily"]')
      expect(select?.value, html).toBe(family)
      expect(select?.value, html).not.toBe('')

      let found: string | null = null
      view.state.doc.descendants((node) => {
        if (found !== null) return false
        const mark = node.marks.find((m) => m.type.name === 'font_family')
        if (mark) found = mark.attrs['family'] as string
        return true
      })
      expect(found, html).toBe(family)

      const host = document.createElement('div')
      host.innerHTML = serializeHtml(view.state.doc)
      const span = host.querySelector('span')
      expect(span, html).not.toBeNull()
      expect(parseDeclarations(span!.getAttribute('style')).get('font-family'), html).toBe(family)
    }
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

  it('relabels Insert image to Edit image when an image is selected', () => {
    const { toolbar, view } = mount('image', {
      html: '<p><img src="/a.png" alt="A goat"></p>',
    })
    const button = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="image"]')
    expect(button?.getAttribute('aria-label')).toBe('Insert image')
    let pos: number | null = null
    view.state.doc.descendants((node, at) => {
      if (pos === null && node.type.name === 'image') pos = at
      return pos === null
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos!)))
    toolbar.update(view.state)
    expect(button?.getAttribute('aria-label')).toBe('Edit image')
    expect(button?.title).toBe('Edit image')
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

describe('source mode', () => {
  /*
   * `setSourceMode(true)` promises that every control except `source` goes
   * unavailable, because in source view a formatting command runs against the
   * hidden document and leaving source view reparses the textarea over the
   * result -- so the edit is silently destroyed. Buttons and registered
   * `type: 'select'` items were covered; the block-type select was not, and it
   * is the one control that can restructure a whole block.
   */
  it('disables the block-type select, and lets it back out again', () => {
    const { toolbar } = mount('blockType source')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')!

    expect(select.disabled).toBe(false)

    toolbar.setSourceMode(true)
    expect(select.disabled).toBe(true)
    expect(select.getAttribute('aria-disabled')).toBe('true')

    toolbar.setSourceMode(false)
    expect(select.disabled).toBe(false)
    expect(select.getAttribute('aria-disabled')).toBe('false')
  })

  it('leaves the way out of source view operable', () => {
    const { toolbar } = mount('blockType source')
    toolbar.setSourceMode(true)
    const source = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="source"]')!
    expect(source.getAttribute('aria-disabled')).toBe('false')
  })

  it('does not format the hidden document when the select is driven anyway', () => {
    const { toolbar, view } = mount('blockType source')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')!
    toolbar.setSourceMode(true)

    const before = serializeHtml(view.state.doc)
    // A real disabled select cannot fire `change`; this is the synthetic event
    // an enhancer or a test could still deliver.
    select.value = '3'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    expect(serializeHtml(view.state.doc)).toBe(before)
  })

  it('disables Heading and Paragraph while the caret is in a figure caption', () => {
    const html =
      '<figure><img src="/a.png" alt="a"><figcaption>Caption text</figcaption></figure><p>after</p>'
    const { toolbar, view } = mount('blockType', { html })
    let pos: number | null = null
    view.state.doc.descendants((node, nodePos) => {
      if (node.type.name !== 'figcaption') return true
      pos = nodePos + 1
      return false
    })
    if (pos === null) throw new Error('expected a figcaption')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    toolbar.update(view.state)

    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')!
    expect(select.value).toBe('')
    expect([...select.options].find((option) => option.value === 'p')?.disabled).toBe(true)
    expect([...select.options].find((option) => option.value === '2')?.disabled).toBe(true)

    const before = serializeHtml(view.state.doc)
    select.value = '2'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(serializeHtml(view.state.doc)).toBe(before)
    expect(serializeHtml(view.state.doc)).toContain('<figure>')
  })

  it('keeps a format entry available when only its class half has work to do', () => {
    // `p.lead` over a paragraph converts nothing, and availability was decided
    // by the element half alone -- so the entry was disabled in exactly the
    // place an author reaches for it, and the class was unreachable.
    const formats: FormatSpec[] = [
      { token: 'p.lead', label: 'Lead' },
      { token: 'h2', label: 'Section' },
      { token: '.note', label: 'Note' },
    ]
    const { toolbar, view } = mount('blockType', { formats })
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')!
    const option = (value: string) => [...select.options].find((o) => o.value === value)!

    expect(option('format:p.lead').disabled).toBe(false)
    expect(option('format:h2').disabled).toBe(false)
    expect(option('format:.note').disabled).toBe(false)

    select.value = 'format:p.lead'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(serializeHtml(view.state.doc)).toContain('<p class="lead">')
  })

  it('leaves a class-free format entry disabled where its element command is', () => {
    // The figure guard: `h2` in a caption has no class to fall back on, so
    // enabling it would only strip the caption's own class.
    const formats: FormatSpec[] = [{ token: 'h2', label: 'Section' }]
    const html =
      '<figure><img src="/a.png" alt="a"><figcaption>Caption text</figcaption></figure><p>after</p>'
    const { toolbar, view } = mount('blockType', { html, formats })
    let pos: number | null = null
    view.state.doc.descendants((node, nodePos) => {
      if (node.type.name !== 'figcaption') return true
      pos = nodePos + 1
      return false
    })
    if (pos === null) throw new Error('expected a figcaption')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    toolbar.update(view.state)

    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="blockType"]')!
    expect([...select.options].find((o) => o.value === 'format:h2')!.disabled).toBe(true)
  })

  it('reaches a native select any custom control rendered, not just block type', () => {
    registerToolbarItem({
      id: 'nativeSelect',
      type: 'custom',
      label: 'Native select',
      render: () => {
        const el = document.createElement('select')
        el.className = 'ol-select'
        el.dataset['olId'] = 'nativeSelect'
        // The control tracks readonly on its own and knows nothing about source
        // mode -- which is every third-party control. It also runs AFTER the
        // toolbar used to write availability, so this is the clobber that made
        // fixing only the customs loop insufficient.
        return { el, update: () => { el.disabled = false } }
      },
    })
    const { toolbar } = mount('nativeSelect')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="nativeSelect"]')!

    toolbar.setSourceMode(true)
    expect(select.disabled).toBe(true)

    // And on every later transaction, not just the one that entered source mode.
    toolbar.update(fakeView().state)
    expect(select.disabled).toBe(true)
  })

  /*
   * Suspension can only take a control AWAY. A control's own `update` is the
   * authority on whether its command applies to this selection -- the table
   * grid disables its trigger when `canInsert` is false -- so a toolbar that
   * wrote "available" over that would show an enabled trigger for a command
   * that does nothing. Reported by Codex on #92; the first version of this fix
   * had exactly that regression.
   */
  it('does not re-enable a trigger the control itself disabled', () => {
    let enabled = false
    registerToolbarItem({
      id: 'stateful',
      type: 'custom',
      label: 'Stateful',
      render: () => {
        const el = document.createElement('div')
        const trigger = document.createElement('button')
        trigger.className = 'ol-btn'
        trigger.dataset['olId'] = 'stateful'
        el.appendChild(trigger)
        return {
          el,
          update: () => trigger.setAttribute('aria-disabled', enabled ? 'false' : 'true'),
        }
      },
    })
    const { toolbar } = mount('stateful')
    const trigger = toolbar.el.querySelector<HTMLElement>('[data-ol-id="stateful"]')!

    toolbar.update(fakeView().state)
    expect(trigger.getAttribute('aria-disabled')).toBe('true')

    // Source mode and back: the control still says unavailable, so it must
    // still read unavailable.
    toolbar.setSourceMode(true)
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
    toolbar.setSourceMode(false)
    expect(trigger.getAttribute('aria-disabled')).toBe('true')

    // And when the control changes its mind, the toolbar is not in the way.
    enabled = true
    toolbar.update(fakeView().state)
    expect(trigger.getAttribute('aria-disabled')).toBe('false')
  })

  it('does not re-enable a select the control itself disabled', () => {
    let usable = false
    registerToolbarItem({
      id: 'statefulSelect',
      type: 'custom',
      label: 'Stateful select',
      render: () => {
        const el = document.createElement('select')
        el.dataset['olId'] = 'statefulSelect'
        return { el, update: () => { el.disabled = !usable } }
      },
    })
    const { toolbar } = mount('statefulSelect')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="statefulSelect"]')!

    toolbar.setSourceMode(true)
    expect(select.disabled).toBe(true)
    toolbar.setSourceMode(false)
    // The control's own answer, not the toolbar's release.
    expect(select.disabled).toBe(true)

    usable = true
    toolbar.update(fakeView().state)
    expect(select.disabled).toBe(false)
  })

  it('restores a control that has no update of its own', () => {
    registerToolbarItem({
      id: 'staticSelect',
      type: 'custom',
      label: 'Static select',
      render: () => {
        const el = document.createElement('select')
        el.dataset['olId'] = 'staticSelect'
        // No `update`: nothing will put `disabled` back but the toolbar itself.
        return { el }
      },
    })
    const { toolbar } = mount('staticSelect')
    const select = toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="staticSelect"]')!

    toolbar.setSourceMode(true)
    expect(select.disabled).toBe(true)
    toolbar.setSourceMode(false)
    expect(select.disabled).toBe(false)
    expect(select.getAttribute('aria-disabled')).toBe('false')
  })

  it('disables a native custom select under readonly too', () => {
    const host = document.createElement('div')
    host.setAttribute('readonly', '')
    registerToolbarItem({
      id: 'nativeSelect',
      type: 'custom',
      label: 'Native select',
      render: () => {
        const el = document.createElement('select')
        el.dataset['olId'] = 'nativeSelect'
        return { el }
      },
    })
    const { toolbar } = mount('nativeSelect', { host })
    toolbar.update(fakeView().state)
    expect(
      toolbar.el.querySelector<HTMLSelectElement>('[data-ol-id="nativeSelect"]')!.disabled,
    ).toBe(true)
  })
})

describe('group dividers', () => {
  /*
   * The divider is a border on the group -- `.ol-group + .ol-group` in css.ts --
   * so the two groups have to be ADJACENT siblings for it to draw. The renderer
   * used to put an `.ol-sep` div between them, which made the selector
   * unmatchable: no divider rendered in any theme, and each bar carried inert
   * empty divs. These tests pin the adjacency rather than the appearance,
   * because the appearance is what a jsdom test cannot see.
   */
  it('puts nothing between two groups, so the divider selector can match', () => {
    const { toolbar } = mount('bold | italic')
    const groups = [...toolbar.el.querySelectorAll(':scope > .ol-group')]
    expect(groups).toHaveLength(2)
    expect(groups[1]!.matches('.ol-group + .ol-group')).toBe(true)
  })

  it('leaves no separator elements in the bar at all', () => {
    const { toolbar } = mount('bold | italic | underline')
    expect(toolbar.el.querySelectorAll('.ol-sep')).toHaveLength(0)
    // Every child is a group. An unstyled 0x0 flex item is not free: it is a
    // thing a theme author has to discover is inert.
    for (const child of toolbar.el.children) {
      expect(child.classList.contains('ol-group')).toBe(true)
    }
  })

  it('collapses a doubled bar to one divider rather than two', () => {
    const { toolbar } = mount('bold | | italic')
    expect(toolbar.el.querySelectorAll(':scope > .ol-group')).toHaveLength(2)
  })

  it('does not open the bar with a stray divider', () => {
    const { toolbar } = mount('| bold')
    const groups = [...toolbar.el.querySelectorAll(':scope > .ol-group')]
    expect(groups).toHaveLength(1)
    expect(groups[0]!.matches('.ol-group + .ol-group')).toBe(false)
  })

  it('keeps the remaining groups adjacent when one moves into the More panel', () => {
    const { toolbar, host } = mount('bold | italic | blockType fontFamily')
    Object.defineProperty(toolbar.el, 'clientWidth', { get: () => 250, configurable: true })
    Object.defineProperty(toolbar.el, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelectorAll(':scope > .ol-group').length * 200
      },
    })
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    const groups = [...toolbar.el.querySelectorAll(':scope > .ol-group')]
    // Whatever is left in the bar is still contiguous, so a group whose
    // neighbour left cannot be left drawing a rule against nothing.
    for (const [index, group] of groups.entries()) {
      expect(group.matches('.ol-group + .ol-group')).toBe(index > 0)
    }
  })
})

describe('the overflow fit loop', () => {
  /**
   * A bar with fully measurable geometry, which jsdom does not otherwise give:
   * every `offsetWidth` there is 0, so the fit arithmetic is invisible.
   *
   * `scrollWidth` is a getter over the groups CURRENTLY in the bar, the way the
   * real one behaves, so the loop's own writes are reflected back at it.
   */
  function measurable(
    toolbar: Toolbar,
    { budget, groupWidth, moreWidth }: { budget: number; groupWidth: number; moreWidth: number },
  ): { setMoreWidth: (next: number) => void } {
    let currentMoreWidth = moreWidth
    Object.defineProperty(toolbar.el, 'clientWidth', { get: () => budget, configurable: true })
    const more = toolbar.el.querySelector<HTMLElement>('.ol-overflow-more')
    Object.defineProperty(toolbar.el, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        const groups = this.querySelectorAll(':scope > .ol-group').length * groupWidth
        // A real bar's scroll width counts the trigger once it is visible, and
        // the loop reveals it before measuring -- so the stub has to as well,
        // or the arithmetic under test is not the arithmetic that runs.
        return groups + (more && !more.hidden ? currentMoreWidth : 0)
      },
    })
    for (const group of toolbar.el.querySelectorAll(':scope > .ol-group')) {
      Object.defineProperty(group, 'offsetWidth', { get: () => groupWidth, configurable: true })
    }
    if (more) {
      Object.defineProperty(more, 'offsetWidth', {
        configurable: true,
        get: () => (more.hidden ? 0 : currentMoreWidth),
      })
    }
    return {
      setMoreWidth: (next: number) => {
        currentMoreWidth = next
      },
    }
  }

  function groupsInBar(toolbar: Toolbar): number {
    return toolbar.el.querySelectorAll(':scope > .ol-group').length
  }

  /*
   * The loop decided how many groups to move using only the groups' widths and
   * the gaps. Once at least one group has left, the previously-hidden More
   * button is revealed and takes a width and a gap of its own in the row --
   * which was never counted. So a bar could move exactly enough groups for the
   * remainder to fit, reveal the trigger, and be over budget again: it settled
   * only on the next ResizeObserver pass, with a visible flash in between.
   *
   * 3 groups x 100 in a 250 budget, with a 60-wide trigger. Moving one group
   * leaves 200, which fits -- until the trigger makes it 260.
   */
  it('counts the More trigger it is about to reveal', () => {
    const { toolbar, host } = mount('bold | italic | underline')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    measurable(toolbar, { budget: 250, groupWidth: 100, moreWidth: 60 })
    overflow.layout()

    const more = toolbar.el.querySelector<HTMLElement>('.ol-overflow-more')!
    expect(more.hidden).toBe(false)
    // One group left in the bar: 100 + 60 = 160, inside 250. Two would be
    // 200 + 60 = 260, which is the overflow the old arithmetic shipped.
    expect(groupsInBar(toolbar)).toBe(1)
    overflow.destroy()
  })

  it('is idempotent, so a second pass moves nothing more', () => {
    const { toolbar, host } = mount('bold | italic | underline')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    measurable(toolbar, { budget: 250, groupWidth: 100, moreWidth: 60 })
    overflow.layout()
    const settled = groupsInBar(toolbar)
    overflow.layout()
    // A loop that converges only on the next resize pass is the flash.
    expect(groupsInBar(toolbar)).toBe(settled)
    overflow.destroy()
  })

  /*
   * The trigger's footprint must not be charged to a bar that does not need it.
   * Counting it unconditionally would collapse a group to make room for a
   * button that was never going to be shown.
   */
  /*
   * The width follows `--openleaf-button-size`, which a skin or an integrator
   * token changes at runtime -- compact is 28px, the default 32px,
   * coarse-pointer styling 40px. A width pinned at first layout goes quietly
   * wrong on the next density change, and near a fit threshold that either
   * leaves the revealed row overflowing or hides a group it did not need to.
   * Reported by Codex on #98; the first version of this fix cached it.
   */
  it('re-measures the trigger when density changes', () => {
    const { toolbar, host } = mount('bold | italic | underline')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    const bar = measurable(toolbar, { budget: 250, groupWidth: 100, moreWidth: 20 })

    // 3 x 100 = 300 over budget; move one, 200 + 20 = 220 fits.
    overflow.layout()
    expect(groupsInBar(toolbar)).toBe(2)

    // The trigger grows. 200 + 60 = 260 no longer fits, so another group goes.
    bar.setMoreWidth(60)
    overflow.layout()
    expect(groupsInBar(toolbar)).toBe(1)

    // And shrinking it gives the group back rather than staying pessimistic.
    bar.setMoreWidth(20)
    overflow.layout()
    expect(groupsInBar(toolbar)).toBe(2)
    overflow.destroy()
  })

  it('does not charge for a trigger it will not reveal', () => {
    const { toolbar, host } = mount('bold | italic')
    const overflow = new ToolbarOverflow(toolbar.el, host, document)
    // 2 groups x 100 = 200, comfortably inside 250 -- but 200 + 60 is not.
    measurable(toolbar, { budget: 250, groupWidth: 100, moreWidth: 60 })
    overflow.layout()

    expect(toolbar.el.querySelector<HTMLElement>('.ol-overflow-more')!.hidden).toBe(true)
    expect(groupsInBar(toolbar)).toBe(2)
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
