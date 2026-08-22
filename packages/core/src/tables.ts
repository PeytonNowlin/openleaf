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

import type { DOMOutputSpec, NodeSpec } from 'prosemirror-model'
import {
  applyStyleAttribute,
  parseDeclarations,
  safeColor,
  serializeDeclarations,
} from './css.js'
import { isSerializing, scrub, serializationTarget } from './preserve.js'

/** Presentational attributes legacy CMS content puts on `<table>`. */
const TABLE_LEGACY_ATTRS = ['border', 'cellpadding', 'cellspacing', 'width', 'align', 'summary', 'class'] as const

/** Attributes legacy content puts on cells, plus the accessibility-critical ones. */
const CELL_LEGACY_ATTRS = ['align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr'] as const

const ROW_ATTRS = ['class', 'align', 'valign'] as const

/**
 * Style properties the table schema models. Kept here rather than in
 * `MODELLED_PROPERTIES` because those drive span-unwrapping; a span with
 * `padding` is still an opaque atom, a cell with `padding` is a cell.
 */
const TABLE_STYLE_PROPS = ['background-color', 'width', 'height'] as const
const ROW_STYLE_PROPS = ['background-color', 'height'] as const
const CELL_STYLE_PROPS = ['background-color', 'padding'] as const

const LENGTH = /^-?\d+(?:\.\d+)?(?:px|em|rem|%|pt|ex|ch)?$/i
const VALIGN = new Set(['top', 'middle', 'bottom', 'baseline'])

function safeLength(value: string): string | null {
  const candidate = value.trim()
  return LENGTH.test(candidate) ? candidate : null
}

function safePadding(value: string): string | null {
  const parts = value.trim().split(/\s+/)
  if (parts.length < 1 || parts.length > 4) return null
  const safe = parts.map(safeLength)
  return safe.every((part): part is string => part !== null) ? safe.join(' ') : null
}

function safeVAlign(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase()
  return VALIGN.has(candidate) ? candidate : null
}

/**
 * The one validator for a table style declaration, on the way in or out.
 *
 * Exported because the property dialogs in `@openleaf-editor/plugins-table`
 * write node attributes directly, which does not go through any parse rule. A
 * dialog with its own idea of an acceptable padding would drift from this one,
 * and `padding: 0;position:fixed;inset:0` is what that drift looks like: the
 * value becomes two more declarations when the style attribute is serialized.
 *
 * Returns null for a property this schema does not model, so an unrecognised
 * name is dropped rather than trusted.
 */
export function safeTableStyleValue(property: string, value: string | undefined): string | null {
  if (!value) return null
  if (property === 'background-color') return safeColor(value)
  if (property === 'padding') return safePadding(value)
  if (property === 'width' || property === 'height') return safeLength(value)
  return null
}

function safeStyleValue(property: string, value: string | undefined): string | null {
  return safeTableStyleValue(property, value)
}

function readStyle(el: Element, properties: readonly string[]): string | null {
  const declarations = parseDeclarations(el.getAttribute('style'))
  const bgcolor = safeColor(el.getAttribute('bgcolor'))
  const out = new Map<string, string>()
  for (const name of properties) {
    const safe = safeStyleValue(name, declarations.get(name))
    /*
     * `bgcolor` is the legacy spelling of `background-color`, read only when
     * the declaration itself is absent.
     *
     * Resolved INSIDE the loop so that the result is in `properties` order
     * whichever spelling it came from. Filling it in afterwards -- which is
     * what this did -- appended the background last when it came from the
     * attribute and emitted it first when it came from the declaration. A cell
     * carrying both a `bgcolor` and a `padding` therefore serialized in one
     * order on the first save and the other on the second: the round trip was
     * not a fixed point, so the markup churned on every save, forever, with a
     * real diff each time and nothing to show for it.
     */
    const value = safe ?? (name === 'background-color' ? bgcolor : null)
    if (value) out.set(name, value)
  }
  return serializeDeclarations(out)
}

/**
 * Remove from a node's carried residue every declaration the node itself
 * consumed, and nothing else.
 *
 * The counterpart to `readStyle`. Because `style` is always carried verbatim
 * (see extensions.ts for why a composite attribute cannot be "claimed" by a
 * spec), a cell that stored `background-color:red;border:1px solid red` holds
 * the whole string in residue and the background in its own attribute. Emitting
 * both would write the background twice.
 *
 * The test is `safeTableStyleValue(...) !== null`, not "is this property in the
 * list", and the difference is the point: `readStyle` drops a value it cannot
 * validate, so `width:calc(100% - 3px)` never reached the node's attribute and
 * must therefore stay in the residue. Matching on the property name alone would
 * delete it from both places and lose it.
 *
 * `bgcolor` and `vertical-align` go for the same reason one level up: both are
 * folded into a modelled attribute on the way in, so leaving the original in the
 * residue emits two spellings of one fact -- which is the state `<td bgcolor>`
 * was actually in, coming back as `style="background-color:#f00" bgcolor="#f00"`.
 * This is the trade `scrubModelledStyle` already makes for `<p align="center">`:
 * stored content converges on the spelling that is still valid HTML.
 */
function scrubTableStyle(properties: readonly string[], cell: boolean) {
  return (carried: Record<string, string>): void => {
    const style = carried['style']
    if (style !== undefined) {
      const declarations = parseDeclarations(style)
      const before = declarations.size
      for (const name of properties) {
        const value = declarations.get(name)
        if (value !== undefined && safeTableStyleValue(name, value) !== null) {
          declarations.delete(name)
        }
      }
      if (cell) {
        const valign = declarations.get('vertical-align')
        if (valign !== undefined && safeVAlign(valign) !== null) {
          declarations.delete('vertical-align')
        }
      }
      // Nothing consumed means nothing to rewrite: leave the author's spelling
      // alone, for the same reason `scrubModelledStyle` does.
      if (declarations.size !== before) {
        const rest = serializeDeclarations(declarations)
        if (rest !== null) carried['style'] = rest
        else delete carried['style']
      }
    }
    const bgcolor = carried['bgcolor']
    if (bgcolor !== undefined && safeColor(bgcolor) !== null) delete carried['bgcolor']
  }
}

/** The residue scrubs for the table node types, keyed by schema node name. */
export const CARRIED_STYLE_SCRUBS: Record<string, (carried: Record<string, string>) => void> = {
  table: scrubTableStyle(TABLE_STYLE_PROPS, false),
  table_row: scrubTableStyle(ROW_STYLE_PROPS, false),
  table_cell: scrubTableStyle(CELL_STYLE_PROPS, true),
  table_header: scrubTableStyle(CELL_STYLE_PROPS, true),
}

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
 * Bounds for the cell span attributes, and why a parser has to impose them.
 *
 * Both consumers of `colspan` scale linearly in it. `TableMap.get` allocates and
 * fills `width * height` map cells, and `updateColumnsOnResize` -- installed for
 * every table node view by `columnResizing()` in `plugins-table` -- appends one
 * real `<col>` element per column. So a single stored `<td colspan="5000000">`
 * was five million DOM elements built synchronously on first render, and a table
 * asked to lay out half a billion pixels wide. That is a hung tab from a
 * fifty-byte attribute, reachable through every entry point into the schema:
 * `element.value`, `parseHtml`, a paste, an import, or content stored before this
 * bound existed.
 *
 * Negative values were worse than large ones. `|| 1` catches `NaN` and `0` and
 * nothing else, so `colspan="-5"` landed verbatim and `computeMap` then did
 * `mapPos += colspan` with a negative operand, walking its write cursor backwards
 * through the map it was filling.
 *
 * The numbers are HTML's own limits, so nothing an author could have written in a
 * document is lost: a browser parsing the same markup clamps it identically.
 *
 * Clamping here rather than defending in the consumers is deliberate. The
 * commands in `plugins-table`, the property dialogs, `fixTables` and the resize
 * node view all read `node.attrs.colspan` directly, and every one of them would
 * otherwise need a bound of its own.
 */
const MAX_COLSPAN = 1000
const MAX_ROWSPAN = 65534
/**
 * The cumulative bound, and why the per-cell one is not enough on its own.
 *
 * `MAX_COLSPAN` bounds one attribute. It does not bound their sum, and both
 * consumers scale in the sum: a row of 5,000 `<td colspan="1000">` cells is
 * about 125 KB of input and produces a five-million-column table -- measured,
 * not estimated -- which is the same hung tab the per-cell clamp exists to
 * prevent, reached by addition instead of by one large number.
 *
 * So a row gets a total as well, and each cell is clamped against what the row
 * has left. A cell arriving with nothing left still claims one column rather
 * than being dropped: losing a cell silently changes the document, and one
 * column each is already harmless. That puts the worst case at
 * `max(cells in the row, MAX_TABLE_COLUMNS)` columns -- linear in the input,
 * because 5,000 cells cost 5,000 tags to write. Removing the amplification is
 * the property that matters; a wide table is only ever as wide as its markup.
 */
const MAX_TABLE_COLUMNS = 1000
/**
 * A column wider than this is not a layout.
 *
 * `updateColumnsOnResize` writes each entry straight into `col.style.width`, and
 * sums them into the table's `minWidth`.
 */
const MAX_COLWIDTH = 10000

/**
 * A span attribute, clamped to what HTML itself allows.
 *
 * `rowspan="0"` means "to the end of the section" in HTML, but
 * `prosemirror-tables` requires at least 1 and the schema default is 1, so it
 * normalizes up rather than being carried as a zero the cell map cannot use.
 */
function readSpan(el: Element, name: 'colspan' | 'rowspan', max: number): number {
  const parsed = Number.parseInt(el.getAttribute(name) ?? '1', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, max)
}

/**
 * Every cell in a row, clamped against the row's cumulative column budget.
 *
 * Computed once per row and memoised rather than per cell against its preceding
 * siblings, which would be quadratic in exactly the row built to be wide. Keyed
 * by element, so the answer does not depend on the order ProseMirror happens to
 * visit the cells in, and recomputing it for the same row is a lookup.
 */
const rowBudgets = new WeakMap<Element, Map<Element, number>>()

/** Whether this element is a cell, so a stray child cannot spend the budget. */
function isCell(el: Element): boolean {
  const name = el.nodeName.toLowerCase()
  return name === 'td' || name === 'th'
}

function budgetedColspan(el: Element): number {
  const row = el.parentElement
  if (row === null) return readSpan(el, 'colspan', MAX_COLSPAN)
  let budget = rowBudgets.get(row)
  if (budget === undefined) {
    budget = new Map<Element, number>()
    let used = 0
    for (const cell of Array.from(row.children)) {
      if (!isCell(cell)) continue
      const asked = readSpan(cell, 'colspan', MAX_COLSPAN)
      // At least one: see the note on MAX_TABLE_COLUMNS about not dropping cells.
      const granted = Math.max(1, Math.min(asked, MAX_TABLE_COLUMNS - used))
      budget.set(cell, granted)
      used += granted
    }
    rowBudgets.set(row, budget)
  }
  return budget.get(el) ?? readSpan(el, 'colspan', MAX_COLSPAN)
}

/**
 * Parse `colwidth` from the attribute the serializer writes.
 *
 * `prosemirror-tables` stores column widths as an array of numbers on the cell
 * that starts the column, which is how its resizing plugin reads them -- one
 * entry per column the cell covers, which is the invariant the commands in
 * `plugins-table` already document and rely on.
 *
 * The digits-only test and the length check are `prosemirror-tables`' own rules
 * for the same attribute, adopted rather than reinvented. They are stricter than
 * the `Number.isFinite` test they replace in the two ways that matter: a negative
 * width no longer survives to be written into `col.style.width`, and an array
 * that does not match `colspan` is rejected instead of being indexed past its
 * end. The ceiling is ours, for the same reason the span bounds exist.
 */
function readColwidth(el: Element, colspan: number): number[] | null {
  const attr = el.getAttribute('data-colwidth')
  if (!attr || !/^\d+(,\d+)*$/.test(attr)) return null
  const parsed = attr.split(',').map((n) => Number.parseInt(n, 10))
  if (parsed.length !== colspan) return null
  if (parsed.some((n) => n < 1 || n > MAX_COLWIDTH)) return null
  return parsed
}

const cellAttrs = {
  // These three names are required by prosemirror-tables.
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
  ...legacyDefaults(CELL_LEGACY_ATTRS),
  style: { default: null },
}

function cellGetAttrs(dom: Node): Record<string, unknown> {
  const el = dom as Element
  // Against the row's remaining budget, not just the per-cell ceiling: the sum
  // is what both consumers actually scale in. See MAX_TABLE_COLUMNS.
  const colspan = budgetedColspan(el)
  const attrs: Record<string, unknown> = {
    colspan,
    rowspan: readSpan(el, 'rowspan', MAX_ROWSPAN),
    // Read against the clamped colspan, not the attribute: the array has to
    // match the number of columns the cell actually claims.
    colwidth: readColwidth(el, colspan),
    ...readAttrs(el, CELL_LEGACY_ATTRS),
    style: readStyle(el, CELL_STYLE_PROPS),
  }
  // Fold CSS vertical-align into the HTML attribute the commands already edit,
  // so an inherited `style="vertical-align:middle"` is not a second, uneditable
  // spelling of the same fact.
  if (!attrs['valign']) {
    const fromStyle = safeVAlign(parseDeclarations(el.getAttribute('style')).get('vertical-align'))
    if (fromStyle) attrs['valign'] = fromStyle
  }
  return attrs
}

function styledElement(
  tag: string,
  attrs: Record<string, string>,
  style: string | null,
): DOMOutputSpec {
  const el = serializationTarget().createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  if (style) applyStyleAttribute(el, style)
  return { dom: el, contentDOM: el }
}

function cellToDOM(tag: 'td' | 'th') {
  return (node: { attrs: Record<string, unknown> }): DOMOutputSpec => {
    const attrs = writeAttrs(node.attrs, CELL_LEGACY_ATTRS)
    const colspan = node.attrs['colspan'] as number
    const rowspan = node.attrs['rowspan'] as number
    if (colspan !== 1) attrs['colspan'] = String(colspan)
    if (rowspan !== 1) attrs['rowspan'] = String(rowspan)
    const colwidth = node.attrs['colwidth'] as number[] | null
    if (colwidth) attrs['data-colwidth'] = colwidth.join(',')
    const style = node.attrs['style'] as string | null
    if (style) return styledElement(tag, attrs, style)
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

/**
 * `<thead>` and `<tfoot>`: recorded as row COUNTS, restored on serialization.
 *
 * The wrappers were skipped on parse and never written back, so every save
 * flattened a grouped table into one undifferentiated `<tbody>`. That is not a
 * cosmetic loss. `<thead>` is what makes a header repeat at the top of each page
 * when a long table is printed, it is the hook `position: sticky` header CSS and
 * every `thead th` selector in a site's stylesheet attach to, and it is the
 * structural cue that tells assistive technology which rows label the data.
 * Opening and saving an inherited document changed how the page rendered and
 * printed, in a way nothing in the editor showed.
 *
 * A count rather than a wrapper node, for the reason spelled out above
 * `readFurniture`: `prosemirror-tables` computes its cell map with
 * `height = table.childCount` and reads `table.child(row)` as a row, so a
 * `thead` node between the table and its rows would shift every coordinate the
 * library derives and break cell selection, column resizing and the row and
 * column commands. The rows stay direct children; only the knowledge of where
 * the groups were is stored beside them.
 *
 * Counted from the ends and only from the ends. A `<tfoot>` written before its
 * `<tbody>` -- required by HTML 4, still common in old content -- leaves rows
 * that are not trailing, so no footer is recorded and that table keeps today's
 * behaviour. The alternative is taking the last N rows regardless and moving
 * somebody's data into a `<tfoot>` it never belonged to, which is worse than the
 * loss it would be fixing.
 */
const tableSectionRows = new WeakMap<Element, { header: number; footer: number }>()

/**
 * Row counts for a `<table>` element this module rendered, or undefined.
 *
 * The serialization pass in html.ts needs to know how many of a table's rows
 * came out of a `<thead>`, and `toDOM` cannot tell it in the output: ProseMirror
 * allows exactly one `contentDOM`, so rows cannot flow into two sections. The
 * count therefore travels beside the DOM rather than inside it.
 *
 * Out of band for the same reason `preservedElements` is (see preserve.ts): a
 * `data-` attribute stripped after the fact cannot distinguish the attribute
 * this code just added from the identical attribute in a customer's document,
 * and deleting theirs is a worse bug than the one being fixed. A WeakMap cannot
 * collide with content and needs no cleanup pass.
 */
export function tableSectionRowCounts(el: Element): { header: number; footer: number } | undefined {
  return tableSectionRows.get(el)
}

/**
 * Count the rows a table's own `<thead>` and `<tfoot>` contribute.
 *
 * Direct children only, at both levels. `querySelectorAll` would attribute a
 * nested table's header to the outer table and lift the wrong rows on the way
 * out -- a nested table is the case where being off by a row is silent and
 * permanent.
 *
 * The rows are walked in the order the parser will see them, because that is the
 * order they will be in on the node. A `<thead>` that is not first, or a
 * `<tfoot>` that is not last, contributes nothing: the counts describe a leading
 * and a trailing run, and anything else cannot be expressed as one.
 */
function readSectionRows(el: Element): { header: number; footer: number } {
  const owners: string[] = []
  for (const child of Array.from(el.children)) {
    const name = child.nodeName.toLowerCase()
    if (name === 'tr') {
      owners.push('tbody')
      continue
    }
    if (name !== 'thead' && name !== 'tbody' && name !== 'tfoot') continue
    for (const row of Array.from(child.children)) {
      if (row.nodeName.toLowerCase() === 'tr') owners.push(name)
    }
  }
  let header = 0
  while (header < owners.length && owners[header] === 'thead') header += 1
  let footer = 0
  while (footer < owners.length - header && owners[owners.length - 1 - footer] === 'tfoot') {
    footer += 1
  }
  return { header, footer }
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
    headerRows: { default: 0 },
    footerRows: { default: 0 },
    style: { default: null },
  },
  parseDOM: [
    {
      tag: 'table',
      getAttrs: (dom) => {
        const sections = readSectionRows(dom as Element)
        return {
          ...readAttrs(dom as Element, TABLE_LEGACY_ATTRS),
          caption: readFurniture(dom as Element, ['caption']),
          colgroup: readFurniture(dom as Element, ['colgroup', 'col']),
          headerRows: sections.header,
          footerRows: sections.footer,
          style: readStyle(dom as Element, TABLE_STYLE_PROPS),
        }
      },
    },
    /*
     * `tbody`, `thead` and `tfoot` are SKIPPED rather than ignored: the wrapper
     * itself carries nothing, but its rows are the entire content. `ignore`
     * would delete the table's contents along with the wrapper.
     *
     * These rules also have to exist because the preservation layer's catch-all
     * would otherwise claim a `<tbody>` as unrecognised markup and produce an
     * opaque atom that `table_row+` refuses to accept.
     *
     * Skipping loses which group each row was in, which is why `headerRows` and
     * `footerRows` are counted separately in `getAttrs` and put back on the way
     * out. Attributes ON the wrapper -- a `<thead class="sticky">` -- are still
     * dropped; recording the grouping is the fidelity win worth having, and a
     * second residue channel for an element that is not a node is not.
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
     *
     * They are scoped with `context: 'table/'`. `DOMParser.fromSchema` flattens
     * every spec's parse rules into one list; a rule declared on `table` is
     * otherwise global. Unscoped `ignore` also fired for an orphaned
     * `<caption>` or `<col>` -- a fragment, a partial paste, a leftover after
     * the table was deleted -- and `ignore` takes the element's text with it.
     * Outside a table the preservation layer keeps the markup instead.
     */
    { tag: 'colgroup', ignore: true, context: 'table/' },
    { tag: 'col', ignore: true, context: 'table/' },
    { tag: 'caption', ignore: true, context: 'table/' },
  ],
  toDOM(node) {
    const attrs = writeAttrs(node.attrs, TABLE_LEGACY_ATTRS)
    const caption = node.attrs['caption'] as string | null
    const colgroup = node.attrs['colgroup'] as string | null
    const style = node.attrs['style'] as string | null
    const header = (node.attrs['headerRows'] as number) || 0
    const footer = (node.attrs['footerRows'] as number) || 0
    // A table with sections has to take the element path even when it has no
    // furniture: the row counts are keyed by the element, and the array path
    // never produces one to key them by.
    if (!caption && !colgroup && !style && !header && !footer) {
      return ['table', attrs, ['tbody', 0]]
    }

    /*
     * Furniture forces a real element rather than an output-spec array, because
     * an array cannot express "these children, then the content hole inside a
     * LATER child". `{ dom, contentDOM }` can, and ProseMirror accepts it from
     * both the editor's node renderer and DOMSerializer.
     */
    const doc = serializationTarget()
    const table = doc.createElement('table')
    for (const [name, value] of Object.entries(attrs)) table.setAttribute(name, value)
    if (style) applyStyleAttribute(table, style)

    // Document order is fixed by HTML: caption first, then colgroup, then rows.
    // Emitting them in any other order produces markup browsers reshuffle, which
    // would make the round-trip lossy again by a subtler route.
    if (caption) appendFurniture(table, caption, doc, !isSerializing())
    if (colgroup) appendFurniture(table, colgroup, doc, false)

    const tbody = doc.createElement('tbody')
    table.appendChild(tbody)
    /*
     * Every row goes into the one `<tbody>`, including the header rows, and the
     * split back into `<thead>`/`<tfoot>` happens after serialization in
     * html.ts. It cannot happen here: a node has exactly one `contentDOM`, so
     * there is no output spec that means "the first two rows here, the rest
     * there". This is also why the editor shows a grouped table as one body --
     * the grouping survives the save, it just is not visible while typing.
     */
    if (header || footer) tableSectionRows.set(table, { header, footer })
    return { dom: table, contentDOM: tbody }
  },
}

export const table_row: NodeSpec = {
  content: '(table_cell | table_header)*',
  tableRole: 'row',
  attrs: { ...legacyDefaults(ROW_ATTRS), style: { default: null } },
  parseDOM: [
    {
      tag: 'tr',
      getAttrs: (dom) => ({
        ...readAttrs(dom as Element, ROW_ATTRS),
        style: readStyle(dom as Element, ROW_STYLE_PROPS),
      }),
    },
  ],
  toDOM(node) {
    const attrs = writeAttrs(node.attrs, ROW_ATTRS)
    const style = node.attrs['style'] as string | null
    if (style) return styledElement('tr', attrs, style)
    return ['tr', attrs, 0]
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
