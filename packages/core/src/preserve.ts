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
import { isFullyModelledStyle, safeLang } from './css.js'
import { DROP_WITH_CONTENT } from './elements.js'
import {
  URL_ATTRIBUTES,
  isEventHandlerAttribute,
  isNeverCarriedAttribute,
  isSafeUrl,
} from './url.js'

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
 *
 * Spread from `@openleaf-editor/content-policy` rather than written out here.
 * This list and the sanitize policy's `dropWithContent` are the same decision
 * made in two packages, they were maintained by hand, and they drifted: `<svg>`
 * and `<math>` were on the sanitizer's list and missing from this one, so the
 * editor stored exactly the markup the server was configured to delete. Sharing
 * the constant is what makes that drift impossible rather than merely unlikely.
 *
 * Exported so the divergence can be asserted in a test as well as prevented by
 * construction. Not re-exported from the package index: it is an internal
 * invariant, and the shared list itself is public in content-policy.
 */
export const NEVER_PRESERVE: readonly string[] = [...DROP_WITH_CONTENT]

/**
 * Tags that must not survive *inside* a preserved subtree either.
 *
 * `iframe` is here and not in `NEVER_PRESERVE` because the two answer different
 * questions. At the top level an iframe is claimed by the modelled embed node
 * when its `src` is an allowlisted player, and ignored otherwise -- a
 * priority-100 drop rule would outrank the embed node and delete legitimate
 * players. Inside preserved markup there is no such question: the subtree is
 * stored as an opaque string and re-emitted verbatim, so nothing re-checks the
 * frame on the way out.
 *
 * That gap was the bypass. `<iframe src="https://evil.example/">` on its own was
 * dropped; wrapped in a `<div class="c">` it round-tripped byte-identical, with
 * `allow="camera; microphone; geolocation"` intact. One attribute on a wrapper
 * defeated both the host allowlist and the permissions filter.
 */
const NEVER_INSIDE_PRESERVED: ReadonlySet<string> = new Set([...NEVER_PRESERVE, 'iframe'])

/** Parse rules that drop dangerous elements before any other rule sees them. */
const dropRules = NEVER_PRESERVE.map((tag) => ({ tag, ignore: true, priority: 100 }))

/**
 * `<source>` and `<track>`: media children the schema stores as markup rather
 * than as nodes, so they do not count as content when deciding what to keep.
 *
 * Lives here because this module owns the "keep it whole or claim it" decision,
 * and `structure.ts` asks the same question when it reads a media element.
 */
export const MEDIA_FURNITURE_TAGS: ReadonlySet<string> = new Set(['source', 'track'])

/**
 * True when a media element holds content its node cannot carry.
 *
 * Video and audio are atoms whose only modelled children are `<source>` and
 * `<track>`, so fallback content -- "Download <a href=...>the video</a>", shown
 * by a browser that cannot play the file -- has nowhere to live on the node.
 */
export function hasMediaFallback(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      if (!MEDIA_FURNITURE_TAGS.has(child.nodeName.toLowerCase())) return true
      continue
    }
    // Whitespace between the <source> children is layout, not fallback: the
    // element still models cleanly and still round-trips.
    if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') return true
  }
  return false
}

/**
 * Media whose fallback content the node cannot hold, kept whole.
 *
 * Priority 45 sits below the schema's own rules (50) and above the drop rule
 * (40): a video with a safe `src` is still claimed as a node first, and an
 * unsafe iframe is still dropped rather than preserved, but a `<video>` carrying
 * a download link is preserved instead of being deleted along with it.
 */
const preserveMediaWithFallback = ['video', 'audio'].map((tag) => ({
  tag,
  priority: 45,
  getAttrs(dom: HTMLElement) {
    if (!hasMediaFallback(dom)) return false
    return { html: scrub(dom), tag: dom.nodeName.toLowerCase() }
  },
}))

/**
 * Media the schema declined. Priority 40 is below the schema's default (50),
 * so an allowlisted iframe or a video with a safe `src` is claimed first;
 * anything left is ignored rather than preserved as an atom. Preserving an
 * arbitrary iframe would be a nested page the author never asked to keep.
 */
const dropDeclinedMedia = ['iframe', 'video', 'audio'].map((tag) => ({
  tag,
  ignore: true as const,
  priority: 40,
}))

/**
 * Scrub markup before it is stored for preservation.
 *
 * Preserving an element verbatim means preserving its attributes verbatim, and
 * `<div class="callout" onclick="steal()">` is not something an author needs
 * kept. Works on a clone so the live parse tree is untouched.
 *
 * Exported because the table schema stores `<caption>` and `<colgroup>` the same
 * way, for the same reason, and a second scrubber that drifted from this one
 * would be a hole in exactly the code path that exists to close holes.
 */
export function scrub(el: Element): string {
  const clone = el.cloneNode(true) as Element

  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (NEVER_INSIDE_PRESERVED.has(child.nodeName.toLowerCase())) {
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
      // Before the URL question, not as a case of it: `srcdoc` is a document
      // rather than a URL, and asking a scheme checker about a document gets
      // "no scheme, therefore relative, therefore safe".
      if (isNeverCarriedAttribute(attr.name)) {
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
  const name = el.nodeName.toLowerCase()
  if (!TRANSPARENT_CONTAINERS.has(name)) return false
  if (el.attributes.length === 0) return true
  if (name !== 'span') return false

  /*
   * A `<span>` whose attributes are fully modelled as marks: colour, font, and
   * `lang`. Without this, those runs become opaque atoms -- a grey card where a
   * sentence used to be. Declining the catch-all lets the span unwrap so the
   * mark rules can re-apply formatting on the text inside.
   *
   * Any other attribute, or a style the marks cannot fully express, and the
   * element stays preserved exactly as it does today.
   *
   * ProseMirror matches mark style rules through the CSSOM. Under a CSP with
   * no `unsafe-inline` in `style-src`, the browser leaves the attribute in the
   * DOM and refuses to parse it, so unwrapping would destroy the formatting.
   * An empty CSSOM is therefore a reason to leave the element to the
   * preservation layer.
   */
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'lang') {
      if (safeLang(attr.value) === null) return false
      continue
    }
    if (attr.name === 'style') {
      if ((el as HTMLElement).style?.length === 0) return false
      if (!isFullyModelledStyle(attr.value)) return false
      continue
    }
    return false
  }
  return true
}

/**
 * Parsed preserved markup, per Document, keyed on the exact stored string.
 *
 * `toDOM` runs on every render of every preserved atom, and an HTML parse is the
 * most expensive thing in it: a document that is half preserved markup spent
 * roughly 4x as long serializing as the same document in plain paragraphs.
 *
 * Caching one is only sound because the key is the whole input. `html` is a node
 * attribute, ProseMirror nodes are immutable, and the string was produced by
 * `scrub` before it was ever stored -- so two calls with the same string must
 * produce the same element, and there is no edit that can invalidate an entry
 * without changing the key.
 *
 * Three properties this must keep, none of them optional:
 *
 *   A CLONE every time. Handing out the cached node would let one caller's
 *   mutation -- ProseMirror appending it, a decoration setting an attribute --
 *   poison every later render of that markup.
 *
 *   PER DOCUMENT. Serialization can target a Document that is not the global
 *   one, and a node has to be owned by the document it is going into. Scoping by
 *   Document also means the entries die with it, so a throwaway serialization
 *   document is still collectable.
 *
 *   BOUNDED. The keys are document content, so an unbounded map is a leak that
 *   grows with what the user pastes. A cap with clear-on-overflow keeps it flat;
 *   very large strings are not cached at all, because they are both the least
 *   likely to repeat and the most expensive to hold.
 */
const PARSE_CACHE_ENTRIES = 256
const PARSE_CACHE_MAX_LENGTH = 4096
const parseCaches = new WeakMap<Document, Map<string, Element>>()

/** Rebuild a DOM element from stored markup. `<template>` is used because
 *  its parsing context permits otherwise-illegal fragments such as a bare
 *  `<tr>`, which a `<div>` container would silently discard. */
function elementFromHtml(html: string, doc: Document): Element | null {
  let cache = parseCaches.get(doc)
  const hit = cache?.get(html)
  if (hit) return hit.cloneNode(true) as Element

  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  const parsed = tpl.content.firstElementChild
  if (!parsed) return null
  if (html.length > PARSE_CACHE_MAX_LENGTH) return parsed

  if (!cache) {
    cache = new Map()
    parseCaches.set(doc, cache)
  }
  if (cache.size >= PARSE_CACHE_ENTRIES) cache.clear()
  // The master copy is the clone, so the element handed back is the freshly
  // parsed one and the cache holds something no caller has ever touched.
  cache.set(html, parsed.cloneNode(true) as Element)
  return parsed
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

/**
 * True while `serializeHtml` is running.
 *
 * A node whose `toDOM` needs to render differently for the editor than for the
 * saved HTML has no other way to tell which one it is building. The table spec
 * needs exactly that: a preserved `<caption>` must be `contenteditable="false"`
 * on screen, because it sits inside the editable area but outside the node's
 * `contentDOM`, and letting a caret into it means typing that ProseMirror will
 * silently revert. That attribute must NOT reach the saved HTML, where it would
 * be our editor scribbling on the author's markup.
 *
 * Stripping it afterwards was the other option and is worse: it cannot tell the
 * attribute it just added from the same attribute in somebody's document -- the
 * collision the preserved-element WeakSet above exists to avoid. Not emitting it
 * at all has no such failure mode.
 */
export function isSerializing(): boolean {
  return serializationDocument !== undefined
}

/**
 * The Document that serialization should build into.
 *
 * Exported because schema.ts needs it for the same reason this file does: a node
 * that builds a real element in `toDOM` has nowhere else to get a Document, since
 * ProseMirror does not pass the one given to `serializeFragment` down to `toDOM`.
 */
export function serializationTarget(): Document {
  return ownerDocument()
}

function ownerDocument(): Document {
  if (serializationDocument) return serializationDocument
  if (typeof document === 'undefined') {
    throw new Error(
      '@openleaf-editor/core: no global `document` available. Preserved content ' +
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
    ...preserveMediaWithFallback,
    ...dropDeclinedMedia,
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
 * Where the inline catch-all is allowed to fire.
 *
 * ProseMirror matches `context` against the parent node the content is being
 * parsed INTO, and the naive list -- paragraph and heading -- described the
 * wrong thing. It named the nodes that hold inline content, when what the rule
 * needs to name is every node that can END UP holding it.
 *
 * `list_item` is `paragraph block*`, so its implicit paragraph does not exist
 * until some inline content arrives to force it. An unknown element that is the
 * FIRST child of an `<li>` therefore sees a context of `.../list_item/`, the
 * inline rule declines, and `unknownBlock` claims a block-level atom inside a
 * container whose content expression cannot hold one. ProseMirror's recovery is
 * to close the list and emit the atom as a sibling, so
 * `<ol><li><ins>a</ins></li><li>b</li></ol>` came back as an emptied `<ol>`, an
 * escaped `<ins>`, and a `<ul>` -- the list's contents gone and its very type
 * changed. The identical element with a single character of text before it
 * round-tripped perfectly, which is what kept this invisible: position was the
 * whole trigger.
 *
 * `summary` and `figcaption` fail the same way for the same reason, and
 * `blockquote`, `table_cell` and `table_header` are listed so that a first-child
 * unknown *inline* element is wrapped in a paragraph exactly as it is when text
 * precedes it. Those three can also hold a block atom legally. Wrapping a
 * p-closing element (`div`, `section`, …) in that paragraph is the other
 * failure: the HTML parser closes the `<p>` on the next parse, leaves empty
 * paragraphs on both sides, and the document grows by two blanks on every save.
 * `unknownInline` declines those tags so `unknownBlock` claims them instead.
 *
 * Naming containers explicitly rather than dropping the context altogether:
 * without it the inline rule would outrank `unknownBlock` everywhere, and a
 * genuinely block-level unknown element at the top of the document would become
 * an inline atom inside a paragraph the author never had.
 */
const INLINE_CONTEXT = [
  'paragraph/',
  'heading/',
  'summary/',
  'figcaption/',
  'list_item/',
  'table_cell/',
  'table_header/',
  'blockquote/',
].join('|')

/**
 * Start tags that close an open `<p>` in the HTML "in body" insertion mode.
 *
 * Serializing one of these as an inline atom wraps it in `<p>…</p>`. The next
 * parse cannot keep it there, so it splits into an empty paragraph, the
 * element, and another empty paragraph -- and the following save wraps it
 * again. The same unbounded growth `<plaintext>` caused by having no end tag.
 *
 * Shared with anything else that must not claim a p-closing element as inline
 * (`figcaption` being inline is the other door into this). Custom elements are
 * not on the list: they do not close a `<p>`, so `<drupal-media>` inside a
 * blockquote is correctly an inline atom.
 *
 * Source: WHATWG HTML parsing, "in body" -- every start tag that runs
 * "if the stack of open elements has a p element in button scope, then close
 * a p element" before inserting.
 */
export const CLOSES_OPEN_P: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'dd',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'search',
  'section',
  'summary',
  'ul',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'listing',
  'plaintext',
  'pre',
  'form',
  'li',
  'button',
  'table',
  'hr',
  'xmp',
  'applet',
  'marquee',
  'object',
])

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
    ...preserveMediaWithFallback,
    ...dropDeclinedMedia,
    {
      tag: '*',
      // Higher than unknownBlock's catch-all: inline gets first refusal so
      // the block rule cannot claim inline debris and split the paragraph
      // that contained it.
      priority: 1,
      context: INLINE_CONTEXT,
      getAttrs(dom) {
        const el = dom as Element
        if (isLosslesslyUnwrappable(el)) return false
        // A block-level element inside a paragraph-holding container must not
        // become an inline atom: emitting it inside `<p>` is markup the HTML
        // parser will not re-parse as itself. Declining lets unknownBlock
        // claim it, which blockquote (`block+`) and list_item (`paragraph
        // block*`) can hold. `<ins>` and custom elements stay on this path.
        if (CLOSES_OPEN_P.has(el.nodeName.toLowerCase())) return false
        return { html: scrub(el), tag: el.nodeName.toLowerCase() }
      },
    },
  ],
  toDOM(node) {
    return rebuildOrCarry(node.attrs['html'] as string, 'span')
  },
}
