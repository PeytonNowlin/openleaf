/**
 * Table node specifications.
 *
 * ## Why these live in core rather than in the opt-in plugin
 *
 * The obvious design is to put tables entirely in `@openleaf-editor/plugins-table`, so
 * a CMS that forbids tables ships none of the code. That is wrong, and the
 * fidelity harness is what shows why: without these node types, a `<table>` in
 * stored content is claimed by the preservation layer and becomes a single
 * opaque atom. It round-trips faithfully -- but it is *uneditable*. An author
 * opening a decade-old post finds a grey card where their table used to be.
 *
 * "We read your tables but you may not touch them" is not a thing you can tell a
 * CMS. So the schema is always present, costing about a kilobyte, and what is
 * genuinely opt-in is the *editing machinery*: cell selection, column resizing,
 * the row and column commands, the toolbar controls. That is the part with real
 * weight, and it lives in the plugin.
 *
 * ## Compatibility with prosemirror-tables
 *
 * Each spec carries a `tableRole`, which is how `prosemirror-tables` recognises
 * these nodes. Cell attributes are named `colspan`, `rowspan` and `colwidth`
 * exactly because that library requires those names. Deviating would mean
 * forking it.
 *
 * ## Legacy presentational attributes
 *
 * `border`, `cellpadding`, `cellspacing`, `align` and friends are kept, which a
 * clean-slate schema would not do. They are how HTML expressed table styling for
 * fifteen years, they are all over the content this editor is meant to inherit,
 * and dropping them changes how a page renders. Preserving them is the same
 * decision the preservation layer makes, applied to attributes.
 *
 * `scope` on a header cell is kept for a different and more important reason: it
 * is what tells a screen reader which cells a header governs. Dropping it turns
 * a navigable table into a grid of unrelated values.
 */

import type { NodeSpec } from 'prosemirror-model'
import { isSerializing, scrub, serializationTarget } from './preserve.js'

/** Presentational attributes legacy CMS content puts on `<table>`. */
const TABLE_LEGACY_ATTRS = ['border', 'cellpadding', 'cellspacing', 'width', 'align', 'summary', 'class'] as const

/** Attributes legacy content puts on cells, plus the accessibility-critical ones. */
const CELL_LEGACY_ATTRS = ['align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr'] as const

function readAttrs(el: Element, names: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const name of names) out[name] = el.getAttribute(name)
  return out
}

function writeAttrs(
  attrs: Record<string, unknown>,
  names: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = attrs[name]
    if (value !== null && value !== undefined && value !== '') out[name] = String(value)
  }
  return out
}

const legacyDefaults = (names: readonly string[]): Record<string, { default: null }> =>
  Object.fromEntries(names.map((name) => [name, { default: null }]))

/**
 * Parse `colwidth` from an inline width style or attribute.
 *
 * `prosemirror-tables` stores column widths as an array of numbers on the cell
 * that starts the column, which is how its resizing plugin reads them.
 */
function readColwidth(el: Element): number[] | null {
  const widthAttr = el.getAttribute('data-colwidth')
  if (widthAttr) {
    const parsed = widthAttr.split(',').map((n) => Number.parseInt(n, 10))
    if (parsed.every((n) => Number.isFinite(n))) return parsed
  }
  return null
}

const cellAttrs = {
  // These three names are required by prosemirror-tables.
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
  ...legacyDefaults(CELL_LEGACY_ATTRS),
}

function cellGetAttrs(dom: Node): Record<string, unknown> {
  const el = dom as Element
  return {
    colspan: Number.parseInt(el.getAttribute('colspan') ?? '1', 10) || 1,
    rowspan: Number.parseInt(el.getAttribute('rowspan') ?? '1', 10) || 1,
    colwidth: readColwidth(el),
    ...readAttrs(el, CELL_LEGACY_ATTRS),
  }
}

function cellToDOM(tag: 'td' | 'th') {
  return (node: { attrs: Record<string, unknown> }): [string, Record<string, string>, 0] => {
    const attrs = writeAttrs(node.attrs, CELL_LEGACY_ATTRS)
    const colspan = node.attrs['colspan'] as number
    const rowspan = node.attrs['rowspan'] as number
    if (colspan !== 1) attrs['colspan'] = String(colspan)
    if (rowspan !== 1) attrs['rowspan'] = String(rowspan)
    const colwidth = node.attrs['colwidth'] as number[] | null
    if (colwidth) attrs['data-colwidth'] = colwidth.join(',')
    return [tag, attrs, 0]
  }
}

/**
 * `<caption>` and `<colgroup>`/`<col>`: preserved as markup on the table node.
 *
 * These are the two parts of a table that are neither rows nor cells, and until
 * now both were discarded on parse. For a caption that is not a cosmetic loss:
 * a caption is a table's accessible name, so opening and saving an inherited
 * document silently stripped the one element telling a screen-reader user what
 * the table is. Column widths in a `<colgroup>` went the same way, taking the
 * page's layout with them.
 *
 * They are attributes rather than child nodes, which is the compromise and is
 * worth being precise about. The natural model is a `caption` node as the
 * table's first child. It cannot work today: `prosemirror-tables` computes its
 * cell map with `height = table.childCount` and reads `table.child(row)` as a
 * row, so any non-row child shifts every coordinate the library derives, and
 * cell selection, column resizing and the row/column commands all index into
 * the wrong place. Storing markup on an attribute keeps the node's children
 * exactly what that library requires while making the round-trip lossless.
 *
 * The cost is that the caption is not editable in place -- it renders, it
 * survives, it cannot be typed into. That is a real limitation and it is the
 * same bargain the preservation layer already strikes everywhere else: content
 * kept intact and inert beats content silently deleted. Editing it needs the
 * upstream indexing fix, at which point this becomes a node and the attribute
 * migrates.
 *
 * Scrubbed on the way in with the preservation layer's own scrubber, so a
 * `<caption onclick="...">` cannot ride in on a code path whose entire promise
 * is to hand markup back unmodified.
 */
const FURNITURE_TAGS: ReadonlySet<string> = new Set(['caption', 'colgroup', 'col'])

/** Serialized direct children of `el` matching `tags`, in document order. */
function readFurniture(el: Element, tags: readonly string[]): string | null {
  let html = ''
  for (const child of Array.from(el.children)) {
    if (!tags.includes(child.nodeName.toLowerCase())) continue
    html += scrub(child)
    // HTML permits exactly one caption; a second is somebody else's bug and
    // concatenating it would render two. Take the first and stop.
    if (child.nodeName.toLowerCase() === 'caption') break
  }
  return html || null
}

/**
 * Rebuild stored furniture markup and append it to the table being built.
 *
 * `<template>` is the parsing context because a bare `<caption>` or `<col>` is
 * illegal inside a `<div>` and would be silently discarded there -- the same
 * reason the preservation layer uses one.
 */
function appendFurniture(table: Element, html: string, doc: Document, inert: boolean): void {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  for (const child of Array.from((tpl as HTMLTemplateElement).content.children)) {
    if (!FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    // Editor only. A caption sits inside the editable area but outside the
    // node's contentDOM, so without this a caret can enter text ProseMirror
    // will discard on its next redraw.
    if (inert) child.setAttribute('contenteditable', 'false')
    table.appendChild(child)
  }
}

export const table: NodeSpec = {
  content: 'table_row+',
  tableRole: 'table',
  isolating: true,
  group: 'block',
  attrs: {
    ...legacyDefaults(TABLE_LEGACY_ATTRS),
    caption: { default: null },
    colgroup: { default: null },
  },
  parseDOM: [
    {
      tag: 'table',
      getAttrs: (dom) => ({
        ...readAttrs(dom as Element, TABLE_LEGACY_ATTRS),
        caption: readFurniture(dom as Element, ['caption']),
        colgroup: readFurniture(dom as Element, ['colgroup', 'col']),
      }),
    },
    /*
     * `tbody`, `thead` and `tfoot` are SKIPPED rather than ignored: the wrapper
     * itself carries nothing, but its rows are the entire content. `ignore`
     * would delete the table's contents along with the wrapper.
     *
     * These rules also have to exist because the preservation layer's catch-all
     * would otherwise claim a `<tbody>` as unrecognised markup and produce an
     * opaque atom that `table_row+` refuses to accept.
     */
    { tag: 'tbody', skip: true },
    { tag: 'thead', skip: true },
    { tag: 'tfoot', skip: true },
    /*
     * `caption`, `colgroup` and `col` are ignored as CONTENT and captured as
     * ATTRIBUTES instead -- see `readFurniture` for why they cannot be nodes.
     *
     * The `ignore` rules are still load-bearing after that capture. Without
     * them the preservation layer's catch-all claims a `<caption>` as an
     * unrecognised block, and `table_row+` refuses to accept it, so the caption
     * is dropped a second way by a different mechanism.
     */
    { tag: 'colgroup', ignore: true },
    { tag: 'col', ignore: true },
    { tag: 'caption', ignore: true },
  ],
  toDOM(node) {
    const attrs = writeAttrs(node.attrs, TABLE_LEGACY_ATTRS)
    const caption = node.attrs['caption'] as string | null
    const colgroup = node.attrs['colgroup'] as string | null
    if (!caption && !colgroup) return ['table', attrs, ['tbody', 0]]

    /*
     * Furniture forces a real element rather than an output-spec array, because
     * an array cannot express "these children, then the content hole inside a
     * LATER child". `{ dom, contentDOM }` can, and ProseMirror accepts it from
     * both the editor's node renderer and DOMSerializer.
     */
    const doc = serializationTarget()
    const table = doc.createElement('table')
    for (const [name, value] of Object.entries(attrs)) table.setAttribute(name, value)

    // Document order is fixed by HTML: caption first, then colgroup, then rows.
    // Emitting them in any other order produces markup browsers reshuffle, which
    // would make the round-trip lossy again by a subtler route.
    if (caption) appendFurniture(table, caption, doc, !isSerializing())
    if (colgroup) appendFurniture(table, colgroup, doc, false)

    const tbody = doc.createElement('tbody')
    table.appendChild(tbody)
    return { dom: table, contentDOM: tbody }
  },
}

export const table_row: NodeSpec = {
  content: '(table_cell | table_header)*',
  tableRole: 'row',
  attrs: { class: { default: null }, align: { default: null } },
  parseDOM: [{ tag: 'tr', getAttrs: (dom) => readAttrs(dom as Element, ['class', 'align']) }],
  toDOM(node) {
    return ['tr', writeAttrs(node.attrs, ['class', 'align']), 0]
  },
}

export const table_cell: NodeSpec = {
  content: 'block+',
  attrs: cellAttrs,
  tableRole: 'cell',
  isolating: true,
  parseDOM: [{ tag: 'td', getAttrs: cellGetAttrs }],
  toDOM: cellToDOM('td'),
}

export const table_header: NodeSpec = {
  content: 'block+',
  attrs: cellAttrs,
  tableRole: 'header_cell',
  isolating: true,
  parseDOM: [{ tag: 'th', getAttrs: cellGetAttrs }],
  toDOM: cellToDOM('th'),
}
