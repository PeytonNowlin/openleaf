/**
 * The OpenLeaf document schema.
 *
 * Scope note: table NODES are here, in the base schema, so that every
 * deployment reads and writes tables faithfully. Table EDITING -- cell
 * selection, column resizing, the row and column commands and toolbar -- is
 * the opt-in @openleaf/plugins-table. See tables.ts for why the split falls
 * there rather than at the package boundary.
 */

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model'
import { unknownBlock, unknownInline } from './preserve.js'
import { table, table_cell, table_header, table_row } from './tables.js'
import { isSafeUrl } from './url.js'

/** The base node specs. Extensions are appended to these. */
export const coreNodes: Record<string, NodeSpec> = {
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
    // `language` is content, not decoration. Without it a fenced block loses
    // `class="language-js"` on the first save -- which is both an attribute-loss
    // bug and the reason a highlighter has nothing to work from.
    attrs: { language: { default: null } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs(dom) {
          const pre = dom as Element
          // The class may sit on either element in the wild. CommonMark, Prism
          // and highlight.js all put it on <code>; older CMS output often puts
          // it on <pre>. Read both, write one.
          const code = pre.querySelector('code')
          const source = `${pre.getAttribute('class') ?? ''} ${code?.getAttribute('class') ?? ''}`
          const match = /(?:^|\s)(?:language|lang)-([a-z0-9+#.-]+)/i.exec(source)
          return { language: match ? (match[1] as string).toLowerCase() : null }
        },
      },
    ],
    toDOM(node) {
      const language = node.attrs['language'] as string | null
      // Normalized onto <code>, which is where every downstream highlighter
      // looks. A block authored with the class on <pre> moves it; that is a
      // one-time normalization and it is stable thereafter.
      return language ? ['pre', ['code', { class: `language-${language}` }, 0]] : ['pre', ['code', 0]]
    },
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

  // Tables are in the BASE schema deliberately. Without them a <table> in
  // stored content becomes an opaque preserved atom -- faithful but uneditable,
  // which is not something you can tell a CMS. The heavy part (cell selection,
  // column resizing, the row and column commands) is the opt-in
  // @openleaf/plugins-table.
  table,
  table_row,
  table_cell,
  table_header,

  unknown_block: unknownBlock,
  unknown_inline: unknownInline,
}

/** The base mark specs. */
export const coreMarks: Record<string, MarkSpec> = {
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

/**
 * The base schema, with no extensions.
 *
 * Kept for the many places that only ever need the built-in types. Anything that
 * must honour plugin-contributed node types uses `createSchema` or reads
 * `state.schema` instead -- see extensions.ts.
 */
export const baseSchema = new Schema({ nodes: coreNodes, marks: coreMarks })
