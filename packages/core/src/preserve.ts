/**
 * The content-preservation layer.
 *
 * ProseMirror is schema-strict: anything its schema does not recognise is
 * silently discarded. TinyMCE is permissive: it round-trips almost
 * anything. That difference is the single largest risk in replacing
 * TinyMCE with a ProseMirror-based editor, because the failure mode is
 * not an error -- it is a customer opening a ten-year-old blog post,
 * pressing Save, and losing a section of it with no warning.
 *
 * This module makes that failure impossible by construction. Unrecognised
 * markup is captured verbatim into an atom node rather than dropped, and
 * re-emitted byte-identical on serialization.
 *
 * The governing distinction:
 *
 *   NORMALIZATION is allowed.  `<div>hi</div>` becoming `<p>hi</p>` is
 *   fine -- no information is lost, the markup is merely made canonical.
 *
 *   INFORMATION LOSS is not.   `<div class="callout">hi</div>` becoming
 *   `<p>hi</p>` silently destroys the author's intent. The class was
 *   load-bearing and we had no way to know it wasn't.
 *
 * So the rule is not "is this tag known?" but "would unwrapping this
 * lose information?" A bare structural wrapper unwraps. The moment an
 * element carries an attribute we cannot represent, it becomes opaque
 * and is preserved intact.
 */

import type { NodeSpec } from 'prosemirror-model'

/**
 * Elements that contribute no meaning of their own -- pure structural
 * wrappers. Unwrapping one of these loses nothing, PROVIDED it carries no
 * attributes.
 *
 * Deliberately excluded, because they do carry meaning we would lose:
 *   figure/figcaption (image semantics -- belongs to a real node type)
 *   center, font       (presentational intent)
 *   ins, del           (revision semantics)
 *   details, summary   (interaction semantics)
 */
const TRANSPARENT_CONTAINERS: ReadonlySet<string> = new Set([
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'span',
  'hgroup',
])

/**
 * True when this element can be unwrapped without losing information.
 *
 * Conservative on purpose: ANY attribute makes an element opaque, even a
 * seemingly harmless one. We would rather preserve a redundant `id` than
 * guess wrong about a `data-` attribute some integration depends on.
 * Over-preserving is visible and correctable by the user; under-
 * preserving is invisible and permanent.
 */
export function isLosslesslyUnwrappable(el: Element): boolean {
  if (!TRANSPARENT_CONTAINERS.has(el.nodeName.toLowerCase())) return false
  return el.attributes.length === 0
}

/** Rebuild a DOM element from stored markup. `<template>` is used because
 *  its parsing context permits otherwise-illegal fragments such as a bare
 *  `<tr>`, which a `<div>` container would silently discard. */
function elementFromHtml(html: string, doc: Document): Element | null {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  return tpl.content.firstElementChild
}

function ownerDocument(): Document {
  if (typeof document === 'undefined') {
    throw new Error(
      '@openleaf/core: no global `document` available. Preserved content ' +
        'needs a DOM to re-serialize. On the server, pass an explicit ' +
        'document to parseHtml/serializeHtml.',
    )
  }
  return document
}


/**
 * Rebuild preserved markup, or -- if it somehow will not re-parse -- carry it
 * out on a data attribute rather than dropping it.
 *
 * This fallback should be unreachable, because the stored string came from
 * `outerHTML` of an element the browser had already parsed. It exists anyway:
 * emitting something slightly odd is always preferable to destroying a user's
 * content, and an unreachable branch that preserves data costs nothing.
 */
function rebuildOrCarry(html: string, fallbackTag: 'div' | 'span'): Element {
  const doc = ownerDocument()
  const rebuilt = elementFromHtml(html, doc)
  if (rebuilt) return rebuilt
  const carrier = doc.createElement(fallbackTag)
  carrier.setAttribute('data-openleaf-unparsable', html)
  return carrier
}

/**
 * Block-level preserved content. An atom: the editor can select, move and
 * delete it, but never edits its interior, so its markup cannot drift.
 */
export const unknownBlock: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  attrs: {
    html: { default: '' },
    tag: { default: 'div' },
  },
  parseDOM: [
    {
      tag: '*',
      // Lowest priority: every real rule in the schema gets first refusal.
      // This only ever fires for markup nothing else claimed.
      priority: 0,
      getAttrs(dom) {
        const el = dom as Element
        // Returning false declines the rule, so ProseMirror falls through
        // to its default behaviour -- unwrap, keep the children editable.
        if (isLosslesslyUnwrappable(el)) return false
        return { html: el.outerHTML, tag: el.nodeName.toLowerCase() }
      },
    },
  ],
  toDOM(node) {
    return rebuildOrCarry(node.attrs['html'] as string, 'div')
  },
}

/**
 * Inline preserved content, for unrecognised markup appearing inside a
 * paragraph -- the `<o:p>` and `<w:sdt>` debris of a Word paste, custom
 * inline web components, legacy `<font>` runs.
 */
export const unknownInline: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    html: { default: '' },
    tag: { default: 'span' },
  },
  parseDOM: [
    {
      tag: '*',
      // Higher than unknownBlock's catch-all: inline gets first refusal so
      // the block rule cannot claim inline debris and split the paragraph
      // that contained it.
      priority: 1,
      context: 'paragraph/|heading/',
      getAttrs(dom) {
        const el = dom as Element
        if (isLosslesslyUnwrappable(el)) return false
        return { html: el.outerHTML, tag: el.nodeName.toLowerCase() }
      },
    },
  ],
  toDOM(node) {
    return rebuildOrCarry(node.attrs['html'] as string, 'span')
  },
}
