/**
 * Whether an agent may write to a given range at all, asked once.
 *
 * Three refusals, and none of them is this package's own policy: each one is a
 * guard the editor already applies to the person sitting in front of it. An
 * agent that got past any of them would be doing something no keyboard shortcut
 * and no toolbar button can do, which is the opposite of what routing through
 * the editor's own commands is for.
 *
 * It answers with the finished failure string rather than a boolean so that
 * every tool that writes refuses in the same words. A caller that had to invent
 * its own message for "that is preserved markup" would eventually invent a
 * different one, and the message is the only thing the agent can act on.
 */

import type { Node as PMNode } from 'prosemirror-model'
import type { RegisteredEditor } from './registry.js'
import { fail } from './result.js'

/**
 * The two node types the preservation layer stores markup in.
 *
 * Named rather than detected, because they are named in the schema
 * (`core/src/schema.ts`) and a structural guess -- "an atom carrying an `html`
 * attribute" -- would quietly start matching some future node that is nothing
 * of the kind.
 */
const PRESERVED = new Set(['unknown_block', 'unknown_inline'])

/**
 * True when the range holds, or sits inside, markup the editor preserves.
 *
 * `nodesBetween` reports the ancestors of the range as well as the nodes inside
 * it, so one walk answers both halves: a range containing a preserved atom, and
 * a range inside a preserved node. Today the preserved types are atoms and only
 * the first is reachable, but the second is what makes this the right question
 * to ask rather than an accident of the current schema.
 */
export function touchesPreserved(doc: PMNode, from: number, to: number): boolean {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (!PRESERVED.has(node.type.name)) return true
    found = true
    return false
  })
  return found
}

/**
 * The refusal to hand back to the agent, or `null` when the write may proceed.
 *
 * Call it before anything is staged. Every one of these means the document is
 * about to be left exactly as it was, which is the promise a failed tool call
 * makes.
 */
export function refuseWrite(editor: RegisteredEditor, from: number, to: number): string | null {
  if (editor.host.hasAttribute('readonly')) {
    return fail(
      'refused',
      'that editor is readonly. Its own toolbar is unavailable too, so there is ' +
        'nothing to retry while the attribute is set.',
    )
  }

  // Read through the property rather than requiring it on the host type: the
  // element is a peer dependency over a range, and one that predates source
  // view simply has no source view to be in.
  if ((editor.host as { sourceMode?: boolean }).sourceMode === true) {
    return fail(
      'refused',
      'that editor has its HTML source view open: the author is editing its ' +
        'markup by hand, and a change made now would be discarded when the view ' +
        'closes. Read the document again before retrying.',
    )
  }

  if (touchesPreserved(editor.view.state.doc, from, to)) {
    return fail(
      'preserved-region',
      'that range holds markup the editor preserves byte for byte and never ' +
        'edits. Choose a different one.',
    )
  }

  return null
}
