/**
 * Document statistics.
 *
 * Word counts use `Intl.Segmenter` when the engine has it, so CJK text is not
 * reported as a single "word" the way a whitespace split would. Engines without
 * a segmenter fall back to splitting on whitespace, which is what Latin-script
 * documents already expect.
 */

import { t, uiLocale, withLocale } from '@openleaf-editor/ui'
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
