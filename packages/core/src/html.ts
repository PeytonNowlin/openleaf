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
  tpl.innerHTML = html
  assertDepthWithin(tpl.content, MAX_PARSE_DEPTH)
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
    unwrapSoleCellParagraph(host)
    return host.innerHTML
  })
}

/** Convenience: one full parse/serialize cycle. */
export function roundTrip(html: string, opts?: HtmlIOOptions): string {
  return serializeHtml(parseHtml(html, opts), opts)
}
