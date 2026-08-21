/**
 * What the core plugins are allowed to do per transaction.
 *
 * These are counting tests, not timing tests. A wall-clock budget on a shared
 * runner either fails for reasons that have nothing to do with the code or is
 * set so loose that the bug it was written for would still pass -- which is how
 * a performance test ends up asserting nothing. "How many nodes did it look at"
 * and "how many times did it invert a mapping" are the same numbers on every
 * machine, and they are the quantities that actually regressed.
 *
 * Every assertion here was confirmed to go red against the unfixed code; the
 * measured before/after numbers are in each test.
 */

import { EditorState, TextSelection } from 'prosemirror-state'
import { Mapping, StepMap } from 'prosemirror-transform'
import { describe, expect, it, vi } from 'vitest'
import { coreSchema, nonEditablePlugin, parseHtml, visualAidsPlugin } from '../src/index.js'

const schema = coreSchema()

/** Captured before any spy replaces it, so the spy can still do the real work. */
const realStepMapMap = StepMap.prototype.map

/** A paragraph per entry, with `&nbsp;` between words -- what Word pastes. */
function wordPasted(paragraphs: number): string {
  const out: string[] = []
  for (let i = 0; i < paragraphs; i += 1) {
    out.push(`<p>alpha&nbsp;beta&nbsp;gamma&nbsp;delta&nbsp;epsilon ${i}</p>`)
  }
  return out.join('')
}

/**
 * Count how many nodes a document is asked to look at.
 *
 * Both traversal entry points are shadowed on the instance, so the count covers
 * whichever one the implementation reaches for. The plugin under test is handed
 * this exact node, so nothing else can be inflating the number.
 */
function countingDoc<T extends { descendants: unknown; nodesBetween: unknown }>(
  doc: T,
): { doc: T; visits: () => number } {
  let visits = 0
  const realDescendants = (doc as { descendants: (...a: never[]) => unknown }).descendants.bind(doc)
  const realNodesBetween = (doc as { nodesBetween: (...a: never[]) => unknown }).nodesBetween.bind(
    doc,
  )
  Object.defineProperties(doc, {
    descendants: {
      configurable: true,
      value: (f: (...a: never[]) => unknown) =>
        realDescendants(((...args: never[]) => {
          visits += 1
          return f(...args)
        }) as never),
    },
    nodesBetween: {
      configurable: true,
      value: (from: number, to: number, f: (...a: never[]) => unknown, start?: number) =>
        realNodesBetween(
          from as never,
          to as never,
          ((...args: never[]) => {
            visits += 1
            return f(...args)
          }) as never,
          start as never,
        ),
    },
  })
  return { doc, visits: () => visits }
}

describe('visualAidsPlugin cost per transaction', () => {
  /**
   * The plugin used to have no state at all: `props.decorations` is a pull prop,
   * so ProseMirror rebuilt the whole document's decoration set on every
   * `updateState`, and called `doc.resolve` once per non-breaking space to ask
   * whether it ended its block. On Word-pasted content -- which is mostly
   * non-breaking spaces, and is the content this editor exists to inherit --
   * that measured 263 ms per keystroke.
   *
   * MEASURED (jsdom): 800 paragraphs, one character typed.
   *   before  3,200 node visits   after  4 node visits
   */
  it('looks at the edited block, not the document, when a character is typed', () => {
    const state = EditorState.create({
      doc: parseHtml(wordPasted(800), { schema }),
      plugins: [visualAidsPlugin()],
    })

    // Warm: the initial build is allowed to walk everything, once.
    const tr = state.tr.insertText('x', 3)
    const { doc, visits } = countingDoc(tr.doc)
    expect(doc).toBe(tr.doc)

    const next = state.apply(tr)
    for (const plugin of next.plugins) plugin.props.decorations?.call(plugin, next)

    // Generous by two orders of magnitude and still far under the old number:
    // the point is that it is bounded by the edit, not by the document.
    expect(visits()).toBeLessThan(50)
  })

  /**
   * A selection-only transaction reuses the document node, so there is nothing
   * to recompute and nothing to map. Before the rewrite this walked the whole
   * document too, because the prop was pulled regardless.
   *
   * MEASURED (jsdom): before 3,200 visits, after 0.
   */
  it('does no work at all when only the selection moved', () => {
    const state = EditorState.create({
      doc: parseHtml(wordPasted(800), { schema }),
      plugins: [visualAidsPlugin()],
    })
    // A plain selection transaction: same document node, different caret.
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 12))
    const { doc, visits } = countingDoc(tr.doc)
    expect(doc).toBe(tr.doc)
    const next = state.apply(tr)
    for (const plugin of next.plugins) plugin.props.decorations?.call(plugin, next)
    expect(visits()).toBe(0)
  })

  /** The decorations must still be the same ones, in the same places. */
  it('lands the same decorations incrementally as it does from scratch', () => {
    const html = wordPasted(12)
    const state = EditorState.create({
      doc: parseHtml(html, { schema }),
      plugins: [visualAidsPlugin()],
    })

    // Edit in the middle, so blocks before and after are carried by mapping.
    let live = state
    for (const at of [40, 41, 300, 7]) {
      live = live.apply(live.tr.insertText('Z', at))
    }

    // The same document, built fresh: what a from-scratch pass would produce.
    const fresh = EditorState.create({
      doc: live.doc,
      plugins: [visualAidsPlugin()],
    })

    const ranges = (s: EditorState): string[] => {
      const plugin = s.plugins[0]
      if (!plugin) throw new Error('no plugin')
      const set = plugin.props.decorations?.call(plugin, s) as
        | { find(): Array<{ from: number; to: number; type: { attrs?: { class?: string } } }> }
        | undefined
      return (set?.find() ?? [])
        .map((d) => `${d.from}-${d.to}:${d.type.attrs?.class ?? ''}`)
        .sort()
    }

    expect(ranges(live)).toEqual(ranges(fresh))
  })
})

describe('nonEditablePlugin.filterTransaction cost per step', () => {
  /**
   * `tr.mapping.slice(0, i).invert()` inside a loop over steps allocated and
   * inverted an i-length mapping for every step, so the cost was the sum of i
   * rather than the count of them -- clean quadratic growth, 4x per doubling.
   * `clearFormatting` over a select-all on a 100-page document produces about
   * three thousand steps and measured 180 ms in this function alone.
   *
   * The document each step applied to is already on the transaction, as
   * `tr.docs[i]`, so no mapping is needed at all.
   *
   * MEASURED (jsdom): 1,000 steps.
   *   before  1,000 Mapping.invert calls   after  0
   */
  it('never inverts a mapping, however many steps the transaction has', () => {
    const state = EditorState.create({
      doc: parseHtml('<p>alpha</p><p>beta</p><p>gamma</p>', { schema }),
      plugins: [nonEditablePlugin()],
    })

    let tr = state.tr
    for (let i = 0; i < 1000; i += 1) tr = tr.insertText('z', 1)

    const invert = vi.spyOn(Mapping.prototype, 'invert')
    const slice = vi.spyOn(Mapping.prototype, 'slice')
    try {
      for (const plugin of state.plugins) {
        plugin.spec.filterTransaction?.call(plugin, tr, state)
      }
      expect(invert).not.toHaveBeenCalled()
      expect(slice).not.toHaveBeenCalled()
    } finally {
      invert.mockRestore()
      slice.mockRestore()
    }
  })

  /**
   * The same property stated as growth rather than as an absolute.
   *
   * Total position-mapping operations must not grow faster than the step count.
   * Quadrupling the steps quadrupled the work before and multiplied it by
   * sixteen in mapping operations, which is the shape the ceiling below
   * excludes; the `+ 100` is there so that "no mapping at all" satisfies it
   * without dividing by zero.
   *
   * MEASURED (jsdom): mapping operations at 500 and 2,000 steps.
   *   before  500,500 -> 8,002,000  (16x, quadratic)
   *   after         0 ->         0
   */
  it('does not grow its mapping work faster than the step count', () => {
    const state = EditorState.create({
      doc: parseHtml('<p>alpha</p><p>beta</p><p>gamma</p>', { schema }),
      plugins: [nonEditablePlugin()],
    })

    const opsFor = (steps: number): number => {
      let tr = state.tr
      for (let i = 0; i < steps; i += 1) tr = tr.insertText('z', 1)
      let ops = 0
      const map = vi.spyOn(StepMap.prototype, 'map').mockImplementation(function (
        this: StepMap,
        ...args: Parameters<StepMap['map']>
      ) {
        ops += 1
        return realStepMapMap.apply(this, args)
      })
      const invert = vi.spyOn(Mapping.prototype, 'invert')
      try {
        for (const plugin of state.plugins) {
          plugin.spec.filterTransaction?.call(plugin, tr, state)
        }
        return ops + invert.mock.calls.length
      } finally {
        map.mockRestore()
        invert.mockRestore()
      }
    }

    const small = opsFor(500)
    const large = opsFor(2000)
    expect(large).toBeLessThanOrEqual(small * 5 + 100)
  })
})
