/**
 * Syntax highlighting for code blocks, as ProseMirror decorations.
 *
 * Decorations rather than a node view: the document is never touched, so nothing
 * here can alter what gets stored. Highlighting is a rendering concern and it
 * stays one -- the worst a bug in this file can do is colour something oddly.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { highlight } from './highlighter.js'
import type { Token } from './tokenize.js'

export const highlightPluginKey = new PluginKey('openleaf-highlight')

/**
 * Blocks longer than this are left unhighlighted.
 *
 * Tokenizing runs on every document change, and a pathological paste -- a
 * minified bundle dropped into a code block -- would otherwise make typing
 * anywhere in the document stutter. Plain text in a code block is a small loss;
 * an editor that lags on every keystroke is not.
 */
export const MAX_HIGHLIGHT_LENGTH = 20_000

/**
 * Tokens per code-block node.
 *
 * ProseMirror nodes are immutable and persistent, so a node that survives a
 * transaction is the same object and its tokens cannot have gone stale. A node
 * whose text or language changed is a different object, and misses.
 */
const tokensFor = new WeakMap<PMNode, readonly Token[] | null>()

function tokens(node: PMNode): readonly Token[] | null {
  const known = tokensFor.get(node)
  // `null` is a real answer -- no language, too long, no grammar for it -- so
  // the miss test is `undefined`, not falsiness.
  if (known !== undefined) return known
  const language = node.attrs['language'] as string | null
  const text = node.textContent
  const computed =
    language && text.length > 0 && text.length <= MAX_HIGHLIGHT_LENGTH
      ? highlight(text, language)
      : null
  tokensFor.set(node, computed ?? null)
  return computed ?? null
}

/**
 * Decorations for one code block.
 *
 * Adjacent tokens of the same class become one decoration. A run of punctuation
 * in minified source is otherwise one decoration per character, and every one of
 * them is a span the browser has to build and lay out.
 */
function decorateBlock(node: PMNode, pos: number, out: Decoration[]): void {
  const parts = tokens(node)
  if (!parts) return
  // +1 to step inside the node's own opening boundary.
  let from = pos + 1
  let runStart = -1
  let runType = ''
  for (const token of parts) {
    const to = from + token.value.length
    if (token.type === runType && runStart >= 0) {
      // Same class as the run in progress: extend it rather than close it.
    } else {
      if (runStart >= 0 && runType !== 'text') {
        out.push(Decoration.inline(runStart, from, { class: `ol-t-${runType}` }))
      }
      runStart = from
      runType = token.type
    }
    from = to
  }
  if (runStart >= 0 && runType !== 'text') {
    out.push(Decoration.inline(runStart, from, { class: `ol-t-${runType}` }))
  }
}

/** Every code-block decoration in `[from, to]`, and the blocks they came from. */
function decorationsIn(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'code_block') return true
    decorateBlock(node, pos, out)
    return false
  })
  return out
}

/**
 * The span of the new document a transaction touched, or null if it touched none.
 *
 * Each step's map reports positions in the document that step produced, which
 * for every step but the last is not `tr.doc`. Slicing the mapping per step to
 * fix that is quadratic, so the accumulated range is carried forward one step at
 * a time instead, which is linear.
 */
/**
 * The shape of a `StepMap`, spelled out rather than imported.
 *
 * This package does not depend on `prosemirror-transform` and should not start
 * doing so to name one parameter -- a second copy of that module in a
 * consumer's tree is exactly the singleton hazard the peer-dependency work
 * exists to prevent.
 */
interface StepMapLike {
  map(pos: number, assoc?: number): number
  forEach(f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void
}

function changedRange(maps: readonly StepMapLike[]): { from: number; to: number } | null {
  let from = -1
  let to = -1
  for (const map of maps) {
    if (from > -1) {
      from = map.map(from, -1)
      to = map.map(to, 1)
    }
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = from < 0 ? newStart : Math.min(from, newStart)
      to = to < 0 ? newEnd : Math.max(to, newEnd)
    })
  }
  return from < 0 ? null : { from, to }
}

export function codeBlockHighlighting(): Plugin {
  return new Plugin({
    key: highlightPluginKey,
    state: {
      init: (_config, state) =>
        DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size)),
      /**
       * Map what exists; re-tokenize only what the transaction touched.
       *
       * This used to be `tr.docChanged ? decorationsFor(tr.doc) : previous.map(...)`,
       * which is the two cases the wrong way round: it took the cheap path when
       * nothing had changed and rebuilt every decoration in the document
       * whenever anything had -- including a keystroke in a paragraph nowhere
       * near a code block, which is a `docChanged` transaction like any other.
       * The dominant cost was never the tokenizer; it was `DecorationSet.create`
       * over the whole document, 65.8 ms of the 78.7 ms measured at twenty
       * blocks, and it grew with the document rather than with the edit.
       */
      apply(tr, previous) {
        if (!tr.docChanged) return previous
        const set = previous.map(tr.mapping, tr.doc)
        const changed = changedRange(tr.mapping.maps)
        if (!changed) return set
        // Widened to whole code blocks: a block half inside the edited range
        // must be rebuilt entirely, or the half outside keeps decorations that
        // the removal below did not take out and the rebuild adds again.
        const blocks: Array<{ node: PMNode; pos: number }> = []
        tr.doc.nodesBetween(changed.from, changed.to, (node, pos) => {
          if (node.type.name !== 'code_block') return true
          blocks.push({ node, pos })
          return false
        })
        if (blocks.length === 0) return set
        // Block by block, so the span cleared is exactly the span rebuilt and
        // no decoration outside a touched block can be caught in it.
        let kept = set
        const fresh: Decoration[] = []
        for (const { node, pos } of blocks) {
          const stale = kept.find(pos, pos + node.nodeSize)
          if (stale.length > 0) kept = kept.remove(stale)
          decorateBlock(node, pos, fresh)
        }
        return fresh.length > 0 ? kept.add(tr.doc, fresh) : kept
      },
    },
    props: {
      decorations(state) {
        return highlightPluginKey.getState(state) as DecorationSet | undefined
      },
    },
  })
}
