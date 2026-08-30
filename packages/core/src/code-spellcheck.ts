/**
 * Stop the browser spell-checking code.
 *
 * `spellcheck="false"` on `<openleaf-editor>` is documented as the canvas-wide
 * off switch, and source view has always hard-coded it on its textarea. The
 * canvas had nothing between those two: a `<pre>` full of identifiers and a
 * `<code>` run in a sentence were checked as prose, so every `getElementById`
 * carried a red squiggle in an editor whose author had asked for spellchecking
 * of their *writing*. This is not the same question as the host attribute and
 * it is not conditional on it -- `spellcheck="true"` means "check my prose",
 * and code is not prose either way.
 *
 * ## Decorations, not `toDOM`
 *
 * The obvious fix -- `['pre', { spellcheck: 'false' }, ...]` in the schema -- is
 * wrong, because `serializeHtml` serializes with `DOMSerializer.fromSchema`, so
 * the same `toDOM` that renders the canvas writes the stored HTML. That fix
 * would put an editor-chrome attribute into every saved document and into every
 * fidelity comparison. Decorations are view-only by construction: the worst a
 * bug in this file can do is check, or fail to check, some spelling.
 *
 * ## What this does not fix
 *
 * WebKit honours `spellcheck` on the editing host rather than on descendants
 * inside it, so on Safari and every iOS browser the squiggles stay. There is no
 * DOM-level workaround short of a node view that removes the text from the
 * editable tree, which costs far more than it buys. Chromium and Gecko, which
 * do respect the attribute per element, are the browsers this helps.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { changedRange, widenToTopLevel } from './decoration-range.js'

const key = new PluginKey<DecorationSet>('openleaf-code-spellcheck')

/**
 * One shared attrs object rather than a literal per decoration.
 *
 * A long minified paste is one decoration per code run, and ProseMirror
 * compares decoration attrs when it decides what to redraw; sharing the object
 * makes that comparison a pointer check.
 */
const OFF = { spellcheck: 'false' }

/** Marks named `code`, which is the inline `<code>` this schema and its extensions use. */
function isCodeMark(node: PMNode): boolean {
  return node.marks.some((mark) => mark.type.name === 'code')
}

/**
 * Decorate each run of inline `<code>` in one inline container.
 *
 * Adjacent text nodes are merged into one decoration. A `<code>` run that also
 * carries bold is two text nodes in ProseMirror's model, and decorating each
 * separately would put two spans where the DOM already has one element.
 */
function markInlineCode(parent: PMNode, contentStart: number, out: Decoration[]): void {
  let offset = 0
  let from = -1
  let to = -1
  parent.forEach((child) => {
    const start = contentStart + offset
    offset += child.nodeSize
    if (!isCodeMark(child)) {
      if (from >= 0) out.push(Decoration.inline(from, to, OFF))
      from = -1
      return
    }
    // Contiguous with the run in progress: extend it rather than close it.
    if (from >= 0 && to === start) {
      to = start + child.nodeSize
      return
    }
    if (from >= 0) out.push(Decoration.inline(from, to, OFF))
    from = start
    to = start + child.nodeSize
  })
  if (from >= 0) out.push(Decoration.inline(from, to, OFF))
}

/** Every code decoration for the nodes overlapping `[from, to]`. */
function decorationsIn(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    // Text is scanned from its parent, which is where the offsets are known.
    if (node.isText) return false
    // `spec.code` rather than a `code_block` name test, so a schema extension
    // that adds its own code-holding node is covered by the same rule its
    // ProseMirror semantics already declare.
    if (node.type.spec.code) {
      out.push(Decoration.node(pos, pos + node.nodeSize, OFF))
      // The attribute is inherited by everything below, and a `code_block`
      // holds no marks anyway.
      return false
    }
    if (node.inlineContent && node.content.size > 0) markInlineCode(node, pos + 1, out)
    return true
  })
  return out
}

export function codeSpellcheckPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init(_config, state) {
        return DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size))
      },
      apply(tr, set) {
        if (!tr.docChanged) return set
        const changed = changedRange(tr)
        const mapped = set.map(tr.mapping, tr.doc)
        if (!changed) return mapped
        const { from, to } = widenToTopLevel(tr.doc, changed.from, changed.to)
        // `find` reports a decoration that merely *touches* the range, and a
        // code block ending exactly where the rebuilt range starts is the
        // common case: it is the block above the paragraph being typed in.
        // Removing it and then rebuilding only `[from, to]` -- which
        // `nodesBetween` does not revisit it in -- dropped the attribute off
        // every code block as soon as the author typed in the block after it.
        // Only what is wholly inside the range is stale.
        const stale = mapped.find(from, to).filter((d) => d.from >= from && d.to <= to)
        const kept = stale.length > 0 ? mapped.remove(stale) : mapped
        return kept.add(tr.doc, decorationsIn(tr.doc, from, to))
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)
      },
    },
  })
}
