/**
 * WCAG contrast, measured from what the browser actually painted.
 *
 * ## Why not axe-core
 *
 * `@axe-core/playwright`'s `color-contrast` rule was the obvious candidate and
 * it is the wrong tool for this suite: it evaluates **text** contrast only.
 * Every headline failure these tests exist to prevent is *non-text* -- SC
 * 1.4.11 -- and axe has no rule for any of them:
 *
 *   - a focus ring against the surface it is drawn on
 *   - a control border against the surface behind it
 *   - a selection indicator against the cell it marks
 *   - a swatch boundary against the popover it sits in
 *
 * Of the ten defects fixed in this area, axe's rule would have caught two. It
 * also cannot see forced-colors mode, cannot tell a focus ring from a selection
 * ring, and brings a dependency plus a slow, order-sensitive whole-page scan.
 *
 * So the ratios are computed here instead, from `getComputedStyle` on the real
 * rendered element after real interaction. That is deterministic -- no scan, no
 * heuristics, no flake -- and it asserts the specific pairs that regressed.
 *
 * The formula is the WCAG 2.x one: sRGB relative luminance, (L1+.05)/(L2+.05).
 */
import type { Locator, Page } from '@playwright/test'

/** Ratios are only meaningful once composited, so alpha is resolved on the page. */
const IN_PAGE = `
function parse(value) {
  const m = String(value).match(/rgba?\\(([^)]+)\\)/)
  if (!m) return null
  const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}
function over(fg, bg) {
  if (fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}
function lum(c) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}
/**
 * The opaque colour actually painted behind an element: walk up until something
 * is not transparent, because a ratio against rgba(0,0,0,0) is meaningless.
 */
function backdrop(el) {
  let node = el
  while (node) {
    const bg = parse(getComputedStyle(node).backgroundColor)
    if (bg && bg.a > 0) {
      if (bg.a >= 1) return bg
      const under = node.parentElement ? backdrop(node.parentElement) : { r: 255, g: 255, b: 255, a: 1 }
      return over(bg, under)
    }
    node = node.parentElement
  }
  return { r: 255, g: 255, b: 255, a: 1 }
}
`

export type Probe =
  /** Painted text colour against the painted background. */
  | 'text'
  /** Border colour against the background *behind* the element. */
  | 'border'
  /** Outline (focus ring) colour against the element's own background. */
  | 'outline-vs-self'
  /** Outline colour against the background behind the element. */
  | 'outline-vs-backdrop'
  /** The element's own background against its parent's. */
  | 'background'

/**
 * Compute one contrast ratio from the live page.
 *
 * Returns `null` when the probe cannot apply -- an element with no outline
 * drawn, for instance -- so a caller can assert "an indicator exists" and
 * "it is strong enough" as two separate, differently-worded failures.
 */
export async function contrast(target: Locator, probe: Probe): Promise<number | null> {
  return target.evaluate(
    (el, args) => {
      const { probe: kind, helpers } = args as { probe: string; helpers: string }
      // eslint-disable-next-line no-new-func
      const scope = new Function(`${helpers}; return { parse, over, lum, ratio, backdrop }`)() as {
        parse: (v: string) => { r: number; g: number; b: number; a: number } | null
        over: (f: never, b: never) => never
        ratio: (a: never, b: never) => number
        backdrop: (e: Element) => never
      }
      const style = getComputedStyle(el)
      const behind = scope.backdrop(el.parentElement ?? el)
      const own = scope.backdrop(el)

      if (kind === 'text') {
        const fg = scope.parse(style.color)
        if (!fg) return null
        return scope.ratio(scope.over(fg as never, own), own)
      }
      if (kind === 'background') {
        return scope.ratio(own, behind)
      }
      if (kind === 'border') {
        const width = parseFloat(style.borderTopWidth) || 0
        if (width === 0 || style.borderTopStyle === 'none') return null
        const c = scope.parse(style.borderTopColor)
        if (!c || c.a === 0) return null
        return scope.ratio(scope.over(c as never, behind), behind)
      }
      // outline probes
      const owidth = parseFloat(style.outlineWidth) || 0
      if (owidth === 0 || style.outlineStyle === 'none') return null
      const oc = scope.parse(style.outlineColor)
      if (!oc || oc.a === 0) return null
      const against = kind === 'outline-vs-self' ? own : behind
      return scope.ratio(scope.over(oc as never, against), against)
    },
    { probe, helpers: IN_PAGE },
  )
}

/** The four built-in palettes, exercised by name. */
export const SKINS = ['default', 'midnight', 'paper', 'contrast'] as const
export type SkinName = (typeof SKINS)[number]

/** Apply a skin by attribute, or clear it for the default palette. */
export async function useSkin(page: Page, skin: SkinName, selector = 'openleaf-editor'): Promise<void> {
  await page.locator(selector).first().evaluate((el, name) => {
    if (name === 'default') el.removeAttribute('skin')
    else el.setAttribute('skin', name)
  }, skin)
}

/** A readable failure: "1.13:1, needed 3:1" rather than "expected true". */
export function describeRatio(value: number | null, required: number): string {
  if (value === null) return `no indicator drawn at all (needed ${required}:1)`
  return `${value.toFixed(2)}:1 (needed ${required}:1)`
}
