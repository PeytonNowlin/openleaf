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
import { Decoration, DecorationSet } from 'prosemirror-view'
import { changedRange, widenToTopLevel } from './decoration-range.js'

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

export function visualAidsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init(_config, state) {
        return DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size))
      },
      apply(tr, set) {
        if (!tr.docChanged) return set
        const changed = changedRange(tr)
        const mapped = set.map(tr.mapping, tr.doc)
        if (!changed) return mapped
        const { from, to } = widenToTopLevel(tr.doc, changed.from, changed.to)
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
