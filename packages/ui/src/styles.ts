/**
 * Toolbar styles, and the two ways they can reach the page.
 *
 * ## Why this is harder than it should be
 *
 * OpenLeaf deliberately does not use Shadow DOM: the *content* area must
 * inherit the host site's typography for editing to be WYSIWYG against their
 * theme. The price is that these rules share a cascade with a stylesheet we
 * have never seen -- Bootstrap, Tailwind preflight, a 2009 WordPress theme, a
 * Drupal admin theme. So every property a host `button {}` rule or reset might
 * touch is set explicitly below, even where the browser default would do.
 *
 * `all: unset` is NOT used. It looks like the obvious answer and it is a trap:
 * it destroys the inheritance we want (font, colour) and wipes the default
 * focus behaviour we are obliged to keep.
 *
 * No `!important` either. It wins today and makes the toolbar unthemeable
 * tomorrow, which defeats the point of the custom-property API.
 *
 * ## Delivery and CSP
 *
 * Government and enterprise integrators -- the users who most need a free
 * editor -- commonly run `style-src 'self'` with no `'unsafe-inline'`, which
 * blocks an injected `<style>` element. So there are exactly two paths:
 *
 *   1. A constructable `CSSStyleSheet` added to `document.adoptedStyleSheets`.
 *      CSP gates resources *parsed as style*; a CSSOM object attached this way
 *      never passes through that gate, by design rather than by loophole.
 *   2. The integrator links `@openleaf-editor/ui/openleaf.css` themselves and calls
 *      `markStylesExternal()`.
 *
 * There is deliberately NO `<style>` injection fallback. It reads as a safety
 * net and is the opposite: it is blocked by exactly the strict-CSP setups that
 * would need it, and it fails *silently* -- an unstyled toolbar with no signal
 * an integrator can act on. A console warning naming the stylesheet is more
 * useful than a mechanism that quietly does nothing.
 */

import { CSS } from './css.js'

export { CSS } from './css.js'

let externallyProvided = false

/**
 * Declare that the integrator has linked `openleaf.css` themselves, so no
 * injection is attempted. Call before the first editor is created.
 */
export function markStylesExternal(): void {
  externallyProvided = true
}

const injected = new WeakSet<Document>()
const registered = new Map<Document, Set<string>>()
let warned = false

/**
 * Attach a stylesheet through the CSP-safe path.
 *
 * Public because plugins need it. The highlighting plugin previously
 * hand-rolled this -- the same constructable-stylesheet dance, the same
 * fallback, the same warning -- which meant the CSP reasoning lived in two
 * places and only one of them would get fixed.
 *
 * Deduplicated per document by the CSS text itself, so calling it twice from a
 * bundle loaded twice is harmless.
 */
export function registerStyles(css: string, target?: Document): 'adopted' | 'unavailable' | 'already' {
  const doc = target ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) return 'unavailable'

  let seen = registered.get(doc)
  if (!seen) {
    seen = new Set()
    registered.set(doc, seen)
  }
  if (seen.has(css)) return 'already'

  // CSP gates resources *parsed as style* -- <style> elements, style attributes,
  // linked stylesheets. A CSSOM object attached through adoptedStyleSheets never
  // passes through that gate, by design rather than by loophole.
  if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in Document.prototype) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      seen.add(css)
      return 'adopted'
    } catch {
      /* fall through to the warning */
    }
  }

  if (!warned) {
    warned = true
    console.warn(
      '@openleaf-editor/ui: this browser has no adoptedStyleSheets support, so styles ' +
        'were not injected. Link the stylesheet instead:\n' +
        '  <link rel="stylesheet" href=".../@openleaf-editor/ui/openleaf.css">\n' +
        'then call markStylesExternal() to silence this warning.',
    )
  }
  return 'unavailable'
}

/**
 * Ensure the editor's own stylesheet is present. Safe to call repeatedly.
 *
 * There is deliberately **no `<style>` injection fallback**. It looks like a
 * safety net and is the opposite: it fails under exactly the strict-CSP
 * configurations it would be needed for, and it fails *silently* -- a blocked
 * injection leaves an unstyled toolbar and no signal an integrator can act on.
 */
export function ensureStyles(doc: Document): 'external' | 'adopted' | 'unavailable' | 'already' {
  if (externallyProvided) return 'external'
  if (injected.has(doc)) return 'already'
  const outcome = registerStyles(CSS, doc)
  if (outcome === 'adopted') injected.add(doc)
  return outcome
}
