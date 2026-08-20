/**
 * @openleaf-editor/paste -- turn foreign clipboard HTML into clean semantic markup.
 *
 * This is the package that decides whether the editor feels professional.
 * Paste fidelity from Word and Google Docs is the single most common reason
 * organizations pay for a commercial editor, and the difference between a good
 * and a bad implementation is visible to an author within about four seconds
 * of trying it.
 *
 * Note on where this sits: pasting and *loading* are different operations with
 * opposite defaults. On load, the author's markup is authoritative and we
 * preserve everything (see @openleaf-editor/core). On paste, the source's styling is
 * precisely what the author is trying to shed, so stripping is the goal.
 * Conflating the two is how an editor ends up either mangling stored documents
 * or importing a wall of `line-height:1.38` into them.
 */

import {
  collapseBareSpans,
  dropEmptyBlocks,
  extractSemantics,
  stripAllStyles,
} from './clean.js'
import { parseFragment, resolveDocument, serializeFragment, stripComments } from './dom.js'
import { looksLikeGoogleDocs, normalizeGoogleDocs } from './gdocs.js'
import { looksLikeWord, normalizeWord } from './word.js'

export { looksLikeWord, normalizeWord } from './word.js'
export { looksLikeGoogleDocs, normalizeGoogleDocs } from './gdocs.js'

/** Where a paste appears to have come from. */
export type PasteSource = 'word' | 'gdocs' | 'unknown'

export function detectSource(html: string): PasteSource {
  // Word is checked first: an Outlook message quoting a Google Doc can match
  // both, and Word's markup is the more destructive of the two to leave alone.
  if (looksLikeWord(html)) return 'word'
  if (looksLikeGoogleDocs(html)) return 'gdocs'
  return 'unknown'
}

/**
 * Conservative normalizer for pastes of unknown origin, including content
 * copied from OpenLeaf itself.
 *
 * Styles are stripped and emphasis is promoted to tags, but **classes,
 * `data-` attributes and unrecognised elements are left alone**. That is
 * deliberate and load-bearing: copying a preserved `<div class="callout">`
 * from one OpenLeaf document into another must not quietly destroy it. A
 * generic paste handler that strips classes would silently break the
 * preservation guarantee the whole project rests on.
 */
export function normalizeGeneric(html: string, explicitDocument?: Document): string {
  // Inert throughout: the fragment is walked and mutated where it was parsed,
  // every node created below is created in `fragment.doc`, and the result is
  // serialized straight out. Nothing here ever enters the live document.
  const fragment = parseFragment(html, resolveDocument(explicitDocument))
  const { root, doc } = fragment

  extractSemantics(root, doc)
  stripComments(root)
  stripAllStyles(root)
  collapseBareSpans(root)
  dropEmptyBlocks(root, ['span'])

  return serializeFragment(fragment)
}

/**
 * Normalize pasted HTML from any source.
 *
 * This is the function to wire into ProseMirror's `transformPastedHTML`.
 */
export function normalizePastedHtml(html: string, explicitDocument?: Document): string {
  switch (detectSource(html)) {
    case 'word':
      return normalizeWord(html, explicitDocument)
    case 'gdocs':
      return normalizeGoogleDocs(html, explicitDocument)
    default:
      return normalizeGeneric(html, explicitDocument)
  }
}
