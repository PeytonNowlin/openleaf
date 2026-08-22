/**
 * The OpenLeaf document schema.
 *
 * Scope note: table NODES are here, in the base schema, so that every
 * deployment reads and writes tables faithfully. Table EDITING -- cell
 * selection, column resizing, the row and column commands and toolbar -- is
 * the opt-in @openleaf-editor/plugins-table. See tables.ts for why the split falls
 * there rather than at the package boundary.
 */

import { Schema, type Attrs, type DOMOutputSpec, type MarkSpec, type NodeSpec } from 'prosemirror-model'
import { INLINE_STYLE_PROPERTIES, applyStyleAttribute, indentCss, indentLevels, isFullyModelledStyle, modelledValue, parseDeclarations, safeAlign, safeColor, safeDir, safeFontFamily, safeFontSize, safeLang, safeLineHeight, safeListStyle, serializeDeclarations, type Align, type Dir, type ListStyle } from './css.js'
import { serializationTarget, unknownBlock, unknownInline } from './preserve.js'
import {
  audio,
  details,
  figcaption,
  figure,
  iframe,
  imageDomAttrs,
  imageParseAttrs,
  isEmptyNamedAnchorElement,
  named_anchor,
  page_break,
  summary,
  video,
} from './structure.js'
import { table, table_cell, table_header, table_row } from './tables.js'
import { safeId } from './tokens.js'
import { isSafeUrl } from './url.js'

/**
 * Read the attributes every text block shares: direction and alignment.
 *
 * Alignment is read from `text-align` first and the legacy `align` attribute
 * second, because content that carries both was almost always produced by an
 * editor that wrote the modern form and left the old one behind. Reading the
 * legacy attribute at all is the point: `<p align="center">` is what fifteen
 * years of CMS content looks like, and a schema that only understands the
 * declaration silently centres nothing.
 */
function textBlockAttrs(el: Element): {
  dir: Dir | null
  align: Align | null
  lineHeight: string | null
  indent: number | null
} {
  const dir = safeDir(el.getAttribute('dir'))
  const declarations = parseDeclarations(el.getAttribute('style'))
  return {
    dir,
    align: safeAlign(declarations.get('text-align') ?? el.getAttribute('align'), dir),
    lineHeight: safeLineHeight(declarations.get('line-height') ?? null) ,
    indent: readIndent(declarations),
  }
}

function readIndent(declarations: Map<string, string>): number | null {
  for (const property of [
    'padding-inline-start',
    'margin-inline-start',
    'padding-left',
    'margin-left',
  ]) {
    const steps = indentLevels(declarations.get(property))
    if (steps !== null) return steps
  }
  return null
}

function headingAttrs(el: Element, level: number): { level: number; dir: string | null; align: Align | null; id: string | null } {
  return { level, id: safeId(el.getAttribute('id')), ...textBlockAttrs(el) }
}

/**
 * Write them back.
 *
 * Alignment, line height and indent go out as a single `style` attribute in a
 * stable order, never as the legacy `align` attribute, so stored content
 * converges on the form that is still valid HTML. The `align` attribute the
 * value may have been read from is dropped from the carried residue by
 * extensions.ts.
 */
function textBlockDOMAttrs(attrs: Attrs): Record<string, string> {
  const out: Record<string, string> = {}
  const dir = attrs['dir'] as Dir | null
  if (dir !== null) out['dir'] = dir
  const id = attrs['id'] as string | null | undefined
  if (id) out['id'] = id

  const declarations = new Map<string, string>()
  const align = attrs['align'] as Align | null
  if (align !== null) declarations.set('text-align', align)
  const lineHeight = attrs['lineHeight'] as string | null
  if (lineHeight !== null) declarations.set('line-height', lineHeight)
  const indent = attrs['indent'] as number | null
  if (indent !== null && indent > 0) declarations.set('padding-inline-start', indentCss(indent))
  const style = serializeDeclarations(declarations)
  if (style !== null) out['style'] = style
  return out
}

/**
 * An element carrying these attributes, with `style` applied directly.
 *
 * Returned instead of a `['p', attrs, 0]` spec ONLY when there is CSS to write,
 * because the serializer would otherwise put the declaration through the CSSOM
 * and rewrite it. See applyStyleAttribute for why that matters. Everything with
 * no style stays on the plain spec path, which is both cheaper and less code to
 * be wrong about.
 */
function elementWithStyle(tag: string, attrs: Record<string, string>): DOMOutputSpec {
  const el = serializationTarget().createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'style') applyStyleAttribute(el, value)
    else el.setAttribute(name, value)
  }
  return { dom: el, contentDOM: el }
}

/** `toDOM` for a text block: a spec array normally, an element when it has CSS. */
function textBlockToDOM(tag: string, attrs: Attrs): DOMOutputSpec {
  const domAttrs = textBlockDOMAttrs(attrs)
  if (domAttrs['style'] !== undefined) return elementWithStyle(tag, domAttrs)
  return Object.keys(domAttrs).length > 0 ? [tag, domAttrs, 0] : [tag, 0]
}

/**
 * The `start` of an ordered list, or null when the attribute is not a number.
 *
 * `Number('abc')` is `NaN`, and `NaN` is a perfectly good value to store on a
 * node -- so `<ol start="abc">` was stored as `NaN` and serialized as the string
 * `start="NaN"`, turning a value the browser ignores into one it still ignores
 * but that is now in the customer's database with our fingerprints on it.
 * Returning null instead lets extensions.ts carry the original spelling as
 * residue, so the attribute survives without being interpreted.
 *
 * Exported so that the carry mechanism asks the same question this does. Two
 * copies of "is this a valid start" is how they would disagree and emit the
 * attribute twice, or neither time.
 */
export function listStart(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function listAttrs(el: Element, ordered: boolean): { start?: number; listStyle: ListStyle | null } {
  const declarations = parseDeclarations(el.getAttribute('style'))
  const fromStyle = safeListStyle(declarations.get('list-style-type') ?? null)
  const fromType = safeListStyle(el.getAttribute('type'))
  const listStyle = fromStyle ?? fromType
  if (!ordered) return { listStyle }
  return { start: listStart(el.getAttribute('start')) ?? 1, listStyle }
}

function listToDOM(tag: 'ul' | 'ol', attrs: Attrs): DOMOutputSpec {
  const out: Record<string, string> = {}
  if (tag === 'ol') {
    const start = attrs['start'] as number
    if (start !== 1) out['start'] = String(start)
  }
  const listStyle = attrs['listStyle'] as ListStyle | null
  if (listStyle !== null) out['style'] = `list-style-type:${listStyle}`
  if (out['style'] !== undefined) {
    const el = serializationTarget().createElement(tag)
    for (const [name, value] of Object.entries(out)) {
      if (name === 'style') applyStyleAttribute(el, value)
      else el.setAttribute(name, value)
    }
    return { dom: el, contentDOM: el }
  }
  return Object.keys(out).length > 0 ? [tag, out, 0] : [tag, 0]
}

/** The base node specs. Extensions are appended to these. */
export const coreNodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    // `dir` is bidirectional text direction, not styling. Dropping it
    // silently breaks Arabic, Hebrew and Persian content, so it is a
    // first-class schema attribute rather than something the preservation
    // layer has to rescue.
    //
    // `align` is styling, and is modelled anyway. Left to the preservation
    // layer it survives as opaque residue -- faithful, but invisible to the
    // toolbar, so an author cannot see that a paragraph is centred or change
    // it. A formatting control the editor cannot express is a feature request
    // the schema is answering.
    attrs: {
      dir: { default: null },
      align: { default: null },
      lineHeight: { default: null },
      indent: { default: null },
    },
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p', getAttrs: (dom) => textBlockAttrs(dom as Element) }],
    toDOM: (node) => textBlockToDOM('p', node.attrs),
  },

  heading: {
    attrs: {
      level: { default: 1 },
      dir: { default: null },
      align: { default: null },
      lineHeight: { default: null },
      indent: { default: null },
      id: { default: null },
    },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom) => headingAttrs(dom as Element, level),
    })),
    toDOM: (node) => textBlockToDOM(`h${node.attrs['level'] as number}`, node.attrs),
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
    parseDOM: [
      {
        tag: 'hr',
        getAttrs: (dom) => ((dom as Element).classList.contains('ol-pagebreak') ? false : null),
      },
    ],
    toDOM: () => ['hr'],
  },

  bullet_list: {
    attrs: { listStyle: { default: null } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [
      {
        tag: 'ul',
        getAttrs: (dom) => listAttrs(dom as Element, false),
      },
    ],
    toDOM: (node) => listToDOM('ul', node.attrs),
  },

  ordered_list: {
    attrs: { start: { default: 1 }, listStyle: { default: null } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => listAttrs(dom as Element, true),
      },
    ],
    toDOM: (node) => listToDOM('ol', node.attrs),
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
      align: { default: null },
      className: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => imageParseAttrs(dom as Element),
      },
    ],
    toDOM: (node) => ['img', imageDomAttrs(node.attrs)],
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
  // @openleaf-editor/plugins-table.
  table,
  table_row,
  table_cell,
  table_header,

  // Media and structure: in the base schema so stored documents stay editable.
  // The insert dialogs, character map and resize handles are the opt-in plugin.
  video,
  audio,
  iframe,
  details,
  summary,
  figure,
  figcaption,
  page_break,
  named_anchor,

  unknown_block: unknownBlock,
  unknown_inline: unknownInline,
}

/**
 * True when a `<span>` carries nothing but formatting the mark set can express.
 *
 * The question a TAG rule on a mark has to ask, and the reason it is not
 * `isFullyModelledStyle` alone: `background` is the shorthand Word writes, and
 * the rule below reads it through `el.style.backgroundColor`, so the CSSOM has
 * already expanded it and it is genuinely modelled even though the declaration
 * name is not in the modelled list. Refusing it would turn every highlighted
 * Word paste into an opaque atom.
 *
 * Any other attribute, or any declaration a mark cannot hold, and the answer is
 * no -- because a mark that claims the element has nowhere to keep the rest.
 */
function isSpanOnlyStyling(el: Element): boolean {
  for (const attr of Array.from(el.attributes)) {
    if (attr.name !== 'style') return false
  }
  const declarations = parseDeclarations(el.getAttribute('style'))
  if (declarations.size === 0) return false
  for (const [name, value] of declarations) {
    if (name === 'background') continue
    if (!INLINE_STYLE_PROPERTIES.includes(name)) return false
    if (modelledValue(name, value) === null) return false
  }
  return true
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

  /*
   * Colour, as two marks rather than one.
   *
   * Foreground and background are independent: an author highlights a run of
   * text yellow and then makes it red, and a single mark holding both attributes
   * would have the second command overwrite the first's value with a default.
   * Two marks compose the way the toolbar's two controls do.
   *
   * Both are parsed through a `style` rule, not a tag rule, and that choice is
   * load-bearing. ProseMirror applies style rules to whatever element carries
   * the declaration, so `<span style="color:red">`, `<p style="color:red">` and
   * a `<div>` wrapper all yield the same mark -- whereas a `span[style]` tag rule
   * would claim the span, drop it, and quietly lose any other declaration on it.
   *
   * The value is normalized by `safeColor`, which folds `rgb(255, 0, 0)` back to
   * `#ff0000`. That is not cosmetic: ProseMirror reads style rules through the
   * CSSOM, which returns the functional form for an authored hex colour, so
   * without the fold every hex colour in an archive would be rewritten longer on
   * the first save.
   */
  text_color: {
    attrs: { color: {} },
    parseDOM: [
      {
        style: 'color',
        getAttrs(value) {
          const color = safeColor(value)
          return color ? { color } : false
        },
      },
      {
        // `<font color="red">` is what a decade of CMS content looks like, and
        // it is one of the few legacy tags that maps onto a modern mark with
        // nothing left over.
        tag: 'font[color]',
        getAttrs(dom) {
          const el = dom as Element
          // Only when colour is the whole story. `<font face="Arial" size="2">`
          // carries information this mark cannot hold, so it belongs to the
          // preservation layer instead -- claiming it here would drop the rest.
          if (el.attributes.length > 1) return false
          const color = safeColor(el.getAttribute('color'))
          return color ? { color } : false
        },
      },
    ],
    toDOM: (mark) => elementWithStyle('span', { style: `color:${mark.attrs['color'] as string}` }),
  },

  background_color: {
    attrs: { color: {} },
    parseDOM: [
      {
        // Restricted to span so a cell's own background is not also read as a
        // highlight mark on every character inside it. The CSSOM still expands
        // the `background` shorthand on the element, so Word's
        // `style="background:yellow"` arrives here without a second rule.
        tag: 'span',
        getAttrs(dom) {
          const el = dom as HTMLElement
          // Only when the span is nothing but formatting this mark can hold.
          // A tag rule CONSUMES the element, and a mark has nowhere to put the
          // rest of it, so claiming `<span class="hl" style="background-color:
          // #ffff00">` deleted the class outright -- and `style="background-
          // color:#ffff00;letter-spacing:1px"` lost the letter-spacing the same
          // way, with no residue, because a mark is not a node and the carry
          // mechanism never sees it. Declining leaves the element to the
          // preservation layer, which keeps it whole. This is the same bargain
          // `font[color]` and `span[lang]` already strike a few lines away.
          if (!isSpanOnlyStyling(el)) return false
          const fromAttr = parseDeclarations(el.getAttribute('style')).get('background-color')
          const color = safeColor(el.style.backgroundColor) ?? safeColor(fromAttr)
          return color ? { color } : false
        },
      },
    ],
    toDOM: (mark) =>
      elementWithStyle('span', { style: `background-color:${mark.attrs['color'] as string}` }),
  },

  font_family: {
    attrs: { family: {} },
    parseDOM: [
      {
        style: 'font-family',
        getAttrs(value) {
          const family = safeFontFamily(value)
          return family ? { family } : false
        },
      },
      {
        tag: 'font[face]',
        getAttrs(dom) {
          const el = dom as Element
          // Colour-only `<font>` is a different mark. Face plus anything else
          // this mark cannot hold stays with the preservation layer.
          if (el.attributes.length > 1) return false
          const family = safeFontFamily(el.getAttribute('face'))
          return family ? { family } : false
        },
      },
    ],
    toDOM: (mark) =>
      elementWithStyle('span', { style: `font-family:${mark.attrs['family'] as string}` }),
  },

  font_size: {
    attrs: { size: {} },
    parseDOM: [
      {
        style: 'font-size',
        getAttrs(value) {
          const size = safeFontSize(value)
          return size ? { size } : false
        },
      },
    ],
    toDOM: (mark) =>
      elementWithStyle('span', { style: `font-size:${mark.attrs['size'] as string}` }),
  },

  subscript: {
    excludes: 'superscript',
    parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }],
    toDOM: () => ['sub', 0],
  },

  superscript: {
    excludes: 'subscript',
    parseDOM: [{ tag: 'sup' }, { style: 'vertical-align=super' }],
    toDOM: () => ['sup', 0],
  },

  language: {
    attrs: { lang: {} },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span[lang]',
        getAttrs(dom) {
          const el = dom as Element
          const lang = safeLang(el.getAttribute('lang'))
          if (!lang) return false
          for (const attr of Array.from(el.attributes)) {
            if (attr.name === 'lang') continue
            if (attr.name === 'style' && isFullyModelledStyle(attr.value)) continue
            return false
          }
          return { lang }
        },
      },
    ],
    toDOM: (mark) => ['span', { lang: mark.attrs['lang'] as string }, 0],
  },

  link: {
    attrs: {
      // Null when the mark is a wrapped named destination (`<a id>` with
      // text, no href). Empty `<a id></a>` is the `named_anchor` atom.
      href: { default: null },
      title: { default: null },
      target: { default: null },
      rel: { default: null },
      id: { default: null },
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
            id: safeId(el.getAttribute('id')),
          }
        },
      },
      {
        tag: 'a[id]',
        getAttrs(dom) {
          const el = dom as Element
          if (el.hasAttribute('href')) return false
          const id = safeId(el.getAttribute('id'))
          if (!id) return false
          // Empty `<a id>` belongs to `named_anchor`. This rule is the
          // wrapped-text spelling, so the heading stays in the document.
          if (isEmptyNamedAnchorElement(el)) return false
          return {
            href: null,
            title: el.getAttribute('title'),
            target: el.getAttribute('target'),
            rel: el.getAttribute('rel'),
            id,
          }
        },
      },
    ],
    toDOM(node) {
      const { href, title, target, rel, id } = node.attrs
      const attrs: Record<string, string> = {}
      if (href !== null) attrs['href'] = href as string
      if (title !== null) attrs['title'] = title as string
      if (target !== null) attrs['target'] = target as string
      if (rel !== null) attrs['rel'] = rel as string
      if (id !== null) attrs['id'] = id as string
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
