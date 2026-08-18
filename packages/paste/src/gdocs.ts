/**
 * Google Docs paste normalizer.
 *
 * Google's clipboard HTML is structurally sane -- real `<p>`, `<h2>`, `<ul>`,
 * `<li>` -- but it expresses every piece of emphasis as CSS on a `<span>`, and
 * wraps the entire document in a booby trap:
 *
 *   <b style="font-weight:normal" id="docs-internal-guid-...">
 *
 * A `<b>` that is explicitly not bold. Any normalizer that trusts tag names
 * over styles turns the whole paste bold; any normalizer that strips styles
 * before reading them turns it bold too, because then only the `<b>` survives.
 * The cancellation has to be honoured, and it is handled in `extractSemantics`.
 *
 * The other trap is underline. Google decorates the `<span>` inside every
 * link with `text-decoration:underline`, which is redundant -- links are
 * underlined already -- and would otherwise produce `<u>` inside every `<a>`
 * in the pasted document.
 */

import {
  collapseBareSpans,
  dropEmptyBlocks,
  extractSemantics,
  isBoldWeight,
  stripAllStyles,
} from './clean.js'
import { parseFragment, parseStyle, resolveDocument, stripComments, unwrap, writeStyle } from './dom.js'

/** True when this HTML came from Google Docs, Sheets or Slides. */
export function looksLikeGoogleDocs(html: string): boolean {
  return /docs-internal-guid|id="docs-internal|google-sheets-html-origin/i.test(html)
}

/**
 * Drop `text-decoration:underline` on anything inside a link, so the
 * redundant `<u>` is never created in the first place.
 */
function dropRedundantLinkUnderlines(container: Element): void {
  for (const anchor of Array.from(container.querySelectorAll('a'))) {
    for (const el of [anchor, ...Array.from(anchor.querySelectorAll('*'))]) {
      const style = parseStyle(el)
      const decoration = style.get('text-decoration')
      if (decoration && /\bunderline\b/.test(decoration)) {
        const rest = decoration.replace(/\bunderline\b/g, '').trim()
        if (rest) style.set('text-decoration', rest)
        else style.delete('text-decoration')
        writeStyle(el, style)
      }
    }
  }
}

/** Remove Google's internal bookkeeping without touching real content. */
function stripGoogleJunk(container: Element): void {
  for (const meta of Array.from(container.querySelectorAll('meta,style,link,title'))) {
    meta.remove()
  }

  for (const el of Array.from(container.querySelectorAll('[id]'))) {
    const id = el.getAttribute('id') ?? ''
    if (/^docs-internal-guid/i.test(id)) el.removeAttribute('id')
  }

  // A <b> or <i> that survived semantic extraction but carries no emphasis
  // is Google's structural wrapper, not the author's intent.
  for (const el of Array.from(container.querySelectorAll('b,i'))) {
    const weight = parseStyle(el).get('font-weight')
    if (weight && !isBoldWeight(weight)) unwrap(el)
  }
}

export function normalizeGoogleDocs(html: string, explicitDocument?: Document): string {
  const doc = resolveDocument(explicitDocument)
  const container = parseFragment(html, doc)

  // Underlines first: once extractSemantics runs, the decoration has already
  // become a <u> element and removing it is a harder problem.
  dropRedundantLinkUnderlines(container)
  extractSemantics(container, doc)
  stripGoogleJunk(container)
  stripComments(container)
  stripAllStyles(container)
  collapseBareSpans(container)
  dropEmptyBlocks(container, ['span', 'p'])

  return container.innerHTML
}
