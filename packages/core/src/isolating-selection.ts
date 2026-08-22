/**
 * Keep a `TextSelection` from straddling an isolating boundary.
 *
 * `isolating: true` already means ProseMirror will not join or lift across that
 * node. `Selection.near` honours it when *finding* a caret; `TextSelection.between`
 * does not when *building* a range, so Firefox and WebKit can report a selection
 * that starts in a `<blockquote>` and ends in a following `<details>`. Typing
 * then runs `replaceSelection`, which tries to nest the leftover `details` in
 * the quote (legal: `blockquote` is `block+`, `details` is `group: 'block'`) and
 * join, and `content: 'summary block+'` refuses with `TransformError`.
 *
 * The throw escapes the input handler. ProseMirror re-derives the document from
 * the DOM, history never sees a step, and Ctrl+Z cannot undo the mangling.
 *
 * Chromium already clamps at the isolating boundary natively. This plugin does
 * the same for every isolating node, not just `details`: after a transaction,
 * a crossing `TextSelection` is narrowed to the side the anchor sits on. Input
 * handlers also refuse to let a throwing replace run, so even a race with the
 * native selection cannot rewrite the document outside history.
 *
 * `CellSelection` / `AllSelection` / `NodeSelection` are left alone. Select-all
 * is an `AllSelection` in the base keymap; a `TextSelection` that merely
 * contains a whole isolating node (both endpoints outside it) is not crossing.
 */

import type { ResolvedPos } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

const key = new PluginKey('openleaf-isolating-selection')

/** Depth of the innermost isolating ancestor, or 0 if the pos sits in none. */
export function innermostIsolatingDepth($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.isolating) return depth
  }
  return 0
}

/**
 * True when the endpoints do not share an isolating ancestor: one is inside a
 * given isolating node and the other is not (or is inside a different one).
 */
export function textSelectionCrossesIsolating(selection: Selection): boolean {
  if (!(selection instanceof TextSelection) || selection.empty) return false
  return !sameIsolatingContext(selection.$from, selection.$to)
}

function sameIsolatingContext($a: ResolvedPos, $b: ResolvedPos): boolean {
  const depthA = innermostIsolatingDepth($a)
  const depthB = innermostIsolatingDepth($b)
  if (depthA === 0 && depthB === 0) return true
  if (depthA === 0 || depthB === 0) return false
  return $a.before(depthA) === $b.before(depthB)
}

/**
 * Narrow a crossing text selection to the isolating context that contains the
 * anchor, or to just outside the isolating node that contains the head when the
 * anchor itself sits in none. Same-context selections are returned unchanged.
 */
export function clampIsolatingTextSelection(selection: TextSelection): TextSelection {
  if (selection.empty || sameIsolatingContext(selection.$anchor, selection.$head)) {
    return selection
  }

  const { $anchor, $head } = selection
  const doc = $anchor.doc
  const anchorDepth = innermostIsolatingDepth($anchor)

  if (anchorDepth > 0) {
    const min = $anchor.start(anchorDepth)
    const max = $anchor.end(anchorDepth)
    const head = Math.max(min, Math.min(max, $head.pos))
    if (head === $head.pos) return selection
    const next = TextSelection.between($anchor, doc.resolve(head))
    return next instanceof TextSelection ? next : selection
  }

  const headDepth = innermostIsolatingDepth($head)
  if (headDepth > 0) {
    const before = $head.before(headDepth)
    const after = $head.after(headDepth)
    const boundary = $anchor.pos <= before ? before : after
    const next = TextSelection.between($anchor, doc.resolve(boundary))
    return next instanceof TextSelection ? next : selection
  }

  return selection
}

function tryInsertText(view: EditorView, from: number, to: number, text: string): boolean {
  try {
    view.state.tr.insertText(text, from, to)
    return true
  } catch {
    return false
  }
}

export function isolatingSelectionPlugin(): Plugin {
  return new Plugin({
    key,
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((tr) => tr.getMeta(key))) return null
      const { selection } = newState
      if (!(selection instanceof TextSelection) || selection.empty) return null
      const clamped = clampIsolatingTextSelection(selection)
      if (clamped.eq(selection)) return null
      return newState.tr.setSelection(clamped).setMeta(key, true)
    },
    props: {
      /*
       * `from`/`to` are the view's idea of the range at the moment of the
       * input event. The DOM can still report a crossing range in the same
       * tick as a keystroke, before `appendTransaction` has run, so the
       * default `insertText` would throw. Building the transaction first is
       * what keeps a throw from ever reaching ProseMirror's input handler:
       * that handler does not catch, and the DOM-derived repair that follows
       * is the corruption that cannot be undone.
       */
      handleTextInput(view, from, to, text) {
        const { doc, selection } = view.state
        const size = doc.content.size
        const start = Math.max(0, Math.min(from, size))
        const end = Math.max(start, Math.min(to, size))
        let replaceFrom = start
        let replaceTo = end
        if (start !== end) {
          const probe = TextSelection.create(doc, start, end)
          const oriented =
            selection instanceof TextSelection && selection.anchor === end
              ? new TextSelection(probe.$to, probe.$from)
              : probe
          const clamped = clampIsolatingTextSelection(oriented)
          replaceFrom = Math.min(clamped.from, clamped.to)
          replaceTo = Math.max(clamped.from, clamped.to)
        }

        if (!tryInsertText(view, replaceFrom, replaceTo, text)) return true
        if (replaceFrom === start && replaceTo === end) return false
        view.dispatch(view.state.tr.insertText(text, replaceFrom, replaceTo).scrollIntoView())
        return true
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' && event.key !== 'Delete' && event.key !== 'Enter') {
          return false
        }
        const { selection } = view.state
        if (!(selection instanceof TextSelection) || selection.empty) return false
        if (!textSelectionCrossesIsolating(selection)) return false
        const clamped = clampIsolatingTextSelection(selection)
        try {
          view.state.tr.setSelection(clamped).deleteSelection()
        } catch {
          return true
        }
        view.dispatch(view.state.tr.setSelection(clamped))
        return false
      },
    },
  })
}
