/**
 * A caret beside a block atom or isolating node.
 *
 * Several core nodes are leaves (`page_break`, `video`, `audio`, `iframe`) or
 * isolating blocks (`details`, preserved unknown blocks). The document can be
 * *only* one of those, or two of them adjacent, and there is then no textblock
 * for the caret. ArrowLeft on a selected page-break stayed a `NodeSelection`;
 * the next keystroke replaced the atom (#164).
 *
 * `prosemirror-gapcursor` is the plugin this schema shape exists for. Tab is
 * not bound by it — that key remains the way out of the editor.
 */

import { gapCursor } from 'prosemirror-gapcursor'

export function gapCursorPlugin() {
  return gapCursor()
}
