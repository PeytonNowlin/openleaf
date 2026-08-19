/**
 * Find and replace over a ProseMirror document.
 *
 * Matches are computed against the concatenated text of the document so a query
 * can span a mark boundary ("hel" in bold next to "lo" in roman still finds
 * "hello"). They do not span block boundaries: joining paragraphs would make
 * "end.start" match across a break the author cannot see as one string.
 */

import type { Node as PMNode } from 'prosemirror-model'
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
}

export const searchKey = new PluginKey<SearchState>('openleaf-search')

export function emptySearchState(): SearchState {
  return { query: '', caseSensitive: false, matches: [], index: -1 }
}

interface TextIndex {
  text: string
  /** Document position for each character in `text`. -1 marks a block break. */
  pos: number[]
}

function indexText(doc: PMNode): TextIndex {
  let text = ''
  const pos: number[] = []

  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n'
      pos.push(-1)
    }
    if (!node.isText || !node.text) return true
    for (let i = 0; i < node.text.length; i += 1) {
      text += node.text[i]
      pos.push(nodePos + i)
    }
    return true
  })

  return { text, pos }
}

export function findMatches(
  doc: PMNode,
  query: string,
  options: { caseSensitive?: boolean } = {},
): SearchMatch[] {
  if (query.length === 0) return []

  const { text, pos } = indexText(doc)
  const hay = options.caseSensitive === true ? text : text.toLowerCase()
  const needle = options.caseSensitive === true ? query : query.toLowerCase()
  const matches: SearchMatch[] = []
  let start = 0

  while (start <= hay.length - needle.length) {
    const at = hay.indexOf(needle, start)
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
    start = at + Math.max(needle.length, 1)
  }

  return matches
}

function rebuild(state: EditorState, current: SearchState): SearchState {
  const matches = findMatches(state.doc, current.query, { caseSensitive: current.caseSensitive })
  let index = current.index
  if (matches.length === 0) index = -1
  else if (index >= matches.length) index = matches.length - 1
  return { ...current, matches, index }
}

function decorationSet(doc: PMNode, search: SearchState): DecorationSet {
  const decorations = search.matches.map((match, i) =>
    Decoration.inline(match.from, match.to, {
      class: i === search.index ? 'ol-find-hit ol-find-hit-current' : 'ol-find-hit',
    }),
  )
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
}

export function searchPlugin(): Plugin {
  return new Plugin({
    key: searchKey,
    state: {
      init: () => emptySearchState(),
      apply(tr, previous, _old, state) {
        const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined
        const next: SearchState = meta ? { ...previous, ...meta } : previous
        if (tr.docChanged || meta) return rebuild(state, next)
        return next
      },
    },
    props: {
      decorations(state) {
        const search = searchKey.getState(state)
        return search ? decorationSet(state.doc, search) : DecorationSet.empty
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

export function replaceCurrent(replacement: string): Command {
  return (state, dispatch) => {
    const search = searchKey.getState(state)
    if (!search) return false
    const match = search.matches[search.index]
    if (!match) return false
    if (!dispatch) return true

    const marks = state.doc.resolve(match.from).marks()
    let tr = state.tr
    if (replacement.length === 0) tr = tr.delete(match.from, match.to)
    else tr = tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks))
    dispatch(tr.setMeta(searchKey, { query: search.query, caseSensitive: search.caseSensitive }))
    return true
  }
}

export function replaceAll(replacement: string): Command {
  return (state, dispatch) => {
    const search = searchKey.getState(state)
    if (!search || search.matches.length === 0) return false
    if (!dispatch) return true

    let tr = state.tr
    for (let i = search.matches.length - 1; i >= 0; i -= 1) {
      const match = search.matches[i]
      if (!match) continue
      const mappedFrom = tr.mapping.map(match.from)
      const mappedTo = tr.mapping.map(match.to)
      const marks = tr.doc.resolve(mappedFrom).marks()
      if (replacement.length === 0) tr = tr.delete(mappedFrom, mappedTo)
      else tr = tr.replaceWith(mappedFrom, mappedTo, state.schema.text(replacement, marks))
    }
    dispatch(tr.setMeta(searchKey, { query: search.query, caseSensitive: search.caseSensitive, index: -1 }))
    return true
  }
}

export const clearSearch: Command = (state, dispatch) => {
  if (!dispatch) return true
  dispatch(state.tr.setMeta(searchKey, emptySearchState()))
  return true
}
