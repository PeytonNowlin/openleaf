/**
 * Decorations that make empty blocks, non-breaking spaces, and preserved
 * atoms visible while editing.
 *
 * These marks are view-only. They must never reach serialized HTML: an empty
 * paragraph is still an empty paragraph, and a `&nbsp;` is still a nbsp.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const key = new PluginKey('openleaf-visual-aids')

/**
 * True when this position is the last character of its text block.
 *
 * ProseMirror renders a document space in that position as a non-breaking space
 * itself, so the browser does not collapse it. Decorating it wraps that
 * rendering artifact in a span, and the editor then reads the nbsp back as the
 * author's own character -- so every space typed at the end of a paragraph
 * became a nbsp in the stored HTML, and the next one after it too.
 *
 * A genuinely stored trailing nbsp therefore goes unmarked. That is the price of
 * the aid never changing the document it describes.
 */
function isBlockFinal(doc: PMNode, at: number): boolean {
  const $at = doc.resolve(at)
  return $at.parentOffset + 1 >= $at.parent.content.size
}

export function visualAidsPlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.content.size === 0) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: 'ol-empty-block' }),
            )
          }
          if (node.type.name === 'unknown_block' || node.type.name === 'unknown_inline') {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: 'ol-hidden-structure' }),
            )
          }
          if (node.isText) {
            const text = node.text ?? ''
            for (let i = 0; i < text.length; i += 1) {
              if (text.charCodeAt(i) !== 0xa0) continue
              // `pos` already addresses the first character: a text node has no
              // opening token to step over, unlike a node. Adding one marked the
              // character after each nbsp, and ran off the end of the node when
              // the nbsp was last -- where the decoration disappeared entirely.
              const at = pos + i
              if (isBlockFinal(state.doc, at)) continue
              decorations.push(
                Decoration.inline(at, at + 1, { class: 'ol-nbsp' }),
              )
            }
          }
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
