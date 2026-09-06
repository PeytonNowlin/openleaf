/**
 * The one question every tool that touches a document has to ask first: is the
 * author editing this editor's markup by hand right now?
 *
 * While source view is open there are two documents. The textarea holds what
 * the author is typing, and `view.state.doc` holds the document as it was when
 * the view opened -- it is not reparsed until the view closes. `host.value`
 * answers with the textarea, which is why `openleaf_get_document` reads through
 * it and returns what the author is actually looking at.
 *
 * Every other tool reads `view.state.doc`, and the two answers disagree. An
 * agent that read the document, searched it for a string it had just seen, and
 * got no match would be right to conclude the string is not there. Worse, the
 * handles a search or an outline mints in that state point into the hidden
 * document: they name text the author may already have deleted, and they are
 * the coordinates a later write would use.
 *
 * So the reads refuse, rather than answering from the stale document or parsing
 * `host.value` into a throwaway one. A throwaway parse would have to mint
 * handles against a document that is not the live one, and the handle table is
 * per editor and per live document -- those handles would name nothing anybody
 * could write through.
 */

import type { RegisteredEditor } from './registry.js'
import { fail } from './result.js'

/**
 * Read through the property rather than requiring it on the host type: the
 * element is a peer dependency over a range, and one that predates source view
 * simply has no source view to be in.
 */
export function isEditingSource(editor: RegisteredEditor): boolean {
  return (editor.host as { sourceMode?: boolean }).sourceMode === true
}

/**
 * The refusal, or null when the editor is not in source view.
 *
 * `consequence` completes the sentence: the situation is identical everywhere,
 * and only what it costs *this* caller differs. One opening means an agent that
 * hits it on a read and again on a write sees the same cause both times.
 */
export function refuseInSourceMode(editor: RegisteredEditor, consequence: string): string | null {
  if (!isEditingSource(editor)) return null
  return fail(
    'refused',
    'that editor has its HTML source view open: the author is editing its ' +
      `markup by hand, and ${consequence}`,
  )
}
