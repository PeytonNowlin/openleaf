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
import { URL_ATTRIBUTES, isEventHandlerAttribute, isSafeUrl } from './url.js'

/**
 * Elements that are never preserved, and whose contents are discarded with them.
 *
 * This is where the project's two strongest instincts collide. The preservation
 * layer exists because silently deleting a customer's markup is the failure
 * OpenLeaf was built to prevent -- but "markup the schema does not recognise"
 * includes `<script>`.
 *
 * Preserving an author's `<div class="callout">` is the product working.
 * Preserving a `<script>` is a vulnerability with extra steps: the editor would
 * hand it back on save, the server would store it, and the next reader would
 * execute it. The content-safety promise is about *authorial content*, and a
 * script tag is not that.
 *
 * `ignore` rather than `skip`: the element AND its contents go. Skipping would
 * unwrap `<script>alert(1)</script>` into the literal text "alert(1)" appearing
 * in the document, which is a different kind of wrong.
 */
const NEVER_PRESERVE: readonly string[] = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
]

/** Parse rules that drop dangerous elements before any other rule sees them. */
const dropRules = NEVER_PRESERVE.map((tag) => ({ tag, ignore: true, priority: 100 }))

/**
 * Scrub markup before it is stored for preservation.
 *
 * Preserving an element verbatim means preserving its attributes verbatim, and
 * `<div class="callout" onclick="steal()">` is not something an author needs
 * kept. Works on a clone so the live parse tree is untouched.
 */
function scrub(el: Element): string {
  const clone = el.cloneNode(true) as Element

  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (NEVER_PRESERVE.includes(child.nodeName.toLowerCase())) {
        child.remove()
        continue
      }
      visit(child)
    }
    for (const attr of Array.from(node.attributes)) {
      if (isEventHandlerAttribute(attr.name)) {
        node.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRIBUTES.has(attr.name.toLowerCase()) && !isSafeUrl(attr.value)) {
        node.removeAttribute(attr.name)
      }
    }
  }

  visit(clone)
  return clone.outerHTML
}

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

/**
 * ProseMirror's `toDOM` does not receive the `document` passed to
 * `serializeFragment`. Preserved nodes rebuild markup inside `toDOM`, so the
 * explicit Document has to travel out of band for the duration of one
 * serialize. Nested calls restore the previous value so a re-entrant serialize
 * cannot leak a document across documents.
 */
let serializationDocument: Document | undefined

/** Run `fn` with preserved-node serialization targeting this Document. */
export function withSerializationDocument<T>(doc: Document, fn: () => T): T {
  const previous = serializationDocument
  serializationDocument = doc
  try {
    return fn()
  } finally {
    serializationDocument = previous
  }
}

function ownerDocument(): Document {
  if (serializationDocument) return serializationDocument
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
/**
 * Elements rendered from preserved markup, identified out of band.
 *
 * Normalization passes running over the serialized output need to tell "markup
 * we own" from "markup we promised not to touch". The first attempt marked
 * preserved output with a real DOM attribute and stripped it afterwards -- which
 * could not distinguish the attribute it had just added from the same attribute
 * occurring in somebody's document, so a customer using `data-ol-preserved` had
 * it silently deleted. Destroying an attribute inside preserved content is the
 * exact failure the marker existed to prevent.
 *
 * A WeakSet cannot collide with content, needs no cleanup pass, and holds its
 * entries weakly so a serialization's throwaway DOM is still collectable.
 */
const preservedElements = new WeakSet<Element>()

/** True when this element, or an ancestor, was rendered from preserved markup. */
export function isInsidePreserved(node: Element | null): boolean {
  for (let current = node; current; current = current.parentElement) {
    if (preservedElements.has(current)) return true
  }
  return false
}

function rebuildOrCarry(html: string, fallbackTag: 'div' | 'span'): Element {
  const doc = ownerDocument()
  const rebuilt = elementFromHtml(html, doc)
  if (rebuilt) {
    preservedElements.add(rebuilt)
    return rebuilt
  }
  const carrier = doc.createElement(fallbackTag)
  carrier.setAttribute('data-openleaf-unparsable', html)
  preservedElements.add(carrier)
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
    ...dropRules,
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
        return { html: scrub(el), tag: el.nodeName.toLowerCase() }
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
    ...dropRules,
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
        return { html: scrub(el), tag: el.nodeName.toLowerCase() }
      },
    },
  ],
  toDOM(node) {
    return rebuildOrCarry(node.attrs['html'] as string, 'span')
  },
}
