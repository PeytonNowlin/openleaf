/**
 * The icon set, as one inline SVG `<symbol>` sprite.
 *
 * Why a sprite of stroke paths rather than the alternatives:
 *
 *   Icon font       -- rejected. A flash of unstyled text, screen readers that
 *                      read the private-use codepoint aloud, and more bytes
 *                      than the paths themselves.
 *   Inline per use  -- rejected. The same path repeated for every button.
 *   Letterforms     -- rejected, and this is the non-obvious one. "B" for bold
 *                      and "I" for italic bake English into the interface. Bold
 *                      is *gras* in French, *fett* in German; a "B" icon is a
 *                      translation bug wearing a costume.
 *
 * All icons are a 24x24 viewBox with `stroke="currentColor"`, so they inherit
 * text colour for free and need no separate dark-mode set. Roughly 2 KB raw,
 * under 1 KB gzipped.
 *
 * Everything here is built with DOM APIs rather than `innerHTML`. Strict
 * government CSPs commonly pair `style-src` with
 * `require-trusted-types-for 'script'`, which exempts stylesheets but not
 * dynamic HTML -- a string-concatenated sprite would be blocked in exactly the
 * deployments this project exists to serve.
 */

/**
 * Symbol id -> path data. Every icon is stroked; none are filled.
 *
 * Mutable, because plugins add their own. An opt-in bundle should not force its
 * icons into the core download -- the eleven table icons would otherwise cost
 * every deployment that has tables switched off.
 */
const PATHS: Record<string, string> = {
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
  strikethrough: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  bulletList: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  orderedList: 'M10 6h11M10 12h11M10 18h11M4 4h1v4M4 8h2M6 18H4c0-1 2-1.5 2-2.5S5 14 4 14.5',
  blockquote: 'M4 4v16M9 7h11M9 12h11M9 17h7',
  codeBlock: 'M3 5h18v14H3zM9 10l-2 2 2 2M15 10l2 2-2 2',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  unlink: 'M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M2 2l20 20',
  image: 'M3 3h18v18H3zM8.5 9.5a1.5 1.5 0 1 0 .01 0M21 15l-5-5L5 21',
  horizontalRule: 'M4 12h16',
  alignLeft: 'M3 6h18M3 12h10M3 18h14',
  alignCenter: 'M3 6h18M7 12h10M5 18h14',
  alignRight: 'M3 6h18M11 12h10M7 18h14',
  alignJustify: 'M3 6h18M3 12h18M3 18h18',
  indent: 'M3 8h18M3 12h9M3 16h18M14 10l4 2-4 2',
  outdent: 'M3 8h18M12 12h9M3 16h18M10 10l-4 2 4 2',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  redo: 'M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13',
  source: 'M18 16l4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  help: 'M12 18h.01M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4',
  visualAids: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12a2 2 0 1 0 .01 0',
}

/**
 * An icon name.
 *
 * A plain string rather than a union of the built-ins: plugins register their
 * own names, and a closed union would make the registry unusable by anything
 * outside this package.
 */
export type IconName = string

/**
 * Icons whose meaning depends on reading direction, and which must therefore be
 * mirrored in an RTL document. Bold and italic must NOT be in this set -- a
 * mirrored letterform-derived glyph is just wrong, not localised.
 */
export const DIRECTIONAL: ReadonlySet<string> = new Set([
  'undo',
  'redo',
  'code',
  'codeBlock',
  'source',
  'blockquote',
  'bulletList',
  'orderedList',
  'indent',
  'outdent',
])

/*
 * The alignment icons are deliberately absent from that set, and it is the
 * counter-intuitive case. They look like the mirroring candidates -- a glyph of
 * short lines ragged on the left -- but `text-align: left` means the left edge in
 * an RTL document too. Mirroring them would show a right-ragged icon on the
 * button that aligns text left, which is not localisation, it is a lie about
 * what the control does.
 */

export function iconNames(): IconName[] {
  return Object.keys(PATHS)
}

/**
 * Add icons, from a plugin.
 *
 * If the sprite is already in the document -- which it will be whenever an
 * editor exists before a deferred bundle finishes loading -- the new symbols are
 * appended to it. Without that, a plugin's buttons render as empty squares and
 * the failure looks like a CSS problem.
 */
export function registerIcons(paths: Record<string, string>, doc?: Document): void {
  const added: string[] = []
  for (const [name, d] of Object.entries(paths)) {
    if (PATHS[name] === d) continue
    PATHS[name] = d
    added.push(name)
  }
  if (added.length === 0) return

  const target = doc ?? (typeof document !== 'undefined' ? document : undefined)
  const sprite = target?.getElementById(SPRITE_ID)
  if (!target || !sprite) return
  for (const name of added) {
    if (target.getElementById(`ol-i-${name}`)) continue
    sprite.appendChild(makeSymbol(name, PATHS[name] as string, target))
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const SPRITE_ID = 'ol-icon-sprite'

/** Inject the sprite once per document. Safe to call repeatedly. */
export function ensureSprite(doc: Document): void {
  if (doc.getElementById(SPRITE_ID)) return

  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('id', SPRITE_ID)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('style', 'display:none')

  for (const [name, d] of Object.entries(PATHS)) {
    svg.appendChild(makeSymbol(name, d, doc))
  }

  doc.body.appendChild(svg)
}

function makeSymbol(name: string, d: string, doc: Document): SVGSymbolElement {
  const symbol = doc.createElementNS(SVG_NS, 'symbol') as SVGSymbolElement
  symbol.setAttribute('id', `ol-i-${name}`)
  symbol.setAttribute('viewBox', '0 0 24 24')
  symbol.setAttribute('fill', 'none')
  symbol.setAttribute('stroke', 'currentColor')
  symbol.setAttribute('stroke-width', '2')
  symbol.setAttribute('stroke-linecap', 'round')
  symbol.setAttribute('stroke-linejoin', 'round')
  const path = doc.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  symbol.appendChild(path)
  return symbol
}

/**
 * An `<svg><use></svg>` referencing a sprite symbol.
 *
 * `aria-hidden` and `focusable="false"` are both required: the icon is
 * decorative because the button carries the accessible name, and without
 * `focusable="false"` older engines put the SVG in the tab order.
 */
export function iconElement(name: IconName, doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute(
    'class',
    DIRECTIONAL.has(name) ? 'ol-icon ol-icon--directional' : 'ol-icon',
  )
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const use = doc.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', `#ol-i-${name}`)
  svg.appendChild(use)
  return svg
}
