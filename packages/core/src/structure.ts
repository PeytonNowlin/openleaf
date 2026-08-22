/**
 * Structural nodes that belong in the base schema for the same reason tables
 * do: without them, stored `<details>`, `<figure>` and a page break become
 * opaque preserved atoms -- faithful, and uneditable.
 *
 * The editing chrome (dialogs, character map, resize handles) lives in
 * `@openleaf-editor/plugins-insert`. What is here is the storage format.
 */

import type { Attrs, DOMOutputSpec, NodeSpec } from 'prosemirror-model'
import { safeAllowList, safeEmbedSrc } from './embed.js'
import { IMAGE_ALIGN_CLASS, IMAGE_ALIGN_CLASSES, imageAlignFromClass, safeClassList, safeId, type ImageAlign } from './tokens.js'
import {
  MEDIA_FURNITURE_TAGS,
  hasMediaFallback,
  scrub,
  serializationTarget,
} from './preserve.js'
import { isSafeUrl } from './url.js'

function boolAttr(el: Element, name: string): boolean {
  return el.hasAttribute(name)
}

function dimension(el: Element, name: string): string | null {
  const value = el.getAttribute(name)
  if (!value) return null
  return /^\d+(?:\.\d+)?%?$/.test(value) ? value : null
}

/**
 * The `<source>`/`<track>` children of a media element, as scrubbed markup.
 *
 * Furniture rather than nodes for the same reason a table's `<colgroup>` is:
 * authors never type into them, and a content expression for something nobody
 * edits buys nothing. Storing them at all is what keeps
 * `<video><source src="clip.webm"></video>` -- which has no `src` of its own --
 * a real editable node. Without it the schema declined the element and the
 * preservation layer's drop rule then deleted the whole thing.
 */
function readMediaFurniture(el: Element): string | null {
  let html = ''
  for (const child of Array.from(el.children)) {
    if (!MEDIA_FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    // Dropped whole rather than scrubbed down to `<source>`: `scrub` would strip
    // the unsafe address and leave an element that plays nothing and says
    // nothing. A media element left with no usable source is then declined.
    if (!isSafeUrl(child.getAttribute('src'))) continue
    html += scrub(child)
  }
  return html || null
}

/**
 * Rebuild stored furniture and append it to the element being serialized.
 *
 * `<template>` is the parsing context because a bare `<source>` is illegal
 * inside a `<div>` and would be silently discarded there -- the same reason the
 * preservation layer uses one.
 */
function appendMediaFurniture(host: Element, html: string, doc: Document): void {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  for (const child of Array.from((tpl as HTMLTemplateElement).content.children)) {
    if (!MEDIA_FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    // Scrubbed on the way out too. Furniture read from a parse has already been
    // through `readMediaFurniture`, but a string written by a command or a
    // dialog has not, and `<source src="x" onerror="...">` must not be stored.
    const clean = doc.createElement('template')
    clean.innerHTML = scrub(child)
    const el = (clean as HTMLTemplateElement).content.firstElementChild
    if (el) host.appendChild(el)
  }
}

function mediaAttrs(el: Element): Record<string, unknown> | false {
  // Fallback content has nowhere to live on an atom. Declining hands the element
  // to the preservation layer, which keeps it whole -- see the priority-45 rule
  // in preserve.ts.
  if (hasMediaFallback(el)) return false
  const src = el.getAttribute('src')
  if (src !== null && !isSafeUrl(src)) return false
  const furniture = readMediaFurniture(el)
  // One or the other. A player with neither has nothing to play.
  if (src === null && furniture === null) return false
  return {
    src,
    furniture,
    title: el.getAttribute('title'),
    controls: boolAttr(el, 'controls'),
    width: dimension(el, 'width'),
    height: dimension(el, 'height'),
  }
}

/**
 * Serialize a media element, splicing its furniture back in as children.
 *
 * A real element rather than a spec array whenever there is furniture: an array
 * cannot carry raw markup, and the `<source>` children have to be appended.
 */
function mediaToDOM(tag: 'video' | 'audio', attrs: Record<string, string>, furniture: string | null): DOMOutputSpec {
  if (!furniture) return [tag, attrs]
  const doc = serializationTarget()
  const el = doc.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  appendMediaFurniture(el, furniture, doc)
  return el
}

/**
 * `<video>` and `<audio>`. `controls` defaults to on: an inserted player
 * without controls is a rectangle that cannot be played from the keyboard,
 * and authors rarely go back to add them.
 */
export const video: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    // Optional: source-only media carries its addresses in `furniture` instead.
    src: { default: null },
    furniture: { default: null },
    title: { default: null },
    controls: { default: false },
    width: { default: null },
    height: { default: null },
    poster: { default: null },
  },
  parseDOM: [
    {
      tag: 'video',
      getAttrs(dom) {
        const el = dom as Element
        const base = mediaAttrs(el)
        if (!base) return false
        const poster = el.getAttribute('poster')
        return {
          ...base,
          poster: poster && isSafeUrl(poster) ? poster : null,
        }
      },
    },
  ],
  toDOM(node) {
    const { src, title, controls, width, height, poster, furniture } = node.attrs
    const attrs: Record<string, string> = {}
    if (src !== null) attrs['src'] = src as string
    if (title !== null) attrs['title'] = title as string
    if (controls) attrs['controls'] = ''
    if (width !== null) attrs['width'] = width as string
    if (height !== null) attrs['height'] = height as string
    if (poster !== null) attrs['poster'] = poster as string
    return mediaToDOM('video', attrs, furniture as string | null)
  },
}

export const audio: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    src: { default: null },
    furniture: { default: null },
    title: { default: null },
    controls: { default: false },
  },
  parseDOM: [
    {
      tag: 'audio',
      getAttrs(dom) {
        const base = mediaAttrs(dom as Element)
        if (!base) return false
        // Audio has no intrinsic box, so the dimensions mediaAttrs read are not
        // part of this node's shape.
        const { width: _width, height: _height, ...rest } = base
        return rest
      },
    },
  ],
  toDOM(node) {
    const { src, title, controls, furniture } = node.attrs
    const attrs: Record<string, string> = {}
    if (src !== null) attrs['src'] = src as string
    if (title !== null) attrs['title'] = title as string
    if (controls) attrs['controls'] = ''
    return mediaToDOM('audio', attrs, furniture as string | null)
  },
}

/**
 * An allowlisted embed. Unsafe iframes are ignored by a sibling parse rule in
 * preserve.ts rather than preserved: an iframe is a nested page, not an
 * author's callout div.
 */
export const iframe: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    src: {},
    title: { default: null },
    width: { default: null },
    height: { default: null },
    allow: { default: null },
    allowfullscreen: { default: true },
  },
  parseDOM: [
    {
      tag: 'iframe',
      getAttrs(dom) {
        const el = dom as Element
        const src = safeEmbedSrc(el.getAttribute('src'))
        if (!src) return false
        return {
          src,
          title: el.getAttribute('title'),
          width: dimension(el, 'width'),
          height: dimension(el, 'height'),
          allow: safeAllowList(el.getAttribute('allow')),
          allowfullscreen: el.hasAttribute('allowfullscreen'),
        }
      },
    },
  ],
  toDOM(node) {
    const { src, title, width, height, allow, allowfullscreen } = node.attrs
    const attrs: Record<string, string> = { src: src as string }
    if (title !== null) attrs['title'] = title as string
    if (width !== null) attrs['width'] = width as string
    if (height !== null) attrs['height'] = height as string
    if (allow !== null) attrs['allow'] = allow as string
    if (allowfullscreen) attrs['allowfullscreen'] = ''
    return ['iframe', attrs]
  },
}

export const details: NodeSpec = {
  group: 'block',
  content: 'summary block+',
  defining: true,
  isolating: true,
  attrs: { open: { default: false } },
  parseDOM: [
    {
      tag: 'details',
      getAttrs: (dom) => ({ open: (dom as Element).hasAttribute('open') }),
    },
  ],
  toDOM(node) {
    return node.attrs['open'] ? ['details', { open: '' }, 0] : ['details', 0]
  },
}

export const summary: NodeSpec = {
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'summary' }],
  toDOM: () => ['summary', 0],
}

/**
 * A captioned image. Figures that contain anything other than an image and an
 * optional caption are left to the preservation layer: claiming them here
 * would flatten a complex figure into a shape it cannot round-trip.
 */
export const figure: NodeSpec = {
  group: 'block',
  content: 'inline+',
  isolating: true,
  parseDOM: [
    {
      tag: 'figure',
      getAttrs(dom) {
        const el = dom as Element
        const children = Array.from(el.children).filter((child) => child.nodeName !== 'FIGCAPTION')
        if (children.length !== 1 || children[0]?.nodeName !== 'IMG') return false
        return {}
      },
    },
  ],
  toDOM: () => ['figure', 0],
}

/**
 * Caption for a modelled figure, and only for a modelled figure.
 *
 * The node is inline because `figure` is `inline+` (an image plus this). The
 * HTML parser does not agree: `figcaption` is in the "in body" start-tag list
 * that closes an open `<p>`, so a caption parsed as ordinary inline content
 * is wrapped in a paragraph on the way out, then split on the way back in,
 * and each save adds an empty paragraph before the caption and one after.
 * Restricting the parse rule to `figure/` is what stops that: an orphaned
 * caption is declined here and claimed by the preservation layer as a block
 * atom, which is markup the next parse can consume without wrapping it in a
 * `<p>`. A nested figure stays editable.
 */
export const figcaption: NodeSpec = {
  inline: true,
  group: 'inline',
  content: 'inline*',
  parseDOM: [{ tag: 'figcaption', context: 'figure/' }],
  toDOM: () => ['figcaption', 0],
}

export const page_break: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  parseDOM: [
    { tag: 'div[data-pagebreak]' },
    { tag: 'div.ol-pagebreak' },
    { tag: 'hr.ol-pagebreak' },
  ],
  toDOM: () => ['hr', { class: 'ol-pagebreak' }],
}

/**
 * Whitespace-only interiors count as empty: pretty-printed `<a id="jump">\n</a>`
 * has no modelled text (`parseHtml` does not preserve whitespace), and treating
 * it as a link mark would drop the destination entirely.
 */
export function isEmptyNamedAnchorElement(el: Element): boolean {
  return (el.textContent ?? '').trim() === '' && !el.firstElementChild
}

/**
 * An empty named destination: `<a id="section"></a>`.
 *
 * A link with both `href` and `id` is a mark, not this node. This exists for
 * the jump target that has no text of its own, which is what TinyMCE's
 * anchor plugin inserts and what a decade of CMS content already contains.
 *
 * An atom cannot hold content. `<a id="sec">Section</a>` wrapping visible text
 * is the pre-HTML5 in-page-anchor idiom; claiming it here discarded the text
 * on parse. Those elements decline so the `link` mark (which already carries
 * `id`, and `href` only when present) can keep the text editable.
 */
export const named_anchor: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  attrs: { id: {} },
  parseDOM: [
    {
      tag: 'a[id]',
      getAttrs(dom) {
        const el = dom as Element
        if (el.hasAttribute('href')) return false
        // An atom cannot hold content. An <a id> WITH text is a jump target
        // wrapped around a heading -- the commonest legacy spelling -- and
        // claiming it here deletes the text.
        if (!isEmptyNamedAnchorElement(el)) return false
        const id = safeId(el.getAttribute('id'))
        if (!id) return false
        return { id }
      },
    },
  ],
  toDOM: (node) => ['a', { id: node.attrs['id'] as string }],
}

/** Image attributes shared by parse and commands. */
export function imageParseAttrs(el: Element): Record<string, unknown> | false {
  if (!isSafeUrl(el.getAttribute('src'))) return false
  const className = el.getAttribute('class')
  return {
    src: el.getAttribute('src'),
    alt: el.getAttribute('alt'),
    title: el.getAttribute('title'),
    width: el.getAttribute('width'),
    height: el.getAttribute('height'),
    align: imageAlignFromClass(className),
    className: safeClassList(className, IMAGE_ALIGN_CLASSES),
  }
}

export function imageDomAttrs(attrs: Attrs): Record<string, string> {
  const out: Record<string, string> = { src: attrs.src as string }
  if (attrs.alt !== null && attrs.alt !== undefined) out['alt'] = attrs.alt as string
  if (attrs.title !== null && attrs.title !== undefined) out['title'] = attrs.title as string
  if (attrs.width !== null && attrs.width !== undefined) out['width'] = attrs.width as string
  if (attrs.height !== null && attrs.height !== undefined) out['height'] = attrs.height as string
  const classes: string[] = []
  const align = attrs.align as ImageAlign | null
  if (align) classes.push(IMAGE_ALIGN_CLASS[align])
  if (typeof attrs.className === 'string' && attrs.className !== '') {
    classes.push(attrs.className)
  }
  if (classes.length > 0) out['class'] = classes.join(' ')
  return out
}
