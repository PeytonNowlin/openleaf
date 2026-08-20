/**
 * Document statistics.
 *
 * Word counts use `Intl.Segmenter` when the engine has it, so CJK text is not
 * reported as a single "word" the way a whitespace split would. Engines without
 * a segmenter fall back to splitting on whitespace, which is what Latin-script
 * documents already expect.
 */

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

/** Plain text of a document, with block breaks as spaces so words do not join. */
export function documentText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, ' ', ' ')
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
  const text = documentText(doc)
  let paragraphs = 0
  doc.descendants((node) => {
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

export function formatWordCount(stats: DocumentStats): string {
  return stats.words === 1 ? '1 word' : `${stats.words} words`
}
