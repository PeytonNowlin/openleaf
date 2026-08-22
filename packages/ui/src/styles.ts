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
 *      Constructed through the TARGET document's window, never this module's:
 *      a constructed sheet belongs to the document it was built for, and
 *      adopting it elsewhere throws NotAllowedError.
 *   2. The integrator links `@openleaf-editor/ui/openleaf.css` themselves and calls
 *      `markStylesExternal()`.
 *
 * There is deliberately NO `<style>` injection fallback. It reads as a safety
 * net and is the opposite: it is blocked by exactly the strict-CSP setups that
 * would need it, and it fails *silently* -- an unstyled toolbar with no signal
 * an integrator can act on. A console warning naming the stylesheet is more
 * useful than a mechanism that quietly does nothing.
 *
 * ## Why the accessibility reasoning lives out here
 *
 * The bundles are minified, which strips these comments but NOT the contents of
 * the template literal below -- a CSS comment is string data and ships to every
 * user. So the long-form arguments sit here and the rules carry a short marker
 * pointing back. Ratios below are computed with the WCAG 2.x sRGB formula
 * against all four built-in palettes: default light, midnight, paper, contrast.
 *
 * ### Two border tokens
 *
 * `--ol-border` is 1.43:1 against the default surface (1.92 midnight, 1.47
 * paper). That is right for a table rule or a group divider and wrong for the
 * only thing delimiting a `<select>`, where WCAG 1.4.11 wants 3:1 for the parts
 * of a control that identify it. Rather than darken every hairline in the
 * editor, the two jobs are split: `--ol-border-strong` takes the control
 * boundaries -- toolbar, menubar, content frame, source view, select, menu --
 * and the decorative one stays quiet. The fallback clears 3:1 on a white
 * surface (4.55:1) and a dark one (4.16:1) alike, so a third-party skin that
 * sets only `--openleaf-color-border` still gets a legible control boundary.
 *
 * ### Menu focus
 *
 * `.ol-menu-item` had `outline: none` and a background swap standing in for the
 * ring. That swap is 1.13:1 on the default palette, 1.24 midnight, 1.13 paper,
 * and 1.23 in the skin named "High contrast"; 1.4.11 requires 3:1. A menu item
 * is reachable only by ArrowDown, so that swap was the author's sole position
 * marker. The ring is back and the swap stays as hover affordance. It is inset
 * two pixels rather than outset so it is drawn inside the item rather than over
 * the menu's padding and its neighbour, and it lands at 4.59:1 against the
 * item's own hovered background (7.82 midnight, 4.88 paper, 9.73 contrast).
 *
 * ### Disabled is not invisible
 *
 * `opacity: 0.4` put a 16px glyph at 2.41:1 (2.34 paper, 2.85 contrast), which
 * is not a dimmed icon but an absent one -- and `undo`, `redo` and `link` are
 * disabled at rest. 0.55 stays plainly quieter than an enabled control while
 * clearing 3:1 as non-text content. A disabled control is exempt from 1.4.3
 * either way; being exempt from a rule is not a reason to be unreadable.
 *
 * ### Cell selection
 *
 * The `.selectedCell` tint alone measured 1.06-1.18:1 depending on the palette,
 * and a selection you cannot see is one you will destroy by typing. The ring
 * carries the information now and the tint is the nicety. The ring goes on the
 * cell rather than on the `::after` overlay because the overlay's own `opacity`
 * would fade it to the same invisibility -- a 40% accent lands near 2:1. Per
 * CSS 2.1 Appendix E an element's outline paints in step 10, after all its
 * descendants, so the tint does not cover it.
 *
 * ### Forced colours
 *
 * The block at the end of the sheet previously stopped at `.ol-btn`. Everything
 * added to it depends on a palette this mode discards outright, so each of them
 * had no indicator at all: which menu is open, which menu item has focus, which
 * cells are selected, and every one of the visual aids -- whose entire output
 * is a colour.
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
// WeakMap, like its sibling above: a strong Map here pins every Document this
// module has ever styled -- every iframe, every closed print preview -- for the
// life of the page. Only get/set are used, so nothing needs to iterate it.
const registered = new WeakMap<Document, Set<string>>()
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
  //
  // The constructor comes from the TARGET document's own window, and the
  // capability is probed on the target rather than on this module's realm. A
  // constructed sheet carries the document it was constructed for, and
  // `adoptedStyleSheets` throws NotAllowedError for a sheet belonging to another
  // one -- so `new CSSStyleSheet()` here, resolved from whichever realm this
  // module happens to be loaded in, could never style an iframe or a print view.
  // Confirmed in all three engines: top-realm sheet -> NotAllowedError, sheet
  // built through the frame's own window -> adopted and applied.
  const view = doc.defaultView as (Window & typeof globalThis) | null
  if (view?.CSSStyleSheet && 'adoptedStyleSheets' in doc) {
    try {
      const sheet = new view.CSSStyleSheet()
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
