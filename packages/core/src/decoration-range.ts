/**
 * The two range calculations every incremental decoration plugin needs.
 *
 * A decoration plugin that rebuilds the whole document on every transaction is
 * the performance bug this package has already paid for once: building the set
 * in the `decorations` prop measured 263 ms per keystroke on Word-pasted
 * content, because that prop is a *pull* prop and ProseMirror calls it on every
 * `updateState` -- every arrow key and every click included. The fix is to keep
 * the set in plugin state, map it through the transaction, and rebuild only
 * what the transaction touched. These are the two helpers that shape says are
 * needed, extracted so the second plugin to want them does not carry a verbatim
 * copy of logic whose cost model is this subtle.
 */

import type { Node as PMNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

/**
 * The span of `tr.doc` the transaction touched, or null when it touched nothing.
 *
 * Each step's map reports positions in the document *that step* produced, which
 * for every step but the last is not `tr.doc`. Rather than slicing the mapping
 * per step -- the O(steps^2) shape these plugins exist to avoid -- the
 * accumulated range is carried forward one step at a time, so the whole scan is
 * O(steps).
 */
export function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = -1
  let to = -1
  const maps = tr.mapping.maps
  for (let i = 0; i < maps.length; i += 1) {
    const map = maps[i]
    if (!map) continue
    if (from > -1) {
      from = map.map(from, -1)
      to = map.map(to, 1)
    }
    let moved = false
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      moved = true
      from = from < 0 ? newStart : Math.min(from, newStart)
      to = to < 0 ? newEnd : Math.max(to, newEnd)
    })
    // A step whose map reports nothing still changed something. Adding or
    // removing a mark moves no position, so `tr.docChanged` is true and the
    // maps are empty -- reading the maps alone, toggling `<code>` on a word
    // looked like a transaction that had changed nothing at all. The step's own
    // range is valid in the document it produced, precisely because its map is
    // the identity, so it can be folded in here rather than mapped.
    if (moved) continue
    const step = tr.steps[i] as { from?: unknown; to?: unknown } | undefined
    if (typeof step?.from !== 'number' || typeof step.to !== 'number') continue
    from = from < 0 ? step.from : Math.min(from, step.from)
    to = to < 0 ? step.to : Math.max(to, step.to)
  }
  return from < 0 ? null : { from, to }
}

/**
 * Widen a range to whole top-level blocks.
 *
 * Both callers decorate things contained in one top-level block, so widening to
 * that boundary means a node overlapping the rebuilt range is *entirely* inside
 * it. Without that, a decoration on the half of a paragraph outside the range
 * would survive the removal and be added a second time.
 */
export function widenToTopLevel(
  doc: PMNode,
  from: number,
  to: number,
): { from: number; to: number } {
  const size = doc.content.size
  const start = Math.max(0, Math.min(from, size))
  const end = Math.max(start, Math.min(to, size))
  const $start = doc.resolve(start)
  const $end = doc.resolve(end)
  return {
    from: $start.depth > 0 ? $start.before(1) : start,
    to: $end.depth > 0 ? $end.after(1) : end,
  }
}
