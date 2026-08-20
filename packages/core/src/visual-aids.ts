/**
 * Decorations that make empty blocks, non-breaking spaces, and preserved
 * atoms visible while editing.
 *
 * These marks are view-only. They must never reach serialized HTML: an empty
 * paragraph is still an empty paragraph, and a `&nbsp;` is still a nbsp.
 *
 * The set lives in plugin state rather than being recomputed by the
 * `decorations` prop. That prop is a *pull* prop -- ProseMirror calls it on
 * every `updateState`, so building the set there rebuilt the whole document's
 * decorations on every keystroke, every arrow key and every click. On
 * Word-pasted content, which is mostly non-breaking spaces, that measured 263 ms
 * per keystroke; mapping the existing set through the transaction instead
 * measures under 2 ms. Only the ranges the transaction actually touched are
 * rebuilt.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import type { StepMap } from 'prosemirror-transform'
import { Decoration, DecorationSet } from 'prosemirror-view'

const key = new PluginKey<DecorationSet>('openleaf-visual-aids')

/**
 * Mark every nbsp in one inline container, except a block-final one.
 *
 * ProseMirror renders a document space at the end of a text block as a
 * non-breaking space itself, so the browser does not collapse it. Decorating
 * that position wrapped the rendering artifact in a span, and the editor then
 * read the nbsp back as the author's own character -- so every space typed at
 * the end of a paragraph became a nbsp in the stored HTML, and the next one
 * after it too. A genuinely stored trailing nbsp therefore goes unmarked. That
 * is the price of the aid never changing the document it describes.
 *
 * The block-final test used to be `doc.resolve(at)` per nbsp, and
 * `Fragment.findIndex` inside `resolve` is a linear scan of the parent's
 * children -- O(nbsp x children) over the document. The traversal already knows
 * the parent's `content.size` and the running offset of each child, so the same
 * question is answered by comparing two integers.
 */
function markNbsp(parent: PMNode, contentStart: number, out: Decoration[]): void {
  const contentSize = parent.content.size
  let offset = 0
  parent.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? ''
      for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) !== 0xa0) continue
        // `parentOffset + 1 >= parent.content.size` is the block-final test,
        // and `offset + i` is exactly that parent offset.
        if (offset + i + 1 >= contentSize) continue
        // `contentStart + offset + i` already addresses the character itself: a
        // text node has no opening token to step over, unlike a node. Adding one
        // marked the character after each nbsp, and ran off the end of the node
        // when the nbsp was last -- where the decoration disappeared entirely.
        const at = contentStart + offset + i
        out.push(Decoration.inline(at, at + 1, { class: 'ol-nbsp' }))
      }
    }
    offset += child.nodeSize
  })
}

/** Every aid for the nodes overlapping `[from, to]`. */
function decorationsIn(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    // Text is scanned from its parent, which is where the offsets are known.
    if (node.isText) return false
    if (node.isTextblock && node.content.size === 0) {
      out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ol-empty-block' }))
    }
    if (node.type.name === 'unknown_block' || node.type.name === 'unknown_inline') {
      out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ol-hidden-structure' }))
    }
    if (node.inlineContent && node.content.size > 0) markNbsp(node, pos + 1, out)
    return true
  })
  return out
}

/**
 * The span of `tr.doc` the transaction touched, or null when it touched nothing.
 *
 * Each step's map reports positions in the document *that step* produced, which
 * for every step but the last is not `tr.doc`. Rather than slicing the mapping
 * per step -- the O(steps^2) shape this plugin exists to avoid -- the accumulated
 * range is carried forward one step at a time, so the whole scan is O(steps).
 */
function changedRange(maps: readonly StepMap[]): { from: number; to: number } | null {
  let from = -1
  let to = -1
  for (const map of maps) {
    if (from > -1) {
      from = map.map(from, -1)
      to = map.map(to, 1)
    }
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = from < 0 ? newStart : Math.min(from, newStart)
      to = to < 0 ? newEnd : Math.max(to, newEnd)
    })
  }
  return from < 0 ? null : { from, to }
}

/**
 * Widen a range to whole top-level blocks.
 *
 * Every aid is contained in one top-level block, so widening to that boundary
 * means a node overlapping the rebuilt range is *entirely* inside it. Without
 * that, a decoration on the half of a paragraph outside the range would survive
 * the removal and be added a second time.
 */
function widen(doc: PMNode, from: number, to: number): { from: number; to: number } {
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

export function visualAidsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init(_config, state) {
        return DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size))
      },
      apply(tr, set) {
        if (!tr.docChanged) return set
        const changed = changedRange(tr.mapping.maps)
        const mapped = set.map(tr.mapping, tr.doc)
        if (!changed) return mapped
        const { from, to } = widen(tr.doc, changed.from, changed.to)
        const stale = mapped.find(from, to)
        const kept = stale.length > 0 ? mapped.remove(stale) : mapped
        return kept.add(tr.doc, decorationsIn(tr.doc, from, to))
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)
      },
    },
  })
}
