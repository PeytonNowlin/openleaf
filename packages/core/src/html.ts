/**
 * HTML in, HTML out.
 *
 * OpenLeaf's storage format is HTML, not a proprietary JSON document
 * model. A CMS that adopts OpenLeaf and later drops it should be left
 * with content it can still render, which rules out formats that require
 * our code to interpret.
 */

import { DOMParser, DOMSerializer, type Node as PMNode, type Schema } from 'prosemirror-model'
import { schema as defaultSchema } from './schema.js'

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
      '@openleaf/core: no Document available. Pass { document } when ' +
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
  return parserFor(opts?.schema ?? defaultSchema).parse(tpl.content, {
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

/** Serialize an OpenLeaf document back to an HTML string. */
export function serializeHtml(node: PMNode, opts?: HtmlIOOptions): string {
  const doc = resolveDocument(opts)
  // Taken from the document itself, so a document built on an extended schema
  // serializes with a serializer that knows its node types. Passing the wrong
  // schema explicitly is still possible, but the default is now correct.
  const target = opts?.schema ?? node.type.schema
  const fragment = serializerFor(target).serializeFragment(node.content, { document: doc })
  const host = doc.createElement('div')
  host.appendChild(fragment)
  unwrapSoleCellParagraph(host)
  return host.innerHTML
}

/** Convenience: one full parse/serialize cycle. */
export function roundTrip(html: string, opts?: HtmlIOOptions): string {
  return serializeHtml(parseHtml(html, opts), opts)
}
