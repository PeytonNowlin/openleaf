/**
 * The incremental rebuild every decoration plugin in this package shares.
 *
 * A decoration plugin that rebuilds the whole document on every transaction is
 * the performance bug this package has already paid for once: building the set
 * in the `decorations` prop measured 263 ms per keystroke on Word-pasted
 * content, because that prop is a *pull* prop and ProseMirror calls it on every
 * `updateState` -- every arrow key and every click included. The fix is to keep
 * the set in plugin state, map it through the transaction, and rebuild only
 * what the transaction touched. `rebuildChanged` is that whole dance, kept in
 * one place: the cost model is subtle, and so is the correctness -- see the
 * comment on the removal below for the bug a second hand-written copy walked
 * into.
 */

import type { Node as PMNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import type { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * The span of `tr.doc` the transaction touched, or null when it touched nothing.
 *
 * Each step's map reports positions in the document *that step* produced, which
 * for every step but the last is not `tr.doc`. Rather than slicing the mapping
 * per step -- the O(steps^2) shape these plugins exist to avoid -- the
 * accumulated range is carried forward one step at a time, so the whole scan is
 * O(steps).
 */
function changedRange(tr: Transaction): { from: number; to: number } | null {
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
 * Every caller decorates things contained in one top-level block, so widening to
 * that boundary means a node overlapping the rebuilt range is *entirely* inside
 * it. Without that, a decoration on the half of a paragraph outside the range
 * would survive the removal and be added a second time.
 */
function widenToTopLevel(
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

/**
 * Map a decoration set through a transaction and rebuild only what changed.
 *
 * `build` is called with the widened range and must return every decoration for
 * the nodes in it -- the same function the plugin uses to build its initial
 * set, called over less of the document.
 */
export function rebuildChanged(
  set: DecorationSet,
  tr: Transaction,
  build: (doc: PMNode, from: number, to: number) => Decoration[],
): DecorationSet {
  if (!tr.docChanged) return set
  const changed = changedRange(tr)
  const mapped = set.map(tr.mapping, tr.doc)
  if (!changed) return mapped
  const { from, to } = widenToTopLevel(tr.doc, changed.from, changed.to)
  // `find` reports a decoration that merely *touches* the queried range, and
  // the neighbouring block is the common case: an empty paragraph starting
  // exactly at `to`, or a code block ending exactly at `from`. Removing one of
  // those and then rebuilding only `[from, to]` -- which `nodesBetween` does
  // not revisit either block in -- silently dropped its decoration, so the aid
  // or the attribute fell off the block next to the one being edited. Only what
  // is wholly inside the range is stale.
  const stale = mapped.find(from, to).filter((d) => d.from >= from && d.to <= to)
  const kept = stale.length > 0 ? mapped.remove(stale) : mapped
  return kept.add(tr.doc, build(tr.doc, from, to))
}
