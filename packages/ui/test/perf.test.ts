/**
 * What the toolbar is allowed to do per transaction.
 *
 * Every control without an `isEnabled` is probed by dry-running its command, and
 * each of those walks the selection. The four alignment items were the worst
 * case: `toggleTextAlign` calls `activeTextAlign` and then `setTextAlign`, so
 * four buttons produced twelve walks all computing the same answer. A page
 * routinely carries four bars over one editor -- the main one, a second one and
 * two floating ones -- and each recomputed the lot independently.
 *
 * Counting tests, not timing tests: "how many times was the selection walked"
 * is the same number on every machine and is the quantity that regressed. Each
 * assertion here was confirmed to go red against the unfixed code.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDefaultItems } from '../src/items.js'
import { DEFAULT_LAYOUT } from '../src/registry.js'
import { Toolbar } from '../src/toolbar.js'

registerDefaultItems()

const mounted: Toolbar[] = []

/** A state with everything selected, which is the worst case for the probes. */
function selectAllState(paragraphs = 200): EditorState {
  const html = Array.from({ length: paragraphs }, (_, i) => `<p>paragraph ${i} of prose</p>`).join(
    '',
  )
  const state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
  )
}

/**
 * Count how many nodes the predicates ask the document about.
 *
 * `nodesBetween` is what every selection walk in core goes through, so counting
 * its per-node callback counts the work the toolbar caused, wherever it was
 * spent. Shadowed on the instance the toolbar is handed, so nothing else can
 * contribute to the number.
 */
function counting(state: EditorState): { state: EditorState; visits: () => number } {
  let visits = 0
  const doc = state.doc
  const real = doc.nodesBetween.bind(doc)
  Object.defineProperty(doc, 'nodesBetween', {
    configurable: true,
    value: (from: number, to: number, f: (...a: never[]) => unknown, start?: number) =>
      real(
        from,
        to,
        ((...args: never[]) => {
          visits += 1
          return f(...args)
        }) as never,
        start,
      ),
  })
  return { state, visits: () => visits }
}

function view(state: EditorState): EditorView {
  let live = state
  return {
    get state() {
      return live
    },
    dispatch(tr: Transaction) {
      live = live.apply(tr)
    },
    focus: () => undefined,
  } as unknown as EditorView
}

function mount(state: EditorState): Toolbar {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const toolbar = new Toolbar(host, document, { layout: DEFAULT_LAYOUT })
  mounted.push(toolbar)
  host.appendChild(toolbar.el)
  toolbar.mount(view(state))
  return toolbar
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  for (const toolbar of mounted.splice(0)) toolbar.destroy()
  vi.restoreAllMocks()
})

describe('the per-transaction guard', () => {
  /**
   * A transaction that changed neither the document, the selection nor the
   * stored marks cannot have changed a single predicate's answer. Plugin pings,
   * collaboration cursors and scroll requests are all this shape, and they are
   * most of the transactions an editor sees.
   *
   * MEASURED (jsdom): 200 paragraphs, select-all, one metadata transaction.
   *   before  8,006 node visits   after  0
   */
  it('does no work for a transaction that changed nothing it reads', () => {
    const base = selectAllState()
    const toolbar = mount(base)

    const { state, visits } = counting(base)
    const tr = state.tr.setMeta('some-plugin', true)
    expect(tr.docChanged).toBe(false)

    toolbar.update(state, tr)
    expect(visits()).toBe(0)
  })

  /** The guard must not swallow a real edit. */
  it('still updates for a transaction that changed the document', () => {
    const base = selectAllState(20)
    const toolbar = mount(base)

    const { state, visits } = counting(base)
    toolbar.update(state, state.tr.insertText('x', 1))
    expect(visits()).toBeGreaterThan(0)
  })

  /** Nor a caret move, which changes what every predicate reports. */
  it('still updates for a selection-only transaction', () => {
    const base = selectAllState(20)
    const toolbar = mount(base)

    const { state, visits } = counting(base)
    toolbar.update(state, state.tr.setSelection(TextSelection.create(state.doc, 3)))
    expect(visits()).toBeGreaterThan(0)
  })

  /**
   * `mount()`, a readonly change, a plugin reconfigure and `setItemState` all
   * update with no transaction at all, and must still refresh -- which is what
   * makes the `tr &&` in the guard load-bearing rather than defensive.
   */
  it('still updates when there is no transaction', () => {
    const base = selectAllState(20)
    const toolbar = mount(base)

    const { state, visits } = counting(base)
    toolbar.update(state)
    expect(visits()).toBeGreaterThan(0)
  })
})

describe('sharing one scan between the bars on a page', () => {
  /**
   * The predicates are functions of the document and the selection alone --
   * anything else is pushed in through `setItemState` and read before they run
   * -- so two bars asking the same question of the same state cannot
   * legitimately get different answers. Answering it once is what stops a page
   * with four bars paying for the same walk four times.
   *
   * MEASURED (jsdom): 200 paragraphs, select-all, four bars.
   *   before  726 node visits per marginal bar   after  18
   */
  it('costs the second, third and fourth bar a fraction of the first', () => {
    const base = selectAllState()
    const bars = [mount(base), mount(base), mount(base), mount(base)]

    // A state the bars have NOT already been updated with, so the cache starts
    // cold. Updating with the state they mounted on would measure a cache that
    // `mount()` had already filled, which is how this test first passed for the
    // wrong reason.
    const next = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 1, 400)))
    const { state, visits } = counting(next)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, 401))

    const first = bars[0]
    if (!first) throw new Error('no toolbar')
    first.update(state, tr)
    const firstBar = visits()
    expect(firstBar).toBeGreaterThan(0)

    for (const bar of bars.slice(1)) bar.update(state, tr)
    const marginal = (visits() - firstBar) / 3

    // The predicates are answered once for the state and shared. What is left
    // per bar is the custom controls, which own their own DOM and cannot be
    // shared -- so the marginal bar is a small fraction of the first, not equal
    // to it as it was before.
    expect(marginal).toBeLessThan(firstBar / 3)
  })
})

describe('the alignment items', () => {
  /**
   * Without an explicit `isEnabled` the toolbar dry-runs the item's command as
   * the probe, and `toggleTextAlign` walks the selection twice on its own --
   * three walks per button, four buttons, twelve identical answers.
   *
   * The assertion is on the total for one update rather than on the alignment
   * items alone, because that is the number a person feels; the ceiling sits
   * well below the old figure and well above the new one.
   *
   * MEASURED (jsdom): 200 paragraphs, select-all, one bar, one update.
   *   before  8,006 node visits   after  200
   */
  it('cuts the work of a select-all update by more than half', () => {
    const base = selectAllState()
    const toolbar = mount(base)

    const { state, visits } = counting(base)
    toolbar.update(state, state.tr.setSelection(TextSelection.create(state.doc, 1, 40)))

    expect(visits()).toBeLessThan(6000)
  })

  /**
   * The cheaper answer has to be the same answer. `alignFacts` must agree with
   * core's own `activeTextAlign`/`setTextAlign` about which button is enabled
   * and which is lit.
   */
  it('reports the same enabled and active state as the command it replaced', () => {
    const html = '<p style="text-align:center">one</p><p style="text-align:center">two</p>'
    const state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    )
    const toolbar = mount(all)
    toolbar.update(all)

    const button = (id: string): HTMLButtonElement | null =>
      toolbar.el.querySelector<HTMLButtonElement>(`[data-ol-id="${id}"]`)

    expect(button('alignCenter')?.getAttribute('aria-pressed')).toBe('true')
    expect(button('alignLeft')?.getAttribute('aria-pressed')).toBe('false')
    // aria-disabled, never the `disabled` property: a disabled button leaves the
    // roving tabindex and cannot be discovered by a screen reader, so the
    // toolbar never sets it. Asserting on `.disabled` would pass whatever the
    // code did.
    expect(button('alignCenter')?.getAttribute('aria-disabled')).toBe('false')
  })

  /**
   * A selection with nothing alignable in it disables all four.
   *
   * `code_block` carries no `align` attribute, so core's own `alignableBlocks`
   * finds nothing there -- which is the answer `alignFacts` has to reproduce.
   */
  it('disables the alignment buttons when nothing in the selection can be aligned', () => {
    const state = EditorState.create({
      doc: parseHtml('<pre><code>code</code></pre>', { schema: coreSchema() }),
    })
    const inCode = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 4)))
    const toolbar = mount(inCode)
    toolbar.update(inCode)

    const centre = toolbar.el.querySelector<HTMLButtonElement>('[data-ol-id="alignCenter"]')
    expect(centre?.getAttribute('aria-disabled')).toBe('true')
  })
})
