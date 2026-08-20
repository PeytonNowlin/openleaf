/**
 * HTML in, HTML out.
 *
 * OpenLeaf's storage format is HTML, not a proprietary JSON document
 * model. A CMS that adopts OpenLeaf and later drops it should be left
 * with content it can still render, which rules out formats that require
 * our code to interpret.
 */

import { DOMParser, DOMSerializer, type Node as PMNode, type Schema } from 'prosemirror-model'
import { isInsidePreserved, withSerializationDocument } from './preserve.js'
import { coreSchema } from './extensions.js'
import { tableSectionRowCounts } from './tables.js'

/**
 * Parsers and serializers are resolved per schema rather than built once.
 *
 * `DOMSerializer.fromSchema` builds a map keyed by node NAME at construction, so
 * a serializer built from one schema throws `this.nodes[node.type.name] is not a
 * function` the moment it meets a node type a plugin added. Module-level
 * instances were therefore a hard ceiling on extensibility, not just an
 * optimisation.
 *
 * ProseMirror caches these on the schema object itself, so a WeakMap here is
 * belt-and-braces -- it costs nothing and makes the intent explicit.
 */
const parsers = new WeakMap<Schema, DOMParser>()
const serializers = new WeakMap<Schema, DOMSerializer>()

function parserFor(target: Schema): DOMParser {
  let found = parsers.get(target)
  if (!found) {
    found = DOMParser.fromSchema(target)
    parsers.set(target, found)
  }
  return found
}

function serializerFor(target: Schema): DOMSerializer {
  let found = serializers.get(target)
  if (!found) {
    found = DOMSerializer.fromSchema(target)
    serializers.set(target, found)
  }
  return found
}

export interface HtmlIOOptions {
  /** DOM implementation to use. Defaults to the global `document`. */
  document?: Document
  /** Schema to parse against. Defaults to the built-in one. */
  schema?: Schema
}

function resolveDocument(opts?: HtmlIOOptions): Document {
  const doc = opts?.document ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) {
    throw new Error(
      '@openleaf-editor/core: no Document available. Pass { document } when ' +
        'running outside a browser.',
    )
  }
  return doc
}

/** Parse an HTML string into an OpenLeaf document. */
export function parseHtml(html: string, opts?: HtmlIOOptions): PMNode {
  const doc = resolveDocument(opts)
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  return parserFor(opts?.schema ?? coreSchema()).parse(tpl.content, {
    preserveWhitespace: false,
  })
}

/**
 * Collapse `<td><p>text</p></td>` back to `<td>text</td>`.
 *
 * Table cells hold `block+` content, because real tables contain paragraphs and
 * lists. The consequence is that parsing the overwhelmingly common legacy form
 * `<td>text</td>` produces a cell containing a paragraph, and serializing it
 * back would write `<td><p>text</p></td>` -- rewriting every cell of every table
 * in a CMS the first time each post is opened and saved.
 *
 * That is a normalization rather than information loss, but "we changed every
 * table in your archive" is not a thing this project gets to do quietly. So a
 * cell holding exactly one attribute-free paragraph is unwrapped on the way out.
 *
 * The asymmetry is deliberate and worth stating: a cell that was authored as
 * `<td><p>text</p></td>` also comes back as `<td>text</td>`. That form is rare
 * in the content this editor inherits, and the alternative is rewriting the
 * common case instead of the rare one.
 */
function unwrapSoleCellParagraph(host: Element): void {
  for (const cell of Array.from(host.querySelectorAll('td, th'))) {
    // Never reach inside preserved markup. A table nested in an unrecognised
    // wrapper is content we undertook to return byte-identical, and a
    // normalization that is right for our own tables is a broken promise there.
    if (isInsidePreserved(cell)) continue
    if (cell.childElementCount !== 1) continue
    const only = cell.firstElementChild
    if (!only || only.nodeName !== 'P' || only.attributes.length > 0) continue
    // Only when the paragraph is the cell's entire content; a stray text node
    // beside it means the markup is doing something we should not touch.
    if (cell.childNodes.length !== 1) continue
    while (only.firstChild) cell.insertBefore(only.firstChild, only)
    cell.removeChild(only)
  }
}

/**
 * Put a table's rows back into the `<thead>` and `<tfoot>` they came from.
 *
 * A table node holds nothing but rows -- `prosemirror-tables` requires that, see
 * tables.ts -- and a node renders through a single `contentDOM`, so `toDOM` can
 * emit one section and no more. The grouping is therefore restored here, from
 * the row counts tables.ts recorded against the element it built.
 *
 * Only for tables that HAD a section. Deriving a `<thead>` from the presence of
 * `<th>` cells would look like an improvement and would rewrite every table in
 * an archive that never used one, which is the change `unwrapSoleCellParagraph`
 * argues at length this project does not get to make quietly.
 *
 * The counts are clamped rather than trusted, because the document can have
 * changed since it was parsed: an author who deletes the header row of a table
 * whose node still says `headerRows: 1` gets a table with one fewer section, not
 * a `<thead>` built out of their first data row and not a thrown error. The
 * `<tbody>` goes away entirely if every row left it, so a table that was all
 * `<thead>` does not come back with an empty body it never had.
 */
function restoreTableSections(host: Element, doc: Document): void {
  for (const table of Array.from(host.querySelectorAll('table'))) {
    // Same rule as the cell pass: a table inside preserved markup is content we
    // undertook to hand back byte-identical, and its sections are already in the
    // preserved string. Restructuring there would be a broken promise.
    if (isInsidePreserved(table)) continue
    const counts = tableSectionRowCounts(table)
    if (!counts) continue
    const tbody = Array.from(table.children).find((child) => child.nodeName === 'TBODY')
    if (!tbody) continue
    const rows = Array.from(tbody.children).filter((child) => child.nodeName === 'TR')
    const header = Math.min(counts.header, rows.length)
    const footer = Math.min(counts.footer, rows.length - header)
    if (header > 0) {
      const thead = doc.createElement('thead')
      for (const row of rows.slice(0, header)) thead.appendChild(row)
      table.insertBefore(thead, tbody)
    }
    if (footer > 0) {
      const tfoot = doc.createElement('tfoot')
      for (const row of rows.slice(rows.length - footer)) tfoot.appendChild(row)
      table.insertBefore(tfoot, tbody.nextSibling)
    }
    if (!tbody.hasChildNodes()) table.removeChild(tbody)
  }
}

/** Serialize an OpenLeaf document back to an HTML string. */
export function serializeHtml(node: PMNode, opts?: HtmlIOOptions): string {
  const doc = resolveDocument(opts)
  return withSerializationDocument(doc, () => {
    // Taken from the document itself, so a document built on an extended schema
    // serializes with a serializer that knows its node types. Passing the wrong
    // schema explicitly is still possible, but the default is now correct.
    const target = opts?.schema ?? node.type.schema
    const fragment = serializerFor(target).serializeFragment(node.content, { document: doc })
    const host = doc.createElement('div')
    host.appendChild(fragment)
    unwrapSoleCellParagraph(host)
    restoreTableSections(host, doc)
    return host.innerHTML
  })
}

/** Convenience: one full parse/serialize cycle. */
export function roundTrip(html: string, opts?: HtmlIOOptions): string {
  return serializeHtml(parseHtml(html, opts), opts)
}
