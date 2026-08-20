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
  parseFontShorthand,
  parseStyle,
  plainText,
  unwrap,
  wrapChildren,
  writeStyle,
} from './dom.js'

export function isBoldWeight(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'bold' || v === 'bolder') return true
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 600
}

/**
 * Tags that already say what a wrap would add.
 *
 * `<b style="font-weight:bold">` is not a bug in the source, it is a source
 * being explicit, and answering it with `<b><strong>` is noise.
 */
const ALREADY_SAID_BY: Record<string, readonly string[]> = {
  strong: ['STRONG', 'B'],
  em: ['EM', 'I'],
  u: ['U'],
  s: ['S', 'STRIKE'],
}

/**
 * Every spelling of a text decoration the source might have used.
 *
 * `text-decoration-line` is a plain longhand of `text-decoration`, and reading
 * only the shorthand means an underline written the other way is not promoted
 * to a tag and is then deleted with the rest of the styles -- the exact
 * content-loss this module's ordering rule exists to prevent, reintroduced
 * through a spelling the extractor did not know.
 */
function decorationOf(style: Map<string, string>): string {
  return [style.get('text-decoration'), style.get('text-decoration-line')]
    .filter((value) => value !== undefined)
    .join(' ')
}

/**
 * Promote meaningful inline styles to tags.
 *
 * Both Word and Google Docs express emphasis as CSS rather than as markup, and
 * Google additionally cancels boldness with an explicit `font-weight:normal`
 * on a real `<b>` element -- a trick that produces bold text everywhere if
 * taken literally.
 */
export function extractSemantics(container: Element, doc: Document): void {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const style = parseStyle(el)
    if (style.size === 0) continue

    // The `font` shorthand can carry weight and style in front of the size, so
    // longhands win where both are present and the shorthand fills the gap.
    const font = style.get('font')
    const shorthand = font === undefined ? {} : parseFontShorthand(font)
    const weight = style.get('font-weight') ?? shorthand.weight
    const italic = style.get('font-style') ?? shorthand.style
    const decoration = decorationOf(style)

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

    for (const tag of wraps) {
      if (ALREADY_SAID_BY[tag]?.includes(el.nodeName)) continue
      wrapChildren(el, tag, doc)
    }
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
export function stripAllStyles(container: Element): void {
  for (const el of Array.from(container.querySelectorAll('[style]'))) {
    writeStyle(el, new Map())
  }
}

/** Collapse `<span>` chains that no longer carry anything, innermost first. */
export function collapseBareSpans(container: Element): void {
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

/**
 * Remove elements that contain neither text nor any element at all.
 *
 * The test is deliberately inverted from the obvious one. Listing the children
 * that count as meaningful -- `img`, `br`, `table` and friends -- reads as
 * cautious and is the opposite: every element absent from the list becomes
 * grounds for deleting a block *and its contents*. That list left out `video`,
 * `audio`, `iframe`, `svg`, `object` and `embed`, so a paragraph holding an
 * embedded video, one of the most ordinary things in a Word or Google Doc,
 * was silently deleted along with the video.
 *
 * An unknown-but-present child is never grounds for deletion. What is left to
 * remove is what Word and Google leave behind once their bookkeeping elements
 * are gone: a genuinely empty wrapper.
 */
export function dropEmptyBlocks(container: Element, tags = ['p', 'span', 'div']): void {
  for (const tag of tags) {
    // Innermost first, so an empty wrapper inside an empty wrapper still takes
    // its parent with it once the child has gone.
    for (const el of Array.from(container.querySelectorAll(tag)).reverse()) {
      if (el.firstElementChild) continue
      if (plainText(el).trim() !== '') continue
      el.remove()
    }
  }
}
