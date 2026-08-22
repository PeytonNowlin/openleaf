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
import { OpenLeafError } from './errors.js'
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
    throw new OpenLeafError(
      'no-document',
      '@openleaf-editor/core: no Document available. Pass { document } when ' +
        'running outside a browser.',
    )
  }
  return doc
}

/**
 * How deep a parsed tree may nest.
 *
 * ProseMirror's DOM parser recurses once per element, and so does the serializer
 * on the way back, so a document deep enough overflows the JavaScript stack
 * before either finishes. Measured on Node 26 at the default stack size:
 * `'<div>'.repeat(5000)` -- 30 KB of markup -- throws `RangeError: Maximum call
 * stack size exceeded`, while a 2 MB *flat* document parses without complaint.
 * Depth is the problem, not size, which is what makes it reachable by an
 * attacker with a small payload.
 *
 * 500 is far above anything authored and far below where any engine gives out.
 * The deepest structure real content produces is quoted email, and that runs to
 * tens of levels, not hundreds.
 */
export const MAX_PARSE_DEPTH = 500

/**
 * Reject over-deep input before the recursive parse meets it.
 *
 * An explicit stack, so measuring the depth cannot itself overflow. Two parallel
 * arrays rather than an array of pairs: a 2 MB document has ~110,000 elements
 * and the object churn was measurable where two number pushes are not.
 */
function assertDepthWithin(root: ParentNode, limit: number): void {
  const nodes: Element[] = []
  const depths: number[] = []
  for (const child of Array.from(root.children)) {
    nodes.push(child)
    depths.push(1)
  }
  while (nodes.length > 0) {
    const node = nodes.pop() as Element
    const depth = depths.pop() as number
    if (depth > limit) {
      throw new OpenLeafError(
        'depth-limit',
        `@openleaf-editor/core: HTML nests more than ${limit} elements deep. Parsing it ` +
          'recurses once per level and would overflow the stack. This is almost always ' +
          'adversarial input rather than a document somebody wrote.',
      )
    }
    for (const child of Array.from(node.children)) {
      nodes.push(child)
      depths.push(depth + 1)
    }
  }
}

/**
 * Parse an HTML string into an OpenLeaf document.
 *
 * Throws `OpenLeafError` with code `invalid-argument` for a non-string, and
 * `depth-limit` for input nested past {@link MAX_PARSE_DEPTH}. It used to coerce
 * anything at all -- `parseHtml(42)` returned an empty document -- which turned
 * a caller's type error into silent content loss.
 */
export function parseHtml(html: string, opts?: HtmlIOOptions): PMNode {
  if (typeof html !== 'string') {
    throw new OpenLeafError(
      'invalid-argument',
      `@openleaf-editor/core: parseHtml expects an HTML string, received ${typeof html}.`,
    )
  }
  const doc = resolveDocument(opts)
  const tpl = doc.createElement('template')
  // The DOM parser is itself recursive and gives out at around 20,000 levels,
  // which is *before* the depth check below could run. Its `RangeError` says
  // nothing about what happened or which call caused it, so it is converted
  // rather than allowed to escape.
  try {
    tpl.innerHTML = html
  } catch (error) {
    throw new OpenLeafError(
      'depth-limit',
      '@openleaf-editor/core: the HTML could not be parsed -- it is nested too deeply, or too ' +
        'large, for this DOM implementation to handle.',
      { cause: error },
    )
  }
  assertDepthWithin(tpl.content, MAX_PARSE_DEPTH)
  return parserFor(opts?.schema ?? coreSchema()).parse(tpl.content, {
    preserveWhitespace: false,
  })
}

/**
 * Collapse a sole attribute-free `<p>` back to its container's direct children.
 *
 * Several containers hold block content (`table_cell` is `block+`, `list_item`
 * is `paragraph block*`, `blockquote` is `block+`, `details` is `summary
 * block+`). Parsing the overwhelmingly common legacy form -- `<td>text</td>`,
 * `<li>text</li>`, `<blockquote>quoted</blockquote>`, a details body that is
 * just text -- therefore produces a paragraph, and serializing it back would
 * write the wrapper into every list, quote, disclosure and table in a CMS the
 * first time each post is opened and saved.
 *
 * That is a normalization rather than information loss, but "we changed every
 * list in your archive" is not a thing this project gets to do quietly. So a
 * container whose modelled content is exactly one attribute-free paragraph is
 * unwrapped on the way out. For `<details>` that means the body after
 * `<summary>`, not the whole element.
 *
 * The same rule as cells still applies to mixed content: `<li>a<ul><li>b</li>
 * </ul></li>` parses to a paragraph plus a nested list, so the outer paragraph
 * stays. The inner item is a sole paragraph and unwraps.
 *
 * The asymmetry is deliberate and worth stating: a container that was authored
 * as `<li><p>text</p></li>` also comes back as `<li>text</li>`. That form is
 * rare in the content this editor inherits, and the alternative is rewriting
 * the common case instead of the rare one.
 */
function unwrapSoleParagraph(host: Element): void {
  for (const container of Array.from(host.querySelectorAll('td, th, li, blockquote, details'))) {
    // Never reach inside preserved markup. A list nested in an unrecognised
    // wrapper is content we undertook to return byte-identical, and a
    // normalization that is right for our own nodes is a broken promise there.
    if (isInsidePreserved(container)) continue
    const only = soleAttributeFreeParagraph(container)
    if (!only) continue
    while (only.firstChild) container.insertBefore(only.firstChild, only)
    container.removeChild(only)
  }
}

/**
 * The paragraph this pass is allowed to unwrap, or null.
 *
 * `details` always has a `<summary>` sibling, so "entire content is one `<p>`"
 * would never fire there. Everything else uses the cell rule: one child node,
 * and it is an attribute-free `<p>`.
 */
function soleAttributeFreeParagraph(container: Element): Element | null {
  const candidates =
    container.nodeName === 'DETAILS'
      ? Array.from(container.childNodes).filter(
          (node) => !(node.nodeType === 1 && (node as Element).nodeName === 'SUMMARY'),
        )
      : Array.from(container.childNodes)
  if (candidates.length !== 1) return null
  const only = candidates[0]
  if (!only || only.nodeType !== 1) return null
  const el = only as Element
  if (el.nodeName !== 'P' || el.attributes.length > 0) return null
  return el
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
 * an archive that never used one, which is the change `unwrapSoleParagraph`
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

/**
 * Serialize an OpenLeaf document back to an HTML string.
 *
 * Throws `OpenLeafError` with code `invalid-argument` for anything that is not a
 * ProseMirror node. `serializeHtml(null)` used to surface a raw
 * `TypeError: Cannot read properties of null (reading 'type')` from inside
 * ProseMirror, with nothing in it naming OpenLeaf or the call that was wrong.
 */
export function serializeHtml(node: PMNode, opts?: HtmlIOOptions): string {
  if (node === null || typeof node !== 'object' || !('type' in node) || !('content' in node)) {
    throw new OpenLeafError(
      'invalid-argument',
      '@openleaf-editor/core: serializeHtml expects a ProseMirror node, such as ' +
        '`view.state.doc`.',
    )
  }
  const doc = resolveDocument(opts)
  return withSerializationDocument(doc, () => {
    // Taken from the document itself, so a document built on an extended schema
    // serializes with a serializer that knows its node types. Passing the wrong
    // schema explicitly is still possible, but the default is now correct.
    const target = opts?.schema ?? node.type.schema
    const fragment = serializerFor(target).serializeFragment(node.content, { document: doc })
    const host = doc.createElement('div')
    host.appendChild(fragment)
    unwrapSoleParagraph(host)
    restoreTableSections(host, doc)
    return host.innerHTML
  })
}

/** Convenience: one full parse/serialize cycle. */
export function roundTrip(html: string, opts?: HtmlIOOptions): string {
  return serializeHtml(parseHtml(html, opts), opts)
}
