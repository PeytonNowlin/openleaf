/**
 * Turn a typed URL into a link when the author finishes it.
 *
 * Space, Enter, and the end of an IME composition are the commit points,
 * matching the behaviour authors already have in mail clients and office
 * software. The plugin never rewrites a range that is already a link, and it
 * refuses anything `isSafeUrl` would drop, so typing `javascript:` cannot
 * become a mark the serializer would then emit. It also never `addMark`s
 * while `view.composing` is true: rewriting the document under an open IME
 * is how keyboards start duplicating or dropping characters.
 *
 * The mark is never its own undo event. `AddMarkStep` maps no positions, so
 * `prosemirror-history` treats a standalone mark as non-adjacent and starts a
 * new group — Ctrl+Z then peels the link off and leaves the URL (#182). Space
 * and Enter therefore add the mark from `appendTransaction`, which ProseMirror
 * tags with `appendedTransaction` so history folds it into the keystroke.
 * `compositionend` cannot append (it fires on a timeout after the composition
 * transactions), so that dispatch sets the same meta by hand.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { isSafeUrl } from './url.js'

const key = new PluginKey('openleaf-autolink')

/**
 * A URL at the end of a typed run. Parentheses are in the match so
 * `(www.example.com)` and `Foo_(bar)` can both be considered; the strip below
 * decides which trailing `)` is prose and which is the URL. Angle brackets stay
 * out because they are HTML delimiters, not URL characters we want to mark.
 */
const TRAILING_URL = /(?:https?:\/\/|www\.)[^\s<>]+$/i

/**
 * Closers that end a URL in a sentence, a citation, or quotes. `)` is handled
 * separately: a trailing one is prose when unmatched, and part of the URL when
 * it balances an earlier `(`.
 */
const TRAILING_PUNCTUATION = /[.,;:!?\]}'"]/

function stripTrailingUrlPunctuation(token: string): string {
  let s = token
  while (s.length > 0) {
    const last = s.charAt(s.length - 1)
    if (TRAILING_PUNCTUATION.test(last)) {
      s = s.slice(0, -1)
      continue
    }
    if (last === ')') {
      let opens = 0
      let closes = 0
      for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i)
        if (ch === '(') opens++
        else if (ch === ')') closes++
      }
      if (closes > opens) {
        s = s.slice(0, -1)
        continue
      }
    }
    break
  }
  return s
}

export function hrefFromTypedUrl(raw: string): string | null {
  const trimmed = stripTrailingUrlPunctuation(raw)
  if (!trimmed) return null
  const href = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed
  return isSafeUrl(href) ? href : null
}

function trailingUrl(state: EditorState, end: number): { from: number; to: number; href: string } | null {
  const $end = state.doc.resolve(end)
  if (!$end.parent.isTextblock) return null
  const parentStart = $end.start()
  const raw = $end.parent.textBetween(0, $end.parentOffset, undefined, '\ufffc')
  const trimmed = raw.replace(/[\s\u00a0]+$/, '')
  const match = TRAILING_URL.exec(trimmed)
  if (!match) return null
  const token = match[0]
  const bare = stripTrailingUrlPunctuation(token)
  if (!bare) return null
  const href = hrefFromTypedUrl(bare)
  if (!href) return null
  const from = parentStart + (match.index ?? 0)
  const to = from + bare.length
  if (from >= to) return null
  const link = state.schema.marks['link']
  if (!link) return null
  if (state.doc.rangeHasMark(from, to, link)) return null
  return { from, to, href }
}

function applyAutolink(state: EditorState, end: number): Transaction | null {
  const found = trailingUrl(state, end)
  if (!found) return null
  const link = state.schema.marks['link']
  if (!link) return null
  return state.tr.addMark(found.from, found.to, link.create({ href: found.href }))
}

function maybeAutolink(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  end: number,
  groupWithPrevious = false,
): boolean {
  const tr = applyAutolink(view.state, end)
  if (!tr) return false
  tr.setMeta(key, true)
  // Same metadata `EditorState.applyTransaction` sets on a plugin's
  // `appendTransaction` result. History reads it as "this belongs to the
  // event already in progress" and will not open a new undo group, even
  // though `AddMarkStep` is not adjacent to the text that was just typed.
  if (groupWithPrevious) tr.setMeta('appendedTransaction', tr)
  view.dispatch(tr)
  return true
}

/**
 * After Enter (or any split that leaves the caret at the start of the next
 * textblock), the URL lives at the end of the previous block. Space is handled
 * separately because the caret stays in the same block, after the space.
 *
 * `$new.pos <= $old.pos` filters Backspace-at-start and deleting the first
 * character of a paragraph: those also leave `parentOffset === 0` but must
 * not autolink the block above.
 */
function urlEndAfterBlockSplit(oldState: EditorState, newState: EditorState): number | null {
  if (!oldState.selection.empty || !newState.selection.empty) return null
  const $old = oldState.selection.$from
  const $new = newState.selection.$from
  if (!$old.parent.isTextblock || !$new.parent.isTextblock) return null
  if ($new.parentOffset !== 0 || $new.depth < 1) return null
  if ($new.pos <= $old.pos) return null
  return $new.before($new.depth) - 1
}

export function autolinkPlugin(): Plugin {
  // `appendTransaction` is handed states, not the view, and the composing
  // guard is a property of the view. The `view` prop is the supported way to
  // reach one: PM calls it once per editor this plugin is installed in, and
  // `autolinkPlugin()` mints a fresh plugin per editor, so this holds the view
  // that owns the transactions `appendTransaction` sees.
  let host: EditorView | null = null

  return new Plugin({
    key,
    view(editorView) {
      host = editorView
      return {
        destroy() {
          host = null
        },
      }
    },
    appendTransaction(transactions, oldState, newState) {
      // The same guard `compositionend` carries, and the one this path was
      // missing: a composing IME reaches here through `readDOMChange`, which
      // dispatches a doc-changing transaction per composition update. A
      // composition buffer that happens to hold a space after a URL would
      // otherwise get an `addMark` under the open IME -- the exact rewrite the
      // header comment says never happens.
      if (host?.composing) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      if (transactions.some((tr) => tr.getMeta(key))) return null
      const $from = newState.selection.$from
      if ($from.parent.isTextblock && $from.parentOffset > 0) {
        const prev = $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset)
        if (prev === ' ' || prev === '\u00a0') {
          const tr = applyAutolink(newState, $from.pos)
          return tr ? tr.setMeta(key, true) : null
        }
      }
      // Enter used to `dispatch` the mark from `handleKeyDown` and return
      // false, so the keymap's split was a second undo event. Folding the
      // mark into this appended transaction keeps one Enter as one Ctrl+Z.
      const end = urlEndAfterBlockSplit(oldState, newState)
      if (end == null) return null
      const tr = applyAutolink(newState, end)
      return tr ? tr.setMeta(key, true) : null
    },
    props: {
      handleDOMEvents: {
        compositionend(view) {
          // This prop runs *before* PM's compositionend (which sets composing=false,
          // then flushes pending records on a microtask). Never return true.
          setTimeout(() => {
            if (view.isDestroyed || view.composing) return
            maybeAutolink(view, view.state.selection.from, true)
          }, 0)
          return false
        },
      },
    },
  })
}
