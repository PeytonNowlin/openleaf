/**
 * Session chrome hot paths: the word-count recount and the autosave dirty check.
 *
 * jsdom numbers, not browser numbers -- they exist to show the SHAPE of the
 * cost (a per-update full document scan, a per-update full serialization) and
 * the ratio between the old and new paths, not to predict a real frame budget.
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import type { Node as PMNode } from 'prosemirror-model'
import { describe, it } from 'vitest'
import { time } from '../../../bench/_util.js'
import { plainDoc, tableDoc } from '../../../bench/docs.js'
import { documentStats } from '../src/count.js'

function docFrom(html: string): PMNode {
  return parseHtml(html, { schema: coreSchema() })
}

/** The pre-fix `countWords`: a fresh `Intl.Segmenter` on every call. */
function countWordsPerCallSegmenter(text: string): number {
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

/** The pre-fix `documentStats`: four passes, one of them a second string copy. */
function documentStatsOld(doc: PMNode) {
  const text = doc.textBetween(0, doc.content.size, ' ', ' ')
  let paragraphs = 0
  doc.descendants((node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') paragraphs += 1
    return true
  })
  return {
    words: countWordsPerCallSegmenter(text),
    characters: text.length,
    charactersExcludingSpaces: text.replace(/\s+/g, '').length,
    paragraphs,
  }
}

describe('session chrome hot paths', () => {
  it('measures', () => {
  const plain = docFrom(plainDoc())
  const tables = docFrom(tableDoc())
  // A selection-only update: same document, a different node instance.
  const plainAgain = docFrom(plainDoc())

  time('word count: OLD documentStats (100 pages, plain)', () => {
    documentStatsOld(plain)
  })
  time('word count: NEW documentStats (100 pages, plain)', () => {
    documentStats(plain)
  })

  time('word count: OLD documentStats (250 tables)', () => {
    documentStatsOld(tables)
  })
  time('word count: NEW documentStats (250 tables)', () => {
    documentStats(tables)
  })

  time('selection-only update: OLD (full recount)', () => {
    documentStatsOld(plain)
  })
  time('selection-only update: NEW (doc.eq guard, no recount)', () => {
    if (!plain.eq(plainAgain)) documentStats(plain)
  })

  time('autosave dirty check: OLD (serializeHtml, 100 pages)', () => {
    serializeHtml(plain)
  })
  time('autosave dirty check: NEW (doc.eq against baseline node)', () => {
    plain.eq(plainAgain)
  })
  })
})
