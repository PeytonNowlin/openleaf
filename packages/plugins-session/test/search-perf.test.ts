/**
 * Cost guards for find and replace.
 *
 * `findMatches` runs on every keystroke while the find bar is open, so its cost
 * is felt directly rather than amortised. The thresholds here are loose enough
 * for a loaded CI box -- they are shaped to catch a return of the quadratic
 * behaviour these numbers came from, not to police a few milliseconds.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { findMatches, replaceAll, searchPlugin, setSearch } from '../src/search.js'

/** A document of `blocks` paragraphs holding `chars` of text between them. */
function documentOf(blocks: number, chars: number) {
  const filler = 'the quick brown fox jumps over the lazy dog '
  const body = filler.repeat(Math.ceil(chars / blocks / filler.length)).slice(0, Math.round(chars / blocks))
  return parseHtml(`<p>${body}</p>`.repeat(blocks), { schema: coreSchema() })
}

/** The best of several runs: the floor is what the machine can do, the rest is noise. */
function fastest(runs: number, work: () => void): number {
  let best = Infinity
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    work()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

function searchState(blocks: number) {
  let state = EditorState.create({
    doc: parseHtml('<p>the quick brown fox jumps</p>'.repeat(blocks), { schema: coreSchema() }),
    plugins: [searchPlugin()],
  })
  setSearch('fox')(state, (tr) => {
    state = state.apply(tr)
  })
  return state
}

/**
 * How many times `Mapping.map` is called while `work` runs.
 *
 * A count that climbs with the number of matches is the quadratic itself:
 * `Mapping.map` walks every step accumulated so far, so calling it once per
 * match makes the walk cost the square of the match count.
 */
function mappingCalls(sample: EditorState, work: () => void): number {
  const mapping = Object.getPrototypeOf(sample.tr.mapping) as {
    map: (...args: unknown[]) => number
  }
  const original = mapping.map
  let calls = 0
  mapping.map = function counted(this: unknown, ...args: unknown[]): number {
    calls += 1
    return original.apply(this, args) as number
  }
  try {
    work()
  } finally {
    mapping.map = original
  }
  return calls
}

describe('findMatches cost', () => {
  it('stays under 20 ms on an 8,000 block document', () => {
    const doc = documentOf(8000, 260_000)
    const ms = fastest(3, () => {
      findMatches(doc, 'the')
    })
    expect(ms).toBeLessThan(20)
  })

  /**
   * The same text split into more blocks used to cost more, because asking
   * `endsWith` about a string built by `+=` flattened the whole rope once per
   * block: 500 blocks took 5.5 ms and 8,000 took 78.7 ms for the same 260 KB.
   * Splitting text into more paragraphs is not more text to search.
   */
  it('does not get slower as the same text is split into more blocks', () => {
    const few = documentOf(500, 260_000)
    const many = documentOf(8000, 260_000)
    const fewMs = fastest(3, () => {
      findMatches(few, 'the')
    })
    const manyMs = fastest(3, () => {
      findMatches(many, 'the')
    })
    expect(manyMs).toBeLessThan(fewMs * 4 + 10)
  })
})

/**
 * What is left of `replaceAll` is ProseMirror's own cost: applying a
 * `ReplaceStep` rebuilds the fragment holding the match, which on a flat
 * document copies an array of every sibling block. That is superlinear and not
 * ours to remove here, so there is no wall-clock assertion below -- a threshold
 * loose enough to survive a loaded machine would not have caught the quadratic
 * anyway. Counting the calls does, exactly.
 */
describe('replaceAll cost', () => {
  /**
   * Matches are disjoint and rewritten back to front, so the positions found
   * still stand and nothing needs remapping. This asserts the shape rather than
   * the clock: before, the count was two per match -- 402 calls for 200 matches,
   * 3,202 for 1,600 -- and each call walked every step already taken.
   */
  it('does not remap a position per match', () => {
    const small = searchState(200)
    const large = searchState(800)
    const smallCalls = mappingCalls(small, () => {
      replaceAll('cat')(small, () => {})
    })
    const largeCalls = mappingCalls(large, () => {
      replaceAll('cat')(large, () => {})
    })
    expect(largeCalls).toBe(smallCalls)
    expect(largeCalls).toBeLessThan(10)
  })
})
