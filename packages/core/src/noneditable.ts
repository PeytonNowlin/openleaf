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
function editsLockedInterior(doc: PMNode, start: number, end: number): boolean {
  // Clamped rather than trusted. A throw from here escapes `filterTransaction`
  // and takes the whole transaction with it, so one bad range does not read as
  // "this edit is not allowed" -- it reads as the editor ignoring the command.
  const from = Math.max(0, Math.min(start, doc.content.size))
  const to = Math.max(from, Math.min(end, doc.content.size))
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
    /**
     * Refuse a transaction that edits the inside of a locked node.
     *
     * Each step's map reports positions in the document *that step* applied to,
     * which for every step after the first is not `state.doc`. Reading the
     * original document with those coordinates walks off the end of it as soon
     * as a transaction has more than one step and the earlier ones grow the
     * document -- `nodesBetween` then throws, the throw escapes here, and
     * ProseMirror drops the transaction. The symptom was a toolbar button doing
     * nothing at all: inserting a table column after inserting a row produces
     * exactly that shape, and the error was swallowed by the toolbar's guard.
     *
     * The transaction already holds those documents. `tr.docs[i]` is the
     * document step `i` was applied to, kept by `Transform` so that a step can
     * be inverted, so each range can simply be read against it -- no mapping at
     * all, and the positions are exact rather than an approximation recovered
     * through an inverse.
     *
     * The mapping is what made this expensive. It used to be
     * `tr.mapping.slice(0, i).invert()`, built inside the loop: an i-length
     * mapping allocated and inverted for every step, so the cost was the sum of
     * i rather than the count of them. A single-character transaction has one
     * step and never showed it; `clearFormatting` over a select-all on a
     * 100-page document produces about three thousand, and measured 180 ms in
     * this function alone.
     */
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true
      let blocked = false
      for (let i = 0; i < tr.steps.length; i += 1) {
        if (blocked) break
        const step = tr.steps[i]
        if (!step) continue
        // `docs[0]` is `state.doc`; the fallback covers a transaction whose
        // steps were recorded elsewhere, where the first document is the only
        // one we can name.
        const before = tr.docs[i] ?? state.doc
        step.getMap().forEach((start, end) => {
          if (blocked) return
          if (editsLockedInterior(before, start, end)) blocked = true
        })
      }
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
