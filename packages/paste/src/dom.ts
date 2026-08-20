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

/**
 * Split a `style` attribute on the semicolons that actually separate
 * declarations.
 *
 * Three things are not separators: a semicolon inside a quoted value, a
 * semicolon inside a CSS comment, and a quote character that has been
 * backslash-escaped inside a quoted value. Word writes values like
 * `font:7.0pt "Times New Roman"` which contain none of them, but a naive split
 * mangles `font-family` lists, and getting `content:"a\";b"` wrong silently
 * turns one declaration into two nonsense ones.
 */
function splitDeclarations(raw: string): string[] {
  const decls: string[] = []
  let quote: '"' | "'" | null = null
  let current = ''

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (quote) {
      if (ch === '\\' && i + 1 < raw.length) {
        // An escaped character is never a closing quote, whatever it is.
        current += ch + raw[i + 1]!
        i += 1
        continue
      }
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)
      i = end < 0 ? raw.length : end + 1
      continue
    }
    if (ch === ';') {
      decls.push(current)
      current = ''
      continue
    }
    current += ch
  }
  decls.push(current)
  return decls
}

/** Parse a `style` attribute into a lowercase-keyed map. */
export function parseStyle(el: Element): Map<string, string> {
  const out = new Map<string, string>()
  const raw = el.getAttribute('style')
  if (!raw) return out

  for (const decl of splitDeclarations(raw)) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const name = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (name) out.set(name, value)
  }
  return out
}

/** A `<font-size>`, which is where the `font` shorthand's prefix ends. */
const FONT_SIZE_TOKEN =
  /^(?:[0-9.]+(?:px|pt|em|rem|ex|ch|%|vw|vh|vmin|vmax|cm|mm|q|in|pc)?|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)\b/

/**
 * Read weight and style out of the `font` shorthand.
 *
 * The shorthand is `[ style || variant || weight || stretch ]? size [ /
 * line-height ]? family`, so emphasis can hide in front of the size -- and it
 * does: `font:bold 12px Arial` is bold text whose boldness is invisible to a
 * normalizer that only reads `font-weight`. Word emits the shorthand routinely
 * (`font:7.0pt "Times New Roman"`), which is why the scan stops at the size
 * rather than searching the whole value: a family called `Bold Type` is not a
 * weight, and `7.0pt` is not one either.
 */
export function parseFontShorthand(value: string): { weight?: string; style?: string } {
  const out: { weight?: string; style?: string } = {}
  for (const token of value.trim().split(/\s+/)) {
    const t = token.toLowerCase()
    // A bare hundred is a weight: a font-size needs a unit unless it is `0`.
    if (/^[1-9]00$/.test(t)) {
      out.weight = t
      continue
    }
    if (FONT_SIZE_TOKEN.test(t)) break
    if (t === 'italic' || t === 'oblique') out.style = t
    else if (t === 'bold' || t === 'bolder' || t === 'lighter') out.weight = t
    else if (t !== 'normal' && t !== 'small-caps') break
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
