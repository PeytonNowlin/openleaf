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

export const table: NodeSpec = {
  content: 'table_row+',
  tableRole: 'table',
  isolating: true,
  group: 'block',
  attrs: legacyDefaults(TABLE_LEGACY_ATTRS),
  parseDOM: [
    { tag: 'table', getAttrs: (dom) => readAttrs(dom as Element, TABLE_LEGACY_ATTRS) },
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
     * KNOWN LIMITATION, declared rather than hidden.
     *
     * `<colgroup>`/`<col>` are dropped, and `<caption>` is dropped with its
     * text. Both should be preserved and neither can be today: a caption node
     * would have to be the table's first child, and `prosemirror-tables`
     * computes its cell map by treating every child of a table as a row, so a
     * leading caption breaks its indexing.
     *
     * Dropping a caption is a real accessibility regression -- a caption is a
     * table's accessible name -- so this is tracked as a bug to fix by adding a
     * caption node and contributing the indexing fix upstream, not as a design
     * decision. There is a fixture asserting the current behaviour so it cannot
     * regress further without someone noticing.
     */
    { tag: 'colgroup', ignore: true },
    { tag: 'col', ignore: true },
    { tag: 'caption', ignore: true },
  ],
  toDOM(node) {
    return ['table', writeAttrs(node.attrs, TABLE_LEGACY_ATTRS), ['tbody', 0]]
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
