/**
 * The OpenLeaf document schema.
 *
 * Scope note: this is the v0.1 core. Tables live in @openleaf/plugins-table
 * because their schema and commands are large enough to be their own
 * concern, and because a CMS that does not allow tables should not ship
 * their code.
 */

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model'
import { unknownBlock, unknownInline } from './preserve.js'
import { isSafeUrl } from './url.js'

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    // `dir` is bidirectional text direction, not styling. Dropping it
    // silently breaks Arabic, Hebrew and Persian content, so it is a
    // first-class schema attribute rather than something the preservation
    // layer has to rescue.
    attrs: { dir: { default: null } },
    content: 'inline*',
    group: 'block',
    parseDOM: [
      {
        tag: 'p',
        getAttrs: (dom) => ({ dir: (dom as Element).getAttribute('dir') }),
      },
    ],
    toDOM(node) {
      const dir = node.attrs['dir'] as string | null
      return dir ? ['p', { dir }, 0] : ['p', 0]
    },
  },

  heading: {
    attrs: { level: { default: 1 }, dir: { default: null } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom) => ({ level, dir: (dom as Element).getAttribute('dir') }),
    })),
    toDOM(node) {
      const tag = `h${node.attrs['level']}`
      const dir = node.attrs['dir'] as string | null
      return dir ? [tag, { dir }, 0] : [tag, 0]
    },
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  code_block: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', ['code', 0]],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },

  ordered_list: {
    attrs: { start: { default: 1 } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs(dom) {
          const start = (dom as Element).getAttribute('start')
          return { start: start ? Number(start) : 1 }
        },
      },
    ],
    toDOM(node) {
      const start = node.attrs['start'] as number
      return start === 1 ? ['ol', 0] : ['ol', { start: String(start) }, 0]
    },
  },

  list_item: {
    content: 'paragraph block*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },

  image: {
    inline: true,
    group: 'inline',
    draggable: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs(dom) {
          const el = dom as Element
          // Returning false declines the rule, so an image with a
          // `javascript:` src is dropped rather than carried through.
          if (!isSafeUrl(el.getAttribute('src'))) return false
          return {
            src: el.getAttribute('src'),
            // An absent alt and alt="" mean different things to a screen
            // reader: "undescribed" versus "decorative". Never conflate them.
            alt: el.getAttribute('alt'),
            title: el.getAttribute('title'),
            width: el.getAttribute('width'),
            height: el.getAttribute('height'),
          }
        },
      },
    ],
    toDOM(node) {
      const { src, alt, title, width, height } = node.attrs
      const attrs: Record<string, string> = { src: src as string }
      if (alt !== null) attrs['alt'] = alt as string
      if (title !== null) attrs['title'] = title as string
      if (width !== null) attrs['width'] = width as string
      if (height !== null) attrs['height'] = height as string
      return ['img', attrs]
    },
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  text: { group: 'inline' },

  unknown_block: unknownBlock,
  unknown_inline: unknownInline,
}

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b' },
      { style: 'font-weight=bold' },
      { style: 'font-weight=700' },
    ],
    toDOM: () => ['strong', 0],
  },

  em: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },

  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },

  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },

  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },

  link: {
    attrs: {
      href: {},
      title: { default: null },
      target: { default: null },
      rel: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs(dom) {
          const el = dom as Element
          // A `javascript:` href is the cheapest XSS vector there is: no
          // injected element, no script tag, just a reader who clicks.
          // Declining the rule keeps the link TEXT and drops the mark.
          if (!isSafeUrl(el.getAttribute('href'))) return false
          return {
            href: el.getAttribute('href'),
            title: el.getAttribute('title'),
            target: el.getAttribute('target'),
            rel: el.getAttribute('rel'),
          }
        },
      },
    ],
    toDOM(node) {
      const { href, title, target, rel } = node.attrs
      const attrs: Record<string, string> = { href: href as string }
      if (title !== null) attrs['title'] = title as string
      if (target !== null) attrs['target'] = target as string
      if (rel !== null) attrs['rel'] = rel as string
      return ['a', attrs, 0]
    },
  },
}

export const schema = new Schema({ nodes, marks })
