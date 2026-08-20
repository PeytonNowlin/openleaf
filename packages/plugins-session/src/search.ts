/**
 * Find and replace over a ProseMirror document.
 *
 * Matches are computed against the concatenated text of the document so a query
 * can span a mark boundary ("hel" in bold next to "lo" in roman still finds
 * "hello"). They do not span block boundaries: joining paragraphs would make
 * "end.start" match across a break the author cannot see as one string. Nor do
 * they span an inline leaf -- an image, a hard break -- because a match that
 * covered one would take it with it on Replace.
 *
 * Every offset in that concatenated text has to name a document position, so the
 * index carries a parallel `pos` table with one entry per UTF-16 code unit. That
 * table is the reason case folding happens per code point while the text is
 * built rather than with one `toLowerCase()` at the end: see `foldText`.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  caseSensitive: boolean
  matches: SearchMatch[]
  index: number
  /**
   * How many matches the transaction that produced this state replaced.
   *
   * Zero on every other transaction. Replacing rebuilds the matches against the
   * new document, which finds none of the old ones, so the count of what was
   * done has to be carried out of the command rather than recovered afterwards.
   */
  replaced: number
  /**
   * The decorations for `matches`, built once here.
   *
   * `props.decorations` is asked on every view update, doc change or not, and
   * rebuilding a set of tens of thousands of inline decorations each time is
   * enough to be felt while arrowing between hits.
   */
  decorations: DecorationSet
}

export const searchKey = new PluginKey<SearchState>('openleaf-search')

export function emptySearchState(): SearchState {
  return {
    query: '',
    caseSensitive: false,
    matches: [],
    index: -1,
    replaced: 0,
    decorations: DecorationSet.empty,
  }
}

/** Stands in for an inline leaf, so a query cannot match straight through one. */
const ATOM = '\uFFFC'

interface TextIndex {
  text: string
  /** Document position for each code unit in `text`. -1 marks a boundary. */
  pos: number[]
}

/**
 * Lowercases one code point without changing how many code units it occupies.
 *
 * `String.prototype.toLowerCase` is not length-preserving. In the BMP exactly
 * one character changes length -- U+0130 `İ`, which lowercases to `i` plus a
 * combining dot above -- and folding a whole string with it slides every
 * following character one place out of step with the position table. Searching
 * "İstanbul hello" for "hello" then found nothing, and Replace All rewrote the
 * range one character to the left, eating the space and a letter with it.
 *
 * Truncating to the incoming width loses the combining dot, which is what makes
 * `İ` fold to plain `i` and match a query typed as `i`. The worst a truncation
 * can cost is a match that is not found; it can no longer misplace one.
 */
function foldCodePoint(raw: string, units: number): string {
  const lower = raw.toLowerCase()
  if (lower.length === units) return lower
  if (lower.length > units) return lower.slice(0, units)
  return raw
}

/**
 * Case-folds a string code point by code point, preserving its code unit length.
 *
 * Both sides of the search go through this, so the query and the document are
 * folded the same way -- a whole-string `toLowerCase()` on the query would apply
 * the context-sensitive rules (final sigma, and the `İ` expansion above) that
 * this deliberately does not.
 */
function foldText(input: string): string {
  const chunks: string[] = []
  let runStart = 0
  let at = 0

  while (at < input.length) {
    const code = input.charCodeAt(at)
    // ASCII is the overwhelming majority of most documents, and `A`-`Z` is the
    // only part of it that folds -- worth spending a comparison to skip a slice
    // and a `toLowerCase` call per character.
    if (code < 0x80) {
      if (code >= 0x41 && code <= 0x5a) {
        if (runStart < at) chunks.push(input.slice(runStart, at))
        chunks.push(String.fromCharCode(code + 0x20))
        runStart = at + 1
      }
      at += 1
      continue
    }

    let units = 1
    if (code >= 0xd800 && code <= 0xdbff && at + 1 < input.length) {
      const trail = input.charCodeAt(at + 1)
      // A lone high surrogate is left as the single unit it is. Folding the pair
      // as a unit is what lets a non-BMP character -- Deseret, Adlam, Warang
      // Citi -- fold at all; per code unit, each half is unchanged.
      if (trail >= 0xdc00 && trail <= 0xdfff) units = 2
    }

    const raw = input.slice(at, at + units)
    const folded = foldCodePoint(raw, units)
    if (folded !== raw) {
      if (runStart < at) chunks.push(input.slice(runStart, at))
      chunks.push(folded)
      runStart = at + units
    }
    at += units
  }

  if (chunks.length === 0) return input
  if (runStart < input.length) chunks.push(input.slice(runStart))
  return chunks.join('')
}

function indexText(doc: PMNode, fold: boolean): TextIndex {
  // Accumulated in a list rather than with `+=`. V8 represents a `+=` chain as
  // an unflattened rope, and `endsWith` cannot run on a rope -- asking it once
  // per block flattened the entire accumulated string, making the walk
  // O(characters x blocks). `last` answers the same question in a local.
  const parts: string[] = []
  const pos: number[] = []
  let last = ''

  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (node.isBlock && last !== '' && last !== '\n') {
      parts.push('\n')
      pos.push(-1)
      last = '\n'
    }

    const text = node.isText ? node.text : undefined
    if (text !== undefined && text.length > 0) {
      const folded = fold ? foldText(text) : text
      // `foldText` preserves code unit length by construction. Falling back to
      // the raw text if it ever did not keeps `pos` in lockstep, which costs a
      // case-sensitive match here and cannot corrupt a replacement.
      const run = folded.length === text.length ? folded : text
      parts.push(run)
      for (let i = 0; i < text.length; i += 1) pos.push(nodePos + i)
      last = run.slice(-1)
      return true
    }

    // An inline leaf contributes no text of its own. Skipping it silently would
    // leave the characters either side adjacent in the index, so "hello" would
    // match across the image in `<p>hel<img>lo</p>` and Replace would delete it.
    if (node.isInline) {
      parts.push(ATOM)
      pos.push(-1)
      last = ATOM
    }
    return true
  })

  return { text: parts.join(''), pos }
}

export function findMatches(
  doc: PMNode,
  query: string,
  options: { caseSensitive?: boolean } = {},
): SearchMatch[] {
  if (query.length === 0) return []

  const caseSensitive = options.caseSensitive === true
  let { text, pos } = indexText(doc, !caseSensitive)
  let needle = caseSensitive ? query : foldText(query)

  // Match offsets are looked up in `pos` by their offset in `text`, so the two
  // must hold exactly one entry per code unit. They do by construction; if a
  // change ever breaks that, fall back to an exact search rather than index into
  // a table that no longer lines up and hand Replace the wrong range.
  if (text.length !== pos.length) {
    ;({ text, pos } = indexText(doc, false))
    needle = query
  }

  const matches: SearchMatch[] = []
  let start = 0

  while (start <= text.length - needle.length) {
    const at = text.indexOf(needle, start)
    if (at < 0) break

    let crosses = false
    for (let i = at; i < at + needle.length; i += 1) {
      if ((pos[i] ?? -1) < 0) {
        crosses = true
        break
      }
    }
    const fromPos = pos[at]
    const last = pos[at + needle.length - 1]
    if (!crosses && fromPos !== undefined && last !== undefined && fromPos >= 0 && last >= 0) {
      matches.push({ from: fromPos, to: last + 1 })
    }
    // Advancing past the whole needle is what keeps matches disjoint, which
    // `replaceAll` relies on to rewrite them without remapping.
    start = at + Math.max(needle.length, 1)
  }

  return matches
}

function decorationSet(doc: PMNode, matches: SearchMatch[], index: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  const decorations = matches.map((match, i) =>
    Decoration.inline(match.from, match.to, {
      class: i === index ? 'ol-find-hit ol-find-hit-current' : 'ol-find-hit',
    }),
  )
  return DecorationSet.create(doc, decorations)
}

function clampIndex(index: number, count: number): number {
  if (count === 0) return -1
  return index >= count ? count - 1 : index
}

function rebuild(state: EditorState, current: SearchState): SearchState {
  const matches = findMatches(state.doc, current.query, { caseSensitive: current.caseSensitive })
  const index = clampIndex(current.index, matches.length)
  return { ...current, matches, index, decorations: decorationSet(state.doc, matches, index) }
}

export function searchPlugin(): Plugin {
  return new Plugin({
    key: searchKey,
    state: {
      init: () => emptySearchState(),
      apply(tr, previous, _old, state) {
        const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined

        if (!meta) {
          if (tr.docChanged) return rebuild(state, { ...previous, replaced: 0 })
          // Nothing the search cares about moved, so the matches and the set
          // built from them still stand. `replaced` is the one thing that must
          // not survive: it is feedback for one transaction, not a fact.
          return previous.replaced === 0 ? previous : { ...previous, replaced: 0 }
        }

        const next: SearchState = { ...previous, replaced: 0, ...meta }
        // Nothing that decides what matches has moved: same query, same folding,
        // same document, and the meta is not handing us a list of its own.
        const matchesStillStand =
          next.query === previous.query &&
          next.caseSensitive === previous.caseSensitive &&
          meta.matches === undefined &&
          !tr.docChanged
        if (matchesStillStand) {
          // Stepping between hits changes only which one is current. Searching
          // the document again for that is the cost paid on every press of Next
          // on a document with a lot of hits.
          const index = clampIndex(next.index, previous.matches.length)
          return {
            ...next,
            matches: previous.matches,
            index,
            decorations: decorationSet(state.doc, previous.matches, index),
          }
        }
        return rebuild(state, next)
      },
    },
    props: {
      decorations(state) {
        return searchKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

export function setSearch(query: string, caseSensitive = false): Command {
  return (state, dispatch) => {
    if (!dispatch) return true
    dispatch(state.tr.setMeta(searchKey, { query, caseSensitive, index: -1 }))
    return true
  }
}

function selectMatch(state: EditorState, index: number): Transaction | null {
  const search = searchKey.getState(state)
  const match = search?.matches[index]
  if (!match) return null
  return state.tr
    .setSelection(TextSelection.create(state.doc, match.from, match.to))
    .scrollIntoView()
    .setMeta(searchKey, { index })
}

function stepMatch(state: EditorState, direction: 1 | -1): number | null {
  const search = searchKey.getState(state)
  if (!search || search.matches.length === 0) return null
  const count = search.matches.length
  if (search.index < 0) {
    const pos = state.selection.from
    if (direction === 1) {
      const after = search.matches.findIndex((match) => match.from >= pos)
      return after < 0 ? 0 : after
    }
    for (let i = count - 1; i >= 0; i -= 1) {
      const match = search.matches[i]
      if (match && match.from <= pos) return i
    }
    return count - 1
  }
  return (search.index + direction + count) % count
}

export const findNext: Command = (state, dispatch) => {
  const index = stepMatch(state, 1)
  if (index === null) return false
  if (!dispatch) return true
  const tr = selectMatch(state, index)
  if (!tr) return false
  dispatch(tr)
  return true
}

export const findPrev: Command = (state, dispatch) => {
  const index = stepMatch(state, -1)
  if (index === null) return false
  if (!dispatch) return true
  const tr = selectMatch(state, index)
  if (!tr) return false
  dispatch(tr)
  return true
}

/**
 * The marks of the text standing at `pos`, not the marks the caret would inherit.
 *
 * `$pos.marks()` answers "what would I type in", which at a mark boundary is
 * taken from the character *before* the position: replacing the plain "hello" in
 * `<p><strong>x</strong>hello</p>` would come back bold, and replacing bold text
 * that follows plain text would come back plain. A replacement has to wear the
 * marks of the text it stands in for, which is the text node starting at `pos`.
 */
function marksAt(doc: PMNode, pos: number): readonly Mark[] {
  const $pos = doc.resolve(pos)
  const after = $pos.nodeAfter
  return after?.isText ? after.marks : $pos.marks()
}

export function replaceCurrent(replacement: string): Command {
  return (state, dispatch) => {
    const search = searchKey.getState(state)
    if (!search) return false
    // Opening the find bar leaves no current match -- `setSearch` sets -1 -- so
    // without this Replace did nothing at all until Next had been pressed, on a
    // button that was never disabled and reported nothing back. Replace now acts
    // on the hit Next would have taken you to.
    const index = search.index >= 0 ? search.index : stepMatch(state, 1)
    const match = index === null ? undefined : search.matches[index]
    if (!match || index === null) return false
    if (!dispatch) return true

    const marks = marksAt(state.doc, match.from)
    let tr = state.tr
    if (replacement.length === 0) tr = tr.delete(match.from, match.to)
    else tr = tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks))
    dispatch(
      tr.setMeta(searchKey, {
        query: search.query,
        caseSensitive: search.caseSensitive,
        index,
        replaced: 1,
      }),
    )
    return true
  }
}

export function replaceAll(replacement: string): Command {
  return (state, dispatch) => {
    const search = searchKey.getState(state)
    if (!search || search.matches.length === 0) return false
    if (!dispatch) return true

    const count = search.matches.length
    let tr = state.tr
    // Back to front, and with the original positions. Matches are disjoint and
    // in ascending order, so replacing a later one cannot move an earlier one --
    // mapping each position through the accumulated steps asked `Mapping.map` to
    // walk every step taken so far, twice per match, which made a document-wide
    // replace quadratic in the number of hits.
    for (let i = count - 1; i >= 0; i -= 1) {
      const match = search.matches[i]
      if (!match) continue
      const marks = marksAt(state.doc, match.from)
      if (replacement.length === 0) tr = tr.delete(match.from, match.to)
      else tr = tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks))
    }
    dispatch(
      tr.setMeta(searchKey, {
        query: search.query,
        caseSensitive: search.caseSensitive,
        index: -1,
        replaced: count,
      }),
    )
    return true
  }
}

export const clearSearch: Command = (state, dispatch) => {
  if (!dispatch) return true
  dispatch(state.tr.setMeta(searchKey, emptySearchState()))
  return true
}
