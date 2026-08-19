/**
 * Figures, captions, video and audio.
 *
 * ## Why these live in core rather than in an opt-in plugin
 *
 * The same reasoning as tables. Without these node types, a `<figure>` wrapping
 * an inherited photograph, or a `<video>` with a poster frame and two `<source>`
 * children, is claimed by the preservation layer and becomes a single opaque
 * atom. It round-trips. It cannot be resized, recaptioned, or described.
 * "We kept your media but you may not touch it" is not a thing you can tell a
 * CMS that already has ten years of captioned images in the database.
 *
 * So the schema is always present. What is opt-in is the weight: drag-resize,
 * the properties dialog, the insert-media control. That lives in
 * `@openleaf-editor/plugins-media`.
 *
 * ## What is modelled, and what is furniture
 *
 * A figure's media and its `<figcaption>` are child nodes, because unlike a
 * table caption they do not collide with a third-party cell map. `<source>` and
 * `<track>` are furniture stored as scrubbed markup on the media node: they are
 * not independently editable, and making them nodes would add a content
 * expression for something authors never type into.
 *
 * Figures that are not "one media element plus an optional caption" -- a
 * figure wrapping a table, a figure with two images -- are declined, so the
 * preservation layer keeps them whole rather than flattening them into a
 * shape they did not have.
 */

import type { DOMOutputSpec, Node as PMNode, NodeSpec } from 'prosemirror-model'
import { scrub, serializationTarget } from './preserve.js'
import { URL_ATTRIBUTES, isEventHandlerAttribute, isSafeUrl } from './url.js'

const IMAGE_ATTRS = ['src', 'alt', 'title', 'width', 'height', 'class', 'srcset', 'sizes'] as const
const MEDIA_ATTRS = [
  'src',
  'poster',
  'width',
  'height',
  'class',
  'controls',
  'autoplay',
  'loop',
  'muted',
  'playsinline',
  'preload',
] as const
const FIGURE_ATTRS = ['class', 'role'] as const
const FURNITURE_TAGS = new Set(['source', 'track'])
const BOOLEAN_ATTRS = new Set(['controls', 'autoplay', 'loop', 'muted', 'playsinline'])

function readAttrs(el: Element, names: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const name of names) {
    if (!el.hasAttribute(name)) {
      out[name] = null
      continue
    }
    const value = el.getAttribute(name)
    if (BOOLEAN_ATTRS.has(name)) {
      // Presence is the value. Do not rewrite empty `alt=""` as the token
      // "alt" -- that only applies to boolean attributes.
      out[name] = value === '' || value === name ? name : value
      continue
    }
    out[name] = value
  }
  return out
}

function writeAttrs(
  attrs: Record<string, unknown>,
  names: readonly string[],
  emptyOk: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = attrs[name]
    if (value === null || value === undefined) continue
    if (BOOLEAN_ATTRS.has(name)) {
      if (value === false || value === 'false') continue
      // Empty string matches `<video controls>` / `controls=""` in the
      // fidelity corpus. A named token (`controls="controls"`) would count
      // as a different attribute value.
      out[name] = ''
      continue
    }
    if (value === '' && !emptyOk.includes(name)) continue
    out[name] = String(value)
  }
  return out
}

function leftoverAttrs(el: Element, modelled: readonly string[]): string | null {
  const skip = new Set<string>(modelled)
  const extra: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name
    if (skip.has(name)) continue
    if (isEventHandlerAttribute(name)) continue
    if (URL_ATTRIBUTES.has(name.toLowerCase()) && !isSafeUrl(attr.value)) continue
    extra[name] = attr.value
  }
  const keys = Object.keys(extra)
  return keys.length > 0 ? JSON.stringify(extra) : null
}

function applyLeftover(el: Element, raw: unknown): void {
  if (typeof raw !== 'string' || raw === '') return
  try {
    const extra = JSON.parse(raw) as unknown
    if (!extra || typeof extra !== 'object') return
    for (const [name, value] of Object.entries(extra as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      if (isEventHandlerAttribute(name)) continue
      if (URL_ATTRIBUTES.has(name.toLowerCase()) && !isSafeUrl(value)) continue
      el.setAttribute(name, value)
    }
  } catch {
    /* stored leftover that will not parse is dropped rather than thrown */
  }
}

function readFurniture(el: Element): string | null {
  let html = ''
  for (const child of Array.from(el.children)) {
    if (!FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    html += scrub(child)
  }
  return html || null
}

function appendFurniture(host: Element, html: string, doc: Document): void {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  for (const child of Array.from(tpl.content.children)) {
    if (!FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    // Scrubbed here, not only on the way out of a parse. Furniture read from
    // stored HTML has already been through `readFurniture`, but a string typed
    // into the insert dialog has not: without this, `<source src="clip.webm"
    // onerror="...">` would be written into stored HTML exactly as typed, and so
    // would an unsafe `src`. Scrubbing an already-scrubbed element is a no-op.
    const clean = doc.createElement('template')
    clean.innerHTML = scrub(child)
    const el = clean.content.firstElementChild
    if (el) host.appendChild(el)
  }
}

/**
 * True when the element holds content this schema cannot carry.
 *
 * `<source>` and `<track>` are furniture, and video and audio are atoms, so
 * fallback content -- "Download <a href='...'>the video</a>", shown by browsers
 * that cannot play the file -- has nowhere to live on the node and would be
 * destroyed on the next save. Declining hands the element to the preservation
 * layer, which keeps it whole and untouched instead.
 */
function hasUnmodelledContent(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      if (!FURNITURE_TAGS.has(child.nodeName.toLowerCase())) return true
      continue
    }
    // Pretty-printed markup leaves whitespace between the <source> children.
    // That is layout, not fallback, and modelling the element still round-trips.
    if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') return true
  }
  return false
}

function mediaGetAttrs(el: Element, modelled: readonly string[]): false | Record<string, unknown> {
  const src = el.getAttribute('src')
  const poster = el.getAttribute('poster')
  const furniture = readFurniture(el)
  if (src && !isSafeUrl(src)) return false
  if (poster && !isSafeUrl(poster)) return false
  if (!src && !furniture) return false
  if (hasUnmodelledContent(el)) return false
  return {
    ...readAttrs(el, modelled),
    extra: leftoverAttrs(el, modelled),
    furniture,
  }
}

function mediaToDOM(tag: 'video' | 'audio', node: PMNode): DOMOutputSpec {
  // Always a real element: empty boolean attributes (`controls=""`) are
  // dropped from a spec-array `toDOM`, and furniture has to be spliced in.
  const attrs = writeAttrs(node.attrs, MEDIA_ATTRS)
  const doc = serializationTarget()
  const el = doc.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  applyLeftover(el, node.attrs['extra'])
  const furniture = node.attrs['furniture'] as string | null
  if (furniture) appendFurniture(el, furniture, doc)
  return el
}

/**
 * True when this figure is one media element and an optional caption.
 *
 * Anything else -- a figure wrapping a table, two images, a block of prose --
 * is somebody else's document structure and belongs to the preservation layer.
 */
export function isMediaFigure(el: Element): boolean {
  const kids = Array.from(el.children).filter((c) => c.nodeName !== 'FIGCAPTION')
  if (kids.length !== 1) return false
  return kids[0] !== undefined && ['IMG', 'VIDEO', 'AUDIO'].includes(kids[0].nodeName)
}

/** Move a leading figcaption to the end so the content expression can parse it. */
export function normalizeMediaFigures(root: ParentNode): void {
  for (const figure of Array.from(root.querySelectorAll('figure'))) {
    if (!isMediaFigure(figure)) continue
    // Pretty-printed HTML leaves whitespace text nodes between the media
    // and the caption. Figure is a textblock (inline content), so those
    // nodes become a leading space inside the caption on the first save
    // and vanish on the second -- a stability failure.
    for (const child of Array.from(figure.childNodes)) {
      if (child.nodeType === 3 && !(child.textContent ?? '').trim()) child.remove()
    }
    const caption = figure.querySelector(':scope > figcaption')
    if (caption && caption !== figure.lastElementChild) figure.append(caption)
  }
}

export const imageAttrs = {
  src: {},
  alt: { default: null },
  title: { default: null },
  width: { default: null },
  height: { default: null },
  class: { default: null },
  srcset: { default: null },
  sizes: { default: null },
  extra: { default: null },
}

export function imageGetAttrs(dom: Node): false | Record<string, unknown> {
  const el = dom as Element
  if (!isSafeUrl(el.getAttribute('src'))) return false
  return {
    ...readAttrs(el, IMAGE_ATTRS),
    extra: leftoverAttrs(el, IMAGE_ATTRS),
  }
}

export function imageToDOM(node: PMNode): DOMOutputSpec {
  const attrs = writeAttrs(node.attrs, IMAGE_ATTRS, ['alt'])
  // Spec-array `toDOM` omits empty strings, which would drop `alt=""`.
  if (!node.attrs['extra'] && node.attrs['alt'] !== '') return ['img', attrs]
  const doc = serializationTarget()
  const el = doc.createElement('img')
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  applyLeftover(el, node.attrs['extra'])
  return el
}

export const figure: NodeSpec = {
  group: 'block',
  content: '(image | video | audio) figcaption?',
  defining: true,
  attrs: {
    ...Object.fromEntries(FIGURE_ATTRS.map((name) => [name, { default: null }])),
    extra: { default: null },
  },
  parseDOM: [
    {
      tag: 'figure',
      getAttrs(dom) {
        const el = dom as Element
        if (!isMediaFigure(el)) return false
        return {
          ...readAttrs(el, FIGURE_ATTRS),
          extra: leftoverAttrs(el, FIGURE_ATTRS),
        }
      },
    },
  ],
  toDOM(node) {
    const attrs = writeAttrs(node.attrs, FIGURE_ATTRS)
    if (!node.attrs['extra']) return ['figure', attrs, 0]
    const doc = serializationTarget()
    const el = doc.createElement('figure')
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
    applyLeftover(el, node.attrs['extra'])
    return { dom: el, contentDOM: el }
  },
}

export const figcaption: NodeSpec = {
  inline: true,
  content: 'inline*',
  defining: true,
  attrs: { class: { default: null }, extra: { default: null } },
  parseDOM: [
    {
      tag: 'figcaption',
      preserveWhitespace: 'full',
      getAttrs: (dom) => ({
        class: (dom as Element).getAttribute('class'),
        extra: leftoverAttrs(dom as Element, ['class']),
      }),
    },
  ],
  toDOM(node) {
    const attrs = writeAttrs(node.attrs, ['class'])
    if (!node.attrs['extra']) return ['figcaption', attrs, 0]
    const doc = serializationTarget()
    const el = doc.createElement('figcaption')
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
    applyLeftover(el, node.attrs['extra'])
    return { dom: el, contentDOM: el }
  },
}

export const video: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    ...Object.fromEntries(MEDIA_ATTRS.map((name) => [name, { default: null }])),
    extra: { default: null },
    furniture: { default: null },
  },
  parseDOM: [
    {
      tag: 'video',
      getAttrs: (dom) => mediaGetAttrs(dom as Element, MEDIA_ATTRS),
    },
    { tag: 'source', ignore: true },
    { tag: 'track', ignore: true },
  ],
  toDOM: (node) => mediaToDOM('video', node),
}

export const audio: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    ...Object.fromEntries(MEDIA_ATTRS.map((name) => [name, { default: null }])),
    extra: { default: null },
    furniture: { default: null },
  },
  parseDOM: [
    {
      tag: 'audio',
      getAttrs: (dom) => mediaGetAttrs(dom as Element, MEDIA_ATTRS),
    },
  ],
  toDOM: (node) => mediaToDOM('audio', node),
}

