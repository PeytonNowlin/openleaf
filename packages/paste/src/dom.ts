/**
 * Small DOM helpers shared by the normalizers.
 *
 * These operate on a live DOM rather than on strings. Regex-based HTML
 * rewriting is how paste handlers acquire their reputation: Word's output
 * nests attributes containing angle brackets and quoted CSS with escaped
 * quotes, and any regex that appears to work on a sample will corrupt a real
 * document eventually. The browser already has a correct parser.
 */

export function resolveDocument(explicit?: Document): Document {
  const doc = explicit ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) {
    throw new Error(
      '@openleaf-editor/paste: no Document available. Pass { document } when running ' +
        'outside a browser.',
    )
  }
  return doc
}

/**
 * Anything the cleanup passes can walk: a real element, or the inert fragment
 * a paste is parsed into. Both satisfy the `ParentNode` surface the passes use
 * -- `querySelectorAll`, `children`, `insertBefore` -- so nothing below has to
 * care which it was handed.
 */
export type Container = Element | DocumentFragment

/**
 * A parsed paste and the inert document that owns it.
 *
 * The two travel together deliberately. Keeping the nodes inert is not just a
 * property of where they were parsed -- it is a property that every later step
 * has to preserve, and the commonest way to break it is to build a new element
 * with the *live* `document` and move untrusted children into it. So the
 * document to create nodes with is handed out alongside the nodes themselves,
 * and no normalizer needs to remember which of the two it is holding.
 */
export interface InertFragment {
  /** The parsed nodes. Mutate them in place; never move them out. */
  readonly root: DocumentFragment
  /** The inert document that owns them. Create every new node with this. */
  readonly doc: Document
}

/**
 * Parse untrusted clipboard HTML into an **inert** fragment.
 *
 * `<template>` is used for two separate reasons, and only one of them is about
 * fragment legality.
 *
 * The first is that `<template>` permits otherwise-illegal fragments: a bare
 * `<tr>` or `<td>` from an Excel or Word clipboard is silently discarded by
 * `innerHTML` on a `<div>`, because the HTML fragment parsing algorithm applies
 * the context element's insertion mode. A template's content has no such
 * context and keeps them.
 *
 * The second is security, and it is why this hands back the fragment rather
 * than a host element. `tpl.content` belongs to the *template contents owner
 * document* -- a document with no browsing context, where images do not load
 * and `on*` content attributes are never compiled into handlers. Moving those
 * nodes anywhere in the live document adopts them across that boundary, and the
 * browser starts the fetch and compiles the handler at that instant, long
 * before any cleanup pass gets a chance to strip the attribute. Building a
 * `<div>` from the live document and appending `tpl.content` to it is exactly
 * that move, and it is what this function used to do.
 *
 * So the nodes never leave: the passes mutate the fragment in place, anything
 * new is created with {@link InertFragment.doc}, and
 * {@link serializeFragment} reads the result back out without ever touching a
 * live node.
 *
 * See `@openleaf-editor/core`'s `parseHtml`, which parses into `tpl.content`
 * and hands that straight to ProseMirror for the same reason.
 */
export function parseFragment(html: string, doc: Document): InertFragment {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content
  const owner = root.ownerDocument
  // Never reachable against a conforming DOM -- a template's content always has
  // an owner. It throws rather than falling back to `doc`, because the fallback
  // would be the live document and would silently restore the bug this whole
  // function exists to prevent.
  if (!owner) {
    throw new Error(
      '@openleaf-editor/paste: template content has no owner document; refusing to ' +
        'parse untrusted HTML against the live one.',
    )
  }
  return { root, doc: owner }
}

/**
 * Serialize an inert fragment back to a string, without adopting it.
 *
 * The obvious implementation -- append into a `<div>` and read `innerHTML` --
 * is the bug {@link parseFragment} exists to avoid. A `<template>` created from
 * the inert document has its content in that same document, so moving the
 * fragment into it is a same-document move that starts nothing, and a
 * template's `innerHTML` getter serializes its content.
 *
 * The fragment is emptied by this call. Callers are done with it by then.
 */
export function serializeFragment(fragment: InertFragment): string {
  const tpl = fragment.doc.createElement('template')
  tpl.content.appendChild(fragment.root)
  return tpl.innerHTML
}

/** Replace an element with its own children, keeping order. */
export function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

/** Remove every comment node in the tree. */
export function stripComments(root: Node): void {
  const doomed: Comment[] = []
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) doomed.push(child as Comment)
      else walk(child)
    }
  }
  walk(root)
  for (const c of doomed) c.parentNode?.removeChild(c)
}

/** Parse a `style` attribute into a lowercase-keyed map. */
export function parseStyle(el: Element): Map<string, string> {
  const out = new Map<string, string>()
  const raw = el.getAttribute('style')
  if (!raw) return out
  // Split on semicolons that are not inside quotes -- Word writes values like
  // `font:7.0pt "Times New Roman"` which contain no semicolons, but
  // `font-family` lists can, and splitting naively mangles them.
  let depth: '"' | "'" | null = null
  let current = ''
  const decls: string[] = []
  for (const ch of raw) {
    if (depth) {
      if (ch === depth) depth = null
      current += ch
    } else if (ch === '"' || ch === "'") {
      depth = ch
      current += ch
    } else if (ch === ';') {
      decls.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  decls.push(current)

  for (const decl of decls) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const name = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (name) out.set(name, value)
  }
  return out
}

/** Serialize a style map back, or remove the attribute when empty. */
export function writeStyle(el: Element, style: Map<string, string>): void {
  if (style.size === 0) {
    el.removeAttribute('style')
    return
  }
  el.setAttribute(
    'style',
    [...style].map(([k, v]) => `${k}:${v}`).join(';'),
  )
}

/**
 * Wrap an element's children in a new element of `tag`.
 *
 * `doc` must be the fragment's own inert document, not the live one. The
 * children are moved into the wrapper before the wrapper is put back, so a
 * wrapper built from the live document would adopt every one of them into it
 * on the way past -- the same boundary crossing {@link parseFragment} exists to
 * prevent, just spelled differently.
 */
export function wrapChildren(el: Element, tag: string, doc: Document): Element {
  const wrapper = doc.createElement(tag)
  while (el.firstChild) wrapper.appendChild(el.firstChild)
  el.appendChild(wrapper)
  return wrapper
}

/** True when the element has no attributes and no meaning of its own. */
export function isBareSpan(el: Element): boolean {
  return el.nodeName === 'SPAN' && el.attributes.length === 0
}

/** Text content with non-breaking spaces normalized. */
export function plainText(node: Node): string {
  return (node.textContent ?? '').replace(/\u00a0/g, ' ')
}
