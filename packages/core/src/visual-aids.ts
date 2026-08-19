/**
 * Decorations that make empty blocks, non-breaking spaces, and preserved
 * atoms visible while editing.
 *
 * These marks are view-only. They must never reach serialized HTML: an empty
 * paragraph is still an empty paragraph, and a `&nbsp;` is still a nbsp.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const key = new PluginKey('openleaf-visual-aids')

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
              const at = pos + 1 + i
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
