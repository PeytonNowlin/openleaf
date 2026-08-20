/**
 * Cleanup passes shared by every normalizer.
 *
 * The ordering rule these encode, and the one thing to remember about paste
 * handling: **convert styling that carries meaning into semantic tags BEFORE
 * stripping styles.** Strip first and the document silently loses every bold
 * and italic run in it, which is a content-loss bug that looks like a styling
 * bug and therefore gets triaged as cosmetic.
 */

import {
  isBareSpan,
  parseStyle,
  plainText,
  unwrap,
  wrapChildren,
  writeStyle,
  type Container,
} from './dom.js'

export function isBoldWeight(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'bold' || v === 'bolder') return true
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 600
}

/**
 * Promote meaningful inline styles to tags.
 *
 * Both Word and Google Docs express emphasis as CSS rather than as markup, and
 * Google additionally cancels boldness with an explicit `font-weight:normal`
 * on a real `<b>` element -- a trick that produces bold text everywhere if
 * taken literally.
 */
export function extractSemantics(container: Container, doc: Document): void {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const style = parseStyle(el)
    if (style.size === 0) continue

    const weight = style.get('font-weight')
    const italic = style.get('font-style')
    const decoration = style.get('text-decoration') ?? ''

    if ((el.nodeName === 'B' || el.nodeName === 'STRONG') && weight && !isBoldWeight(weight)) {
      // Google Docs wraps whole documents in <b style="font-weight:normal">.
      // Honour the cancellation instead of bolding the entire paste.
      unwrap(el)
      continue
    }
    if ((el.nodeName === 'I' || el.nodeName === 'EM') && italic === 'normal') {
      unwrap(el)
      continue
    }

    const wraps: string[] = []
    if (weight && isBoldWeight(weight)) wraps.push('strong')
    if (italic === 'italic' || italic === 'oblique') wraps.push('em')
    if (/\bunderline\b/.test(decoration)) wraps.push('u')
    if (/\bline-through\b/.test(decoration)) wraps.push('s')

    for (const tag of wraps) wrapChildren(el, tag, doc)
  }
}

/**
 * Remove every style declaration.
 *
 * Deliberately total rather than selective. A paste is the one moment where
 * the user has explicitly asked for the source's appearance NOT to come along,
 * and a partial allowlist here is how `line-height:1.38` ends up in a
 * database. Anything worth keeping should have been promoted to a tag by
 * `extractSemantics` first.
 */
export function stripAllStyles(container: Container): void {
  for (const el of Array.from(container.querySelectorAll('[style]'))) {
    writeStyle(el, new Map())
  }
}

/** Collapse `<span>` chains that no longer carry anything, innermost first. */
export function collapseBareSpans(container: Container): void {
  let changed = true
  while (changed) {
    changed = false
    for (const span of Array.from(container.querySelectorAll('span'))) {
      if (isBareSpan(span)) {
        unwrap(span)
        changed = true
      }
    }
  }
}

/** Remove elements that contain neither text nor meaningful children. */
export function dropEmptyBlocks(container: Container, tags = ['p', 'span', 'div']): void {
  for (const tag of tags) {
    for (const el of Array.from(container.querySelectorAll(tag))) {
      const hasMeaning = el.querySelector('img,br,hr,table,ul,ol,input')
      if (!hasMeaning && plainText(el).trim() === '') el.remove()
    }
  }
}
