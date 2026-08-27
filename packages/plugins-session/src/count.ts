/**
 * Document statistics.
 *
 * Word counts use `Intl.Segmenter` when the engine has it, so CJK text is not
 * reported as a single "word" the way a whitespace split would. Engines without
 * a segmenter fall back to splitting on whitespace, which is what Latin-script
 * documents already expect.
 *
 * Zero-width space, soft hyphen, and BOM are not content: they have no glyph,
 * visual aids do not mark them, and Word/Docs omit them from statistics. Both
 * character totals and the word count skip the same set, and so does find --
 * see `isInvisibleFormat`. They used to inflate `characters` while BOM alone
 * was `\s` and dropped from `charactersExcludingSpaces`, and ZWSP split words
 * because the segmenter treats it as a boundary.
 */

import { isNonEditableNode } from '@openleaf-editor/core'
import { t, uiLocale, withLocale } from '@openleaf-editor/ui'
import type { Node as PMNode } from 'prosemirror-model'

export interface DocumentStats {
  words: number
  characters: number
  charactersExcludingSpaces: number
  paragraphs: number
}

/**
 * One segmenter for the lifetime of the module.
 *
 * Constructing an `Intl.Segmenter` builds an ICU break iterator, which in a real
 * browser is by far the most expensive thing a word count does -- five of the
 * six milliseconds a hundred-page recount spent went on constructing a
 * segmenter that was then thrown away. The object is stateless with respect to
 * the string it is handed, so one instance serves every call.
 *
 * Built on first use rather than at module evaluation: loading the bundle must
 * stay cheap, and a server-side render that never counts a word must not pay
 * for ICU at all. `undefined` means "not yet asked", `null` means "this engine
 * has no segmenter", which is the case the whitespace fallback exists for.
 */
let cachedSegmenter: Intl.Segmenter | null | undefined

function wordSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    cachedSegmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null
  }
  return cachedSegmenter
}

export function countWords(text: string): number {
  const segmenter = wordSegmenter()
  if (segmenter) {
    let words = 0
    // The raw text rather than a trimmed copy: leading and trailing whitespace
    // segments are not word-like, so the answer is identical and a second copy
    // of the whole document is not allocated to get it.
    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) words += 1
    }
    return words
  }

  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Plain text of a document, with block breaks as spaces so words do not join.
 *
 * Same loop as `Fragment.textBetween`: the separator is inserted only before a
 * textblock or a block leaf, and an empty textblock still emits one. Locked
 * (`contenteditable="false"`) subtrees contribute no child text; they still
 * take part in that separator rule so unlocked words either side do not join.
 */
export function documentText(doc: PMNode): string {
  const blockSeparator = ' '
  const leafText = ' '
  let text = ''
  let first = true
  doc.nodesBetween(0, doc.content.size, (node) => {
    const skip = isNonEditableNode(node)
    const nodeText =
      node.isText && !skip
        ? (node.text ?? '')
        : !node.isLeaf
          ? ''
          : leafText
    if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock) && blockSeparator) {
      if (first) first = false
      else text += blockSeparator
    }
    text += nodeText
    return !skip
  })
  return text
}

/**
 * Format characters that are not content.
 *
 * ZWSP (U+200B) is a break hint some paste pipelines and IMEs insert; soft
 * hyphen (U+00AD) is a hyphenation point; BOM (U+FEFF) is an encoding artifact.
 * None of them has a glyph, and `visualAidsPlugin` marks only NBSP. Find uses
 * this same predicate so the two tools cannot drift: a character the counter
 * skips is a character the index will not treat as content.
 *
 * NBSP (U+00A0) is not in this set. It is a real space -- counted, marked by
 * visual aids, folded to U+0020 in find.
 */
export function isInvisibleFormat(code: number): boolean {
  return code === 0x200b || code === 0x00ad || code === 0xfeff
}

/**
 * `text` with format characters removed, or `text` itself when there are none.
 *
 * Allocates only when something has to go: the in-place character walk exists
 * so a hundred-page recount does not copy the document, and almost no document
 * contains these characters. Find uses this on the query; the document index
 * cannot, because concatenating around a skipped character would make Replace
 * eat it.
 */
export function stripInvisibleFormat(text: string): string {
  let first = -1
  for (let i = 0; i < text.length; i += 1) {
    if (isInvisibleFormat(text.charCodeAt(i))) {
      first = i
      break
    }
  }
  if (first < 0) return text
  const parts: string[] = []
  if (first > 0) parts.push(text.slice(0, first))
  let run = first + 1
  for (let i = first + 1; i < text.length; i += 1) {
    if (isInvisibleFormat(text.charCodeAt(i))) {
      if (run < i) parts.push(text.slice(run, i))
      run = i + 1
    }
  }
  if (run < text.length) parts.push(text.slice(run))
  return parts.join('')
}

/** Matches what `\s` matches, consulted only for the characters that need it. */
const UNICODE_SPACE = /\s/

/**
 * Non-whitespace characters, counted in place.
 *
 * `text.replace(/\s+/g, '').length` is the obvious spelling and allocates a
 * second copy of the entire document to throw away a length -- half a megabyte
 * of garbage per count on a hundred-page document. Almost every character in
 * almost every document is ASCII, so a code-unit test settles it without
 * touching the regex engine; the regex is left to decide the rare character
 * above the ASCII range (nbsp, ideographic space, the various en/em spaces).
 */
function nonSpaceCount(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) continue
    if (code >= 0x80 && UNICODE_SPACE.test(text.charAt(i))) continue
    count += 1
  }
  return count
}

export function documentStats(doc: PMNode): DocumentStats {
  const text = stripInvisibleFormat(documentText(doc))
  let paragraphs = 0
  doc.descendants((node) => {
    if (isNonEditableNode(node)) return false
    if (node.type.name === 'paragraph' || node.type.name === 'heading') paragraphs += 1
    return true
  })

  return {
    words: countWords(text),
    characters: text.length,
    charactersExcludingSpaces: nonSpaceCount(text),
    paragraphs,
  }
}

/**
 * "3 words", in a language that may not have two plural forms.
 *
 * `words === 1 ? ... : ...` is English's rule, and only English's: Russian needs
 * three forms, Arabic six, Japanese one. `Intl.PluralRules` names the category
 * and the catalog answers for it -- a locale that needs `few` registers
 * `{count} words#few`, and one that does not never sees the key. English keeps
 * two clean keys and no category suffix anywhere in its own strings.
 *
 * The engine already has to have `Intl` for `Intl.Segmenter` above, so this
 * costs nothing that was not already required.
 */
export function formatWordCount(stats: DocumentStats, locale?: string | null): string {
  const count = stats.words
  const category = pluralCategory(count, locale)
  const suffixed = `{count} words#${category}`
  // Looked up in the SAME locale the category came from. Choosing the category
  // from `ru` and then reading the catalog for whatever scope happened to be in
  // force is how a plural fix looks correct and does nothing.
  const template = withLocale(locale, () => {
    const translated = t(suffixed)
    // `t` falls back to the key itself, which is how "no catalog entry" is told
    // from "translated". English never registers these, so it falls through.
    return translated === suffixed
      ? t(category === 'one' ? '{count} word' : '{count} words')
      : translated
  })
  return template.replace('{count}', String(count))
}

function pluralCategory(count: number, locale?: string | null): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale ?? uiLocale()).select(count)
  } catch {
    // An unparseable `lang` must not take the word count down with it.
    return count === 1 ? 'one' : 'other'
  }
}
