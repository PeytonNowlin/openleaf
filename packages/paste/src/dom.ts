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

/** Parse a fragment. `<template>` permits otherwise-illegal fragments. */
export function parseFragment(html: string, doc: Document): HTMLElement {
  const host = doc.createElement('div')
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  host.appendChild(tpl.content)
  return host
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

/** Wrap an element's children in a new element of `tag`. */
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
