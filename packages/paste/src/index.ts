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
export type PasteSource = 'word' | 'gdocs' | 'openleaf' | 'unknown'

/**
 * True when this HTML came off the clipboard of a ProseMirror editor -- which,
 * on a page running OpenLeaf, means the editor itself.
 *
 * ProseMirror stamps `data-pm-slice` on the HTML it writes to the clipboard,
 * carrying the open depths of the copied slice. Nothing else emits it, so it is
 * a far better signal than anything content-based: the *content* of an OpenLeaf
 * document is by design whatever the author's source document contained, Word
 * residue included.
 *
 * It is a signal about the editor rather than about OpenLeaf specifically, so a
 * copy from some other ProseMirror-based editor matches too. That is the
 * intended reading -- such markup is already schema-shaped rather than vendor
 * debris -- but if it ever needs to be exact, the fix is a marker of our own in
 * core's `clipboardSerializer` and an extra test here.
 */
export function looksLikeOpenLeaf(html: string): boolean {
  return /\bdata-pm-slice\s*=/i.test(html)
}

export function detectSource(html: string): PasteSource {
  // Internal copies are claimed before anything else, and this ordering is the
  // whole point. `looksLikeWord` matches the bare substring `mso-`, so an
  // OpenLeaf document that has *preserved* a `<div class="MsoNormal">` -- the
  // canonical thing the preservation layer keeps -- re-triggers Word detection
  // when it is copied, and the Word stripper then destroys exactly the markup
  // preservation exists to protect.
  if (looksLikeOpenLeaf(html)) return 'openleaf'
  // Word is checked next: an Outlook message quoting a Google Doc can match
  // both, and Word's markup is the more destructive of the two to leave alone.
  if (looksLikeWord(html)) return 'word'
  if (looksLikeGoogleDocs(html)) return 'gdocs'
  return 'unknown'
}

function clean(html: string, doc: Document, keepStyles: boolean): string {
  // Inert throughout: the fragment is walked and mutated where it was parsed,
  // every node created below is created in the fragment's own document, and the
  // result is serialized straight out. Nothing here ever enters the live one.
  const fragment = parseFragment(html, doc)
  const { root, doc: inert } = fragment

  extractSemantics(root, inert)
  stripComments(root)
  if (!keepStyles) stripAllStyles(root)
  collapseBareSpans(root)
  dropEmptyBlocks(root, ['span'])

  return serializeFragment(fragment)
}

/**
 * Conservative normalizer for pastes of unknown origin.
 *
 * Styles **are** stripped, and so is anything they encoded that was not first
 * promoted to a tag. But **classes, `data-` attributes and unrecognised
 * elements are left alone**. That is deliberate and load-bearing: copying a
 * preserved `<div class="callout">` from one OpenLeaf document into another
 * must not quietly destroy it. A generic paste handler that strips classes
 * would silently break the preservation guarantee the whole project rests on.
 *
 * For a copy that came out of the editor itself, use `normalizeOpenLeaf`: this
 * function's style stripping is right for a foreign source and wrong for one
 * in the same trust domain as the destination.
 */
export function normalizeGeneric(html: string, explicitDocument?: Document): string {
  return clean(html, resolveDocument(explicitDocument), false)
}

/**
 * Normalizer for content copied out of an OpenLeaf editor.
 *
 * Identical to `normalizeGeneric` except that inline styles stay. Total style
 * stripping is right for a foreign paste -- the author has asked for the
 * source's appearance not to come along -- and wrong here, where the source is
 * the same editor, the same schema and the same trust domain as the
 * destination. Stripping in that case does not shed a vendor's styling; it
 * deletes formatting the author applied in this editor a moment ago, and it
 * deletes it from preserved markup that has no other copy.
 *
 * The `data-pm-slice` marker itself is deliberately left in place. It looks
 * like bookkeeping to remove -- Google's `docs-internal-guid` is removed two
 * files over -- but ProseMirror reads it *after* `transformPastedHTML` returns,
 * for the open depths that decide whether the pasted content merges into the
 * paragraph at the cursor or arrives as new blocks. Removing it changes where
 * the paste lands.
 */
export function normalizeOpenLeaf(html: string, explicitDocument?: Document): string {
  return clean(html, resolveDocument(explicitDocument), true)
}

/**
 * Normalize pasted HTML from any source.
 *
 * This is the function to wire into ProseMirror's `transformPastedHTML`.
 */
export function normalizePastedHtml(html: string, explicitDocument?: Document): string {
  switch (detectSource(html)) {
    case 'openleaf':
      return normalizeOpenLeaf(html, explicitDocument)
    case 'word':
      return normalizeWord(html, explicitDocument)
    case 'gdocs':
      return normalizeGoogleDocs(html, explicitDocument)
    default:
      return normalizeGeneric(html, explicitDocument)
  }
}
