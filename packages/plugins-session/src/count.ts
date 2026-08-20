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

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    let words = 0
    for (const part of segmenter.segment(trimmed)) {
      if (part.isWordLike) words += 1
    }
    return words
  }

  return trimmed.split(/\s+/).length
}

/** Plain text of a document, with block breaks as spaces so words do not join. */
export function documentText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, ' ', ' ')
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
    charactersExcludingSpaces: text.replace(/\s+/g, '').length,
    paragraphs,
  }
}

export function formatWordCount(stats: DocumentStats): string {
  return stats.words === 1 ? '1 word' : `${stats.words} words`
}
