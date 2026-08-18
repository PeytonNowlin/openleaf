/**
 * HTML in, HTML out.
 *
 * Openleaf's storage format is HTML, not a proprietary JSON document
 * model. A CMS that adopts Openleaf and later drops it should be left
 * with content it can still render, which rules out formats that require
 * our code to interpret.
 */

import { DOMParser, DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import { schema } from './schema.js'

const parser = DOMParser.fromSchema(schema)
const serializer = DOMSerializer.fromSchema(schema)

export interface HtmlIOOptions {
  /** DOM implementation to use. Defaults to the global `document`. */
  document?: Document
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

/** Parse an HTML string into an Openleaf document. */
export function parseHtml(html: string, opts?: HtmlIOOptions): PMNode {
  const doc = resolveDocument(opts)
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  return parser.parse(tpl.content, { preserveWhitespace: false })
}

/** Serialize an Openleaf document back to an HTML string. */
export function serializeHtml(node: PMNode, opts?: HtmlIOOptions): string {
  const doc = resolveDocument(opts)
  const fragment = serializer.serializeFragment(node.content, { document: doc })
  const host = doc.createElement('div')
  host.appendChild(fragment)
  return host.innerHTML
}

/** Convenience: one full parse/serialize cycle. */
export function roundTrip(html: string, opts?: HtmlIOOptions): string {
  return serializeHtml(parseHtml(html, opts), opts)
}
