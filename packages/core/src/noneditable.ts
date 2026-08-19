/**
 * Honour `contenteditable="false"` on stored markup.
 *
 * The attribute already round-trips as carried residue. Without this plugin the
 * browser will often still let a caret in, and ProseMirror will then "correct"
 * the typing on the next transaction -- which looks like the editor eating
 * keystrokes. Filtering those transactions, and marking the node in the view,
 * is what makes a locked region actually locked.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { CARRIED_ATTR } from './extensions.js'

const key = new PluginKey('openleaf-noneditable')

export function isNonEditableNode(node: PMNode): boolean {
  const carried = node.attrs[CARRIED_ATTR] as Record<string, string> | null | undefined
  const value = carried?.['contenteditable']
  return Boolean(value && value.toLowerCase() === 'false')
}

/** True when a change sits *inside* a locked node, not when the node itself is deleted. */
function editsLockedInterior(doc: PMNode, from: number, to: number): boolean {
  let blocked = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (!isNonEditableNode(node)) return true
    const start = pos
    const end = pos + node.nodeSize
    if (from > start && to < end) blocked = true
    return false
  })
  return blocked
}

export function nonEditablePlugin(): Plugin {
  return new Plugin({
    key,
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true
      let blocked = false
      tr.mapping.maps.forEach((map) => {
        if (blocked) return
        map.forEach((oldStart, oldEnd) => {
          if (editsLockedInterior(state.doc, oldStart, oldEnd)) blocked = true
        })
      })
      return !blocked
    },
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (!isNonEditableNode(node)) return true
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: 'ol-noneditable',
              contenteditable: 'false',
            }),
          )
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
