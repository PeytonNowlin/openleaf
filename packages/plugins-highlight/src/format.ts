/**
 * An HTML pretty-printer for the source view.
 *
 * The editor serializes to one long line -- `<h2>x</h2><p>y</p><ul><li>...` --
 * which is correct output and unreadable source. Indenting it is arguably worth
 * more than colouring it.
 *
 * ## Three rules, each established by measurement
 *
 * 1. **Whitespace between block elements is insignificant.** Verified: a
 *    pretty-printed document and its minified form parse to byte-identical
 *    output. That is what makes reformatting for display possible at all.
 *
 * 2. **Whitespace inside `<pre>` is content.** Also verified -- reindenting
 *    `<pre><code>line one\n  indented\n</code></pre>` added two leading spaces
 *    to the first line and a trailing newline.
 *
 * 3. **Whitespace inside a block's inline content is significant.** A newline
 *    before `<strong>` in `<p>a<strong>b</strong>c</p>` turns `abc` into
 *    `a b c`. So a block containing only inline content stays on one line.
 *
 * ## Why this walks a DOM rather than scanning the string
 *
 * The first attempt was a regex scanner and it broke on four of the nine real
 * fidelity fixtures, all for the same reason: **it could not tell schema-native
 * structure from preserved markup.** An unrecognised wrapper such as
 * `<div class="callout">` is captured verbatim by the preservation layer, so
 * reindenting its interior changes the stored document. A tag name alone cannot
 * distinguish the two -- `<div>` may be either -- but the element tree can, by
 * only ever formatting the block elements the schema itself emits and copying
 * everything else byte for byte.
 *
 * Even so, nothing here is trusted: `formatIfLossless` in `source.ts` only uses
 * the result after proving it parses to the same document.
 */

/**
 * The only elements this will reformat: the block structure OpenLeaf's own
 * schema produces. Everything else is somebody else's markup, copied verbatim.
 */
const FORMATTABLE: ReadonlySet<string> = new Set([
  'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p',
  'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
])

/** Formattable elements that are nonetheless copied whole: their text is content. */
const VERBATIM: ReadonlySet<string> = new Set(['pre', 'textarea', 'script', 'style'])

export interface FormatOptions {
  /** Spaces per level. */
  indent?: number
  /** DOM implementation. Defaults to the global `document`. */
  document?: Document
}

function resolveDocument(explicit?: Document): Document {
  const doc = explicit ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) throw new Error('@openleaf-editor/plugins-highlight: no Document available')
  return doc
}

/**
 * True when this element's children include block structure worth indenting.
 *
 * A `<p>` full of text and `<strong>` is left alone; a `<ul>` full of `<li>` is
 * broken open. This is the check that keeps rule 3.
 */
function hasBlockChildren(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (FORMATTABLE.has(child.nodeName.toLowerCase())) return true
  }
  return false
}

/**
 * Is this element safe to reformat?
 *
 * A formattable tag whose attributes the schema does not model is preserved
 * markup -- `<div class="callout">` -- and its interior must not be touched. A
 * bare `<div>` never appears in the editor's own output because it unwraps on
 * parse, so refusing to format any attributed `div` costs nothing real.
 */
function isOwnStructure(el: Element): boolean {
  const name = el.nodeName.toLowerCase()
  if (!FORMATTABLE.has(name)) return false
  if (VERBATIM.has(name)) return false
  if (name === 'div') return el.attributes.length === 0
  return true
}

function openTag(el: Element): string {
  const html = el.outerHTML
  const end = html.indexOf('>')
  return end === -1 ? html : html.slice(0, end + 1)
}

export function formatHtml(html: string, options: FormatOptions = {}): string {
  const doc = resolveDocument(options.document)
  const width = options.indent ?? 2
  const template = doc.createElement('template')
  template.innerHTML = html

  const lines: string[] = []
  const pad = (depth: number): string => ' '.repeat(depth * width)

  const walk = (nodes: Iterable<ChildNode>, depth: number): void => {
    for (const node of Array.from(nodes)) {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').trim()
        if (text !== '') lines.push(pad(depth) + text)
        continue
      }
      if (node.nodeType === 8) {
        lines.push(pad(depth) + `<!--${(node as Comment).data}-->`)
        continue
      }
      if (node.nodeType !== 1) continue

      const el = node as Element
      if (!isOwnStructure(el) || !hasBlockChildren(el)) {
        // Copied whole: either it is not ours to reformat, or it holds only
        // inline content and breaking it would insert spaces into the text.
        lines.push(pad(depth) + el.outerHTML)
        continue
      }

      lines.push(pad(depth) + openTag(el))
      walk(el.childNodes, depth + 1)
      lines.push(pad(depth) + `</${el.nodeName.toLowerCase()}>`)
    }
  }

  walk(template.content.childNodes, 0)
  return lines.join('\n')
}

/**
 * Collapse whitespace between tags.
 *
 * Only used for comparisons; the editor re-parses whatever the author leaves in
 * the box, so this never decides what is stored.
 */
export function collapseWhitespaceBetweenTags(html: string): string {
  return html.replace(/>\s+</g, '><').trim()
}
