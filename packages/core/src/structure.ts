/**
 * Structural nodes that belong in the base schema for the same reason tables
 * do: without them, stored `<details>`, `<figure>` and a page break become
 * opaque preserved atoms -- faithful, and uneditable.
 *
 * The editing chrome (dialogs, character map, resize handles) lives in
 * `@openleaf-editor/plugins-insert`. What is here is the storage format.
 */

import type { Attrs, NodeSpec } from 'prosemirror-model'
import { safeAllowList, safeEmbedSrc } from './embed.js'
import { IMAGE_ALIGN_CLASS, IMAGE_ALIGN_CLASSES, imageAlignFromClass, safeClassList, safeId, type ImageAlign } from './tokens.js'
import { isSafeUrl } from './url.js'

function boolAttr(el: Element, name: string): boolean {
  return el.hasAttribute(name)
}

function dimension(el: Element, name: string): string | null {
  const value = el.getAttribute(name)
  if (!value) return null
  return /^\d+(?:\.\d+)?%?$/.test(value) ? value : null
}

function mediaAttrs(el: Element): Record<string, unknown> | false {
  const src = el.getAttribute('src')
  if (!isSafeUrl(src)) return false
  return {
    src,
    title: el.getAttribute('title'),
    controls: boolAttr(el, 'controls'),
    width: dimension(el, 'width'),
    height: dimension(el, 'height'),
  }
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
    src: {},
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
    const { src, title, controls, width, height, poster } = node.attrs
    const attrs: Record<string, string> = { src: src as string }
    if (title !== null) attrs['title'] = title as string
    if (controls) attrs['controls'] = ''
    if (width !== null) attrs['width'] = width as string
    if (height !== null) attrs['height'] = height as string
    if (poster !== null) attrs['poster'] = poster as string
    return ['video', attrs]
  },
}

export const audio: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    src: {},
    title: { default: null },
    controls: { default: false },
  },
  parseDOM: [
    {
      tag: 'audio',
      getAttrs(dom) {
        const el = dom as Element
        const src = el.getAttribute('src')
        if (!isSafeUrl(src)) return false
        return {
          src,
          title: el.getAttribute('title'),
          controls: el.hasAttribute('controls'),
        }
      },
    },
  ],
  toDOM(node) {
    const { src, title, controls } = node.attrs
    const attrs: Record<string, string> = { src: src as string }
    if (title !== null) attrs['title'] = title as string
    if (controls) attrs['controls'] = ''
    return ['audio', attrs]
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

export const figcaption: NodeSpec = {
  inline: true,
  group: 'inline',
  content: 'inline*',
  parseDOM: [{ tag: 'figcaption' }],
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
 * An empty named destination: `<a id="section"></a>`.
 *
 * A link with both `href` and `id` is a mark, not this node. This exists for
 * the jump target that has no text of its own, which is what TinyMCE's
 * anchor plugin inserts and what a decade of CMS content already contains.
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
