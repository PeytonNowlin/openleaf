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

export const highlightPluginKey = new PluginKey('openleaf-highlight')

/**
 * Blocks longer than this are left unhighlighted.
 *
 * Tokenizing runs on every document change, and a pathological paste -- a
 * minified bundle dropped into a code block -- would otherwise make typing
 * anywhere in the document stutter. Plain text in a code block is a small loss;
 * an editor that lags on every keystroke is not.
 */
const MAX_HIGHLIGHT_LENGTH = 20_000

function decorationsFor(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true

    const language = node.attrs['language'] as string | null
    if (!language) return false

    const text = node.textContent
    if (text.length === 0 || text.length > MAX_HIGHLIGHT_LENGTH) return false

    const tokens = highlight(text, language)
    if (!tokens) return false

    // +1 to step inside the node's own opening boundary.
    let from = pos + 1
    for (const token of tokens) {
      const to = from + token.value.length
      if (token.type !== 'text') {
        decorations.push(Decoration.inline(from, to, { class: `ol-t-${token.type}` }))
      }
      from = to
    }
    return false
  })

  return DecorationSet.create(doc, decorations)
}

export function codeBlockHighlighting(): Plugin {
  return new Plugin({
    key: highlightPluginKey,
    state: {
      init: (_config, state) => decorationsFor(state.doc),
      apply(tr, previous) {
        // Rebuilt only when the text actually changed. Mapping through a
        // selection-only transaction keeps typing outside a code block free.
        return tr.docChanged ? decorationsFor(tr.doc) : previous.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return highlightPluginKey.getState(state) as DecorationSet | undefined
      },
    },
  })
}
