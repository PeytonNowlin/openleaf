/**
 * Canonical CSS validation shared by the editor and server-side policy adapters.
 *
 * Alignment and colour are the two formatting features that cannot be expressed
 * as a tag. `<p align="center">` and `<font color="red">` were removed from HTML
 * years ago; every editor this one is meant to replace -- TinyMCE, CKEditor,
 * Google Docs -- writes `style="text-align:center"` and
 * `<span style="color:#c00">` instead. Matching them is not a preference: it is
 * the difference between reading a customer's existing archive and rewriting it.
 *
 * So OpenLeaf emits a `style` attribute, which means it owes a precise answer to
 * "which declarations, with which values". That answer lives here, in one place,
 * because four separate consumers need to agree on it:
 *
 *   the schema        -- parsing stored HTML and writing it back
 *   the commands      -- validating what a toolbar hands them
 *   the preservation  -- deciding whether a `<span style>` is fully modelled and
 *   layer                can therefore be unwrapped rather than kept as an atom
 *   @openleaf-editor/sanitize -- allowing exactly these declarations server-side
 *
 * Four hand-written copies of a CSS allowlist is the same divergence the
 * sanitize package exists to prevent, one layer down.
 *
 * ## Why a validator rather than a blocklist
 *
 * `style` has a genuinely bad history: `expression()` in old IE executed
 * JavaScript, `url()` fetches, `position:fixed` lets pasted content cover the
 * page with something that looks like your UI. None of that is reachable
 * through a closed property allowlist whose values must match a colour, a
 * length, a font name, or one of a few keywords -- and an allowlist stays safe
 * against whatever CSS gains next, which a list of known-bad functions does not.
 */

/** The four alignments a toolbar offers. */
export type Align = 'left' | 'center' | 'right' | 'justify'

export const ALIGNMENTS: readonly Align[] = ['left', 'center', 'right', 'justify']

/**
 * Declarations the schema models, and therefore the only ones it will write.
 *
 * `@openleaf-editor/sanitize` reads this list to build its own allowlist, so a
 * property added here reaches the server-side policy rather than being stripped
 * from stored content by a policy that never heard of it.
 */
export const MODELLED_PROPERTIES: readonly string[] = [
  'text-align',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'line-height',
  'padding-inline-start',
  'list-style-type',
]

/**
 * The subset a mark can represent, and therefore the subset the preservation
 * layer may unwrap a `<span>` for. Block properties are deliberately absent:
 * unwrapping the element that carries them would drop them.
 */
export const COLOUR_PROPERTIES: readonly string[] = ['color', 'background-color']

export const INLINE_STYLE_PROPERTIES: readonly string[] = [
  'color',
  'background-color',
  'font-family',
  'font-size',
]

/** Indent step written as `padding-inline-start`. Matches TinyMCE's 2em. */
export const INDENT_EM = 2
export const MAX_INDENT = 8

/** List styles the toolbar offers. `decimal` is the ordered-list default. */
export type ListStyle =
  | 'disc'
  | 'circle'
  | 'square'
  | 'decimal'
  | 'lower-roman'
  | 'upper-roman'
  | 'lower-alpha'
  | 'upper-alpha'
  | 'lower-greek'

export const LIST_STYLES: readonly ListStyle[] = [
  'disc',
  'circle',
  'square',
  'decimal',
  'lower-roman',
  'upper-roman',
  'lower-alpha',
  'upper-alpha',
  'lower-greek',
]

export type Dir = 'ltr' | 'rtl'

export const FONT_FAMILIES: readonly string[] = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Palatino',
  'Garamond',
  'system-ui',
  'serif',
  'sans-serif',
  'monospace',
]

/** Preset sizes the toolbar lists, in pixels. The number input accepts any in range. */
export const FONT_SIZE_PRESETS: readonly number[] = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

export const LINE_HEIGHT_PRESETS: readonly string[] = ['1', '1.15', '1.5', '2', '2.5']

/**
 * Split a `style` attribute into declarations.
 *
 * Deliberately reads the raw attribute rather than the CSSOM. `element.style`
 * normalizes as it parses -- Chrome turns `#ff0000` into `rgb(255, 0, 0)` -- and
 * anything that reads through it rewrites every hex colour in an archive on the
 * first save. The parse is trivial because the values that survive validation
 * contain no semicolons. Quoted font-family names are re-emitted in double
 * quotes, and the name itself cannot contain `;`, so a naive split cannot be
 * tricked into producing a value the validators would not have accepted anyway.
 *
 * Keys are lowercased; values keep their case, because a colour may be a hex
 * digit sequence an author wrote in capitals and there is no reason to change it.
 */
export function parseDeclarations(style: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!style) return out
  for (const part of style.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (name === '' || value === '') continue
    out.set(name, value)
  }
  return out
}

/** Join declarations back into a `style` attribute value, or `null` if empty. */
export function serializeDeclarations(declarations: Map<string, string>): string | null {
  if (declarations.size === 0) return null
  return [...declarations].map(([name, value]) => `${name}:${value}`).join(';')
}

/**
 * The alignment this value means, or null.
 *
 * `start` and `end` are accepted because they are what a bidirectional-aware
 * author writes, and they are resolved against the reading direction rather than
 * dropped: in an RTL document `start` is the right edge. They are NOT preserved
 * as `start`/`end`, which is a real if narrow loss -- an RTL paragraph aligned to
 * `start` comes back as `right`, and stays right if the document's direction
 * later changes. Modelling logical alignment properly means a second attribute
 * and a toolbar that can express it, which is a bigger feature than this one.
 */
export function safeAlign(value: string | null | undefined, dir?: string | null): Align | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase()
  const rtl = (dir ?? '').toLowerCase() === 'rtl'
  if (candidate === 'start') return rtl ? 'right' : 'left'
  if (candidate === 'end') return rtl ? 'left' : 'right'
  return (ALIGNMENTS as readonly string[]).includes(candidate) ? (candidate as Align) : null
}

/**
 * A colour value, or null when it is not one.
 *
 * The three accepted shapes are hex, the `rgb`/`hsl` function families, and a
 * bare keyword. A keyword is matched as a plain identifier rather than against
 * the 148-name CSS colour list: the list costs most of a kilobyte in a bundle
 * with a hard budget, and an unrecognised identifier is not dangerous -- the
 * browser discards the declaration. Every form that can actually reach outside
 * the declaration needs a character this rejects, `(` for `expression()` and
 * `url()` among them, and both are excluded from the keyword shape.
 */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTIONAL = /^(?:rgba?|hsla?)\(\s*[0-9a-z\s.,%/+-]+\)$/i
const KEYWORD = /^[a-z]{3,24}$/i

/** `rgb(255, 0, 0)` and friends, so a fully opaque one can become hex. */
const RGB_CHANNELS = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(1|1?\.0+|100%)\s*)?\)$/i

export function safeColor(value: string | null | undefined): string | null {
  if (!value) return null
  // Collapsed rather than stripped: `rgb(255 0 0)` needs its separators.
  //
  // Do not delete this line, and do not move it below the matches that follow.
  // It is a security control as much as a normalization: the collapse is what
  // bounds their cost, so anything matched before it runs is unprotected.
  //
  // FUNCTIONAL and RGB_CHANNELS
  // are both ambiguous about whitespace: FUNCTIONAL puts `\s*` immediately
  // before a character class that itself contains `\s`, and RGB_CHANNELS
  // separates channels with `\s*[,\s]\s*`. Fed a raw run of N spaces that
  // ultimately fails to match, either pattern makes the engine try every way
  // of dividing that run between the adjacent quantifiers, which is quadratic.
  // Measured against the bare patterns: `rgb(` plus 32k spaces costs
  // FUNCTIONAL 399 ms, and `rgb(1` plus 64k spaces then a non-digit costs
  // RGB_CHANNELS 1,614 ms. Delete this line and safeColor itself takes 24.7
  // SECONDS on a 256k run. Collapsing first means the patterns only ever see a
  // single space, and safeColor stays linear -- 0.2 ms at 256k. Style
  // values arrive from pasted HTML, so the input is attacker-influenceable and
  // the bound has to hold. Regression test: packages/content-policy/test/css.test.ts.
  const candidate = value.trim().replace(/\s+/g, ' ')
  if (candidate === '') return null

  const rgb = RGB_CHANNELS.exec(candidate)
  if (rgb) {
    // Normalized to hex, and this is what keeps a round trip stable rather than
    // merely lossless. ProseMirror matches mark style rules through the CSSOM,
    // which hands us `rgb(255, 0, 0)` for an authored `#ff0000` -- so without
    // this, opening and saving a document would rewrite every hex colour in it
    // into a longer functional form. Folding the other direction instead makes
    // both spellings converge on the shorter one, and the second save is a
    // no-op.
    const channels = [rgb[1], rgb[2], rgb[3]].map((n) => Number.parseInt(n as string, 10))
    if (channels.every((n) => n <= 255)) {
      return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('')}`
    }
  }

  if (HEX.test(candidate)) return candidate.toLowerCase()
  if (FUNCTIONAL.test(candidate)) return candidate.toLowerCase()
  if (KEYWORD.test(candidate)) return candidate.toLowerCase()
  return null
}

export function safeDir(value: string | null | undefined): Dir | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase()
  return candidate === 'ltr' || candidate === 'rtl' ? candidate : null
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

/**
 * A font stack, or null.
 *
 * Each name is a CSS identifier or a quoted family-name. After unquoting, the
 * inner name is checked against an allowlist -- letters, digits, spaces,
 * hyphens, apostrophes and plus -- and re-emitted in one canonical spelling so
 * the schema, the sanitizer and the toolbar dropdown agree. Apostrophe and
 * plus are in the class because Goudy's Old Style and C++ Sans are real faces;
 * a leading digit is in the start rule because 21st Century is a legal
 * *quoted* family name (unquoted it would be a dimension token).
 *
 * Everything that can reach outside the declaration is still a character this
 * refuses. A denylist of `url()` / `expression()` / `var()` would be a
 * different, weaker thing: it would have to name every construct CSS gains
 * next. The allowlist does not.
 *
 * A stack is a comma-separated list of those names, capped so a paste cannot
 * dump a novel into the attribute.
 */
export function safeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  if (raw === '' || raw.length > 160) return null
  if (/url\s*\(|expression|var\s*\(|[@\\<>]/i.test(raw)) return null

  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      // Quotes only open a family name at the start of a part. An apostrophe
      // in Goudy's Old Style is a character in the name, not a string
      // delimiter -- treating it as one made `<font face="Goudy's Old Style">`
      // and setFontFamily("Goudy's Old Style") look like an unclosed quote.
      if (current.trim() !== '') {
        current += char
        continue
      }
      quote = char
      current += char
      continue
    }
    if (char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (quote !== null) return null
  parts.push(current)
  if (parts.length === 0 || parts.length > 6) return null

  const out: string[] = []
  for (const part of parts) {
    const family = oneFontFamily(part)
    if (family === null) return null
    out.push(family)
  }
  return out.join(',')
}

/**
 * One family name, or null.
 *
 * Quoted and unquoted input both unquote to an inner name, which is then
 * checked against the allowlist and re-emitted canonically:
 *
 *   generic families  lowercase and unquoted (quoting "serif" would name a
 *                     font called serif rather than the generic)
 *   a CSS identifier  unquoted (`Georgia`)
 *   everything else   double-quoted (`"Times New Roman"`, `"Goudy's Old
 *                     Style"`, `"21st Century"`)
 *
 * Single-quoted input is therefore rewritten. That is what lets a stored
 * `font-family:'Times New Roman'` match the toolbar option, which is the
 * same spelling.
 *
 * What the inner allowlist still refuses, and why that set is enough:
 *
 *   `"`        would terminate the double quotes we re-emit around a name
 *   `\`        is how CSS encodes any other character, including the ones
 *              below; we do not process escapes, so we do not admit them
 *   `(` `)`    wrap `url()`, `expression()`, `var()`
 *   `;`        ends the declaration, and would also split parseDeclarations
 *   `/` `*`    comment delimiters
 *   newlines, and the rest of ASCII punctuation (`&` included: it is an
 *   HTML-entity delimiter in a `style` attribute)
 *
 * A leading digit is legal only in the *quoted* form, which is why names
 * that are not a single identifier are always re-emitted in double quotes
 * rather than passed through raw.
 */
function oneFontFamily(part: string): string | null {
  const trimmed = part.trim()
  if (trimmed === '' || trimmed.length > 64) return null
  const quoted = /^(['"])(.*)\1$/.exec(trimmed)
  // `?.[2]` rather than a ternary: a capture group is `string | undefined` to the
  // type checker even when the match succeeded. `(.*)` matches the empty string,
  // so a quoted empty name still reads as '' and is refused below -- the `??`
  // only fires when there was no match at all.
  const name = quoted?.[2] ?? trimmed
  if (name === '' || name.length > 64) return null
  if (/[^a-zA-Z0-9 \-'+]/.test(name)) return null
  if (!/^[a-zA-Z0-9]/.test(name)) return null
  const lower = name.toLowerCase()
  if (GENERIC_FAMILIES.has(lower)) return lower
  // Unquoted, a leading digit is a dimension (`21st` is 21 + st) and an
  // apostrophe or plus is not an ident character. Quote anything that is
  // not a single CSS identifier; a name with a space already took this
  // path, which is the stored form the toolbar options use.
  if (!/^[a-zA-Z][a-zA-Z0-9\-]*$/.test(name)) return `"${name}"`
  return name
}

const FONT_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
])

const FONT_SIZE_LENGTH = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i

/**
 * A font size, or null.
 *
 * Keywords and a closed set of length units. Values are clamped so a pasted
 * `font-size: 400px` cannot blow the layout out; the toolbar's number input
 * writes pixels inside the same range.
 */
export function safeFontSize(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase().replace(/\s+/g, '')
  if (FONT_SIZE_KEYWORDS.has(candidate)) return candidate
  const match = FONT_SIZE_LENGTH.exec(candidate)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2] as 'px' | 'pt' | 'em' | 'rem' | '%'
  const min = { px: 8, pt: 6, em: 0.5, rem: 0.5, '%': 50 }
  const max = { px: 96, pt: 72, em: 6, rem: 6, '%': 300 }
  if (!(amount >= min[unit] && amount <= max[unit])) return null
  const rendered = Number.isInteger(amount) ? String(amount) : String(amount)
  return `${rendered}${unit}`
}

const LINE_HEIGHT_LENGTH = /^(\d+(?:\.\d+)?)(px|em|rem|%)?$/i

/** A line height: `normal`, a unitless multiplier, or a short length. */
export function safeLineHeight(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase().replace(/\s+/g, '')
  if (candidate === 'normal') return 'normal'
  const match = LINE_HEIGHT_LENGTH.exec(candidate)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2] ?? ''
  if (unit === '') {
    if (!(amount >= 0.5 && amount <= 4)) return null
    return Number.isInteger(amount) ? String(amount) : String(amount)
  }
  if (unit === '%') {
    if (!(amount >= 50 && amount <= 400)) return null
    return `${formatNumber(amount)}%`
  }
  if (!(amount >= 0.5 && amount <= 96)) return null
  return `${formatNumber(amount)}${unit}`
}

function formatNumber(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : String(amount)
}

/**
 * How many indent steps this declaration means, or null.
 *
 * Written as `padding-inline-start: 2em` per step. Inherited `padding-left`
 * and `margin-left` in 40px or 2em multiples are read as the same thing, which
 * is what TinyMCE and CKEditor stored for years.
 */
export function indentLevels(value: string | null | undefined): number | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase().replace(/\s+/g, '')
  const em = /^(\d+(?:\.\d+)?)em$/.exec(candidate)
  if (em) return stepsFrom(Number(em[1]), INDENT_EM)
  const px = /^(\d+(?:\.\d+)?)px$/.exec(candidate)
  if (px) return stepsFrom(Number(px[1]), 40)
  return null
}

function stepsFrom(amount: number, step: number): number | null {
  const steps = amount / step
  if (steps < 0.9 || steps > MAX_INDENT) return null
  const rounded = Math.round(steps)
  return Math.abs(steps - rounded) < 0.05 ? rounded : null
}

export function indentCss(levels: number): string {
  return `${levels * INDENT_EM}em`
}

/**
 * A Map, not an object literal, because the lookup key is author-controlled.
 * An object inherits `Object.prototype`, so `aliases['constructor']` answers
 * with the `Object` constructor and `<ol type="constructor">` round-tripped to
 * `list-style-type:function Object() { [native code] }`. A Map has no
 * prototype keys to find.
 */
const LIST_STYLE_ALIASES = new Map<string, ListStyle>([
  ['disc', 'disc'],
  ['circle', 'circle'],
  ['square', 'square'],
  ['decimal', 'decimal'],
  ['lower-roman', 'lower-roman'],
  ['upper-roman', 'upper-roman'],
  ['lower-alpha', 'lower-alpha'],
  ['upper-alpha', 'upper-alpha'],
  ['lower-latin', 'lower-alpha'],
  ['upper-latin', 'upper-alpha'],
  ['lower-greek', 'lower-greek'],
  // HTML `type` on <ol>. Case matters here: `a` and `A` are different lists,
  // so the exact spelling is tried before the lowercased one.
  ['a', 'lower-alpha'],
  ['A', 'upper-alpha'],
  ['i', 'lower-roman'],
  ['I', 'upper-roman'],
  ['1', 'decimal'],
])

export function safeListStyle(value: string | null | undefined): ListStyle | null {
  if (!value) return null
  const candidate = value.trim()
  return LIST_STYLE_ALIASES.get(candidate) ?? LIST_STYLE_ALIASES.get(candidate.toLowerCase()) ?? null
}

/**
 * A BCP 47-shaped language tag, or null.
 *
 * Not a complete parser: it admits `en`, `en-GB`, `zh-Hans-CN` and refuses
 * anything that could not be a language tag. The point is to keep `lang`
 * from becoming a free-form attribute for whatever a paste stuffed in it.
 */
export function safeLang(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.trim()
  if (candidate.length < 2 || candidate.length > 35) return null
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(candidate)) return null
  return candidate
}

/** The canonical value for a modelled declaration, or null if it is not one. */
export function modelledValue(property: string, value: string): string | null {
  switch (property) {
    case 'text-align':
      return safeAlign(value)
    case 'color':
    case 'background-color':
      return safeColor(value)
    case 'font-family':
      return safeFontFamily(value)
    case 'font-size':
      return safeFontSize(value)
    case 'line-height':
      return safeLineHeight(value)
    case 'padding-inline-start':
    case 'padding-left':
    case 'margin-inline-start':
    case 'margin-left': {
      const steps = indentLevels(value)
      return steps === null ? null : indentCss(steps)
    }
    case 'list-style-type':
      return safeListStyle(value)
    default:
      return null
  }
}

/**
 * Put CSS on an element without losing the author's spelling.
 *
 * ## Why this is not simply `setAttribute('style', css)`
 *
 * ProseMirror's DOM serializer writes `style` with `element.style.cssText = value`,
 * which routes the declaration through the CSSOM -- and the CSSOM rewrites as it
 * parses. `color:#cc0000` comes back out as `color: rgb(204, 0, 0)`. Measured in
 * Chromium and WebKit: `setAttribute` preserves the string exactly, `cssText`
 * does not.
 *
 * The consequence of letting the serializer do it is that opening and saving a
 * document rewrites every hex colour in it into a longer functional form. No
 * information is lost, so it is a normalization rather than a fidelity bug -- but
 * it is a normalization that touches the COMMON case in inherited content, and
 * "we changed every coloured span in your archive" is not a diff this project
 * gets to put in somebody's revision history quietly. So the nodes and marks that
 * emit CSS return a real element and set the attribute themselves.
 *
 * ## Why it then falls back to the CSSOM anyway
 *
 * A strict Content-Security-Policy without `unsafe-inline` in `style-src` blocks
 * a `style` ATTRIBUTE: the attribute stays in the DOM and the browser refuses to
 * parse it, so the paragraph renders unaligned and the console fills with
 * violations. A CSSOM write is not blocked -- the same distinction that makes the
 * toolbar's constructable stylesheet CSP-safe.
 *
 * So: ask once whether this document parses `style` attributes at all, and fall
 * back to `cssText` where it does not. Under an ordinary CSP the author's
 * spelling survives; under a strict one the formatting still renders, at the
 * cost of the normalization. Getting both right in the environment that has both
 * is not possible, and of the two, "it renders" has to win.
 *
 * ## Why the question is asked once, not per element
 *
 * Reading `el.style.length` is not free: it is what forces the CSSOM to parse
 * the declaration that was just set. Doing it per element meant every styled
 * node and every colour or font mark paid a CSSOM parse on every serialize --
 * the exact work the `setAttribute` route exists to avoid. Whether the attribute
 * is honoured is a property of the DOCUMENT's policy, not of the element, so one
 * probe per document answers it for every element in it.
 *
 * Per document rather than per module: serialization can target a Document other
 * than the global one, a detached document need not carry the page's policy, and
 * a `WeakMap` keyed on the Document neither leaks nor decides on one document's
 * behalf what another one does. Lazily, so importing this module on a server
 * touches no DOM.
 */
const parsesStyleAttribute = new WeakMap<Document, boolean>()

function honoursStyleAttribute(doc: Document): boolean {
  const known = parsesStyleAttribute.get(doc)
  if (known !== undefined) return known
  const probe = doc.createElement('span')
  probe.setAttribute('style', 'color:red')
  // A declaration that is unambiguously valid, so a zero length can only mean
  // the attribute was set and not parsed -- the CSP-blocked case.
  const honoured = (probe.style?.length ?? 0) > 0
  parsesStyleAttribute.set(doc, honoured)
  return honoured
}

export function applyStyleAttribute(el: Element, css: string): void {
  el.setAttribute('style', css)
  if (honoursStyleAttribute(el.ownerDocument)) return
  const style = (el as HTMLElement).style
  if (style) style.cssText = css
}

/**
 * Is every declaration in this `style` attribute one the schema models?
 *
 * The preservation layer asks this before unwrapping a `<span style>`. A span
 * carrying only colour and font is fully representable as marks, so unwrapping
 * it loses nothing and the text inside stays editable. One carrying
 * `letter-spacing` as well is not, and it must stay an opaque preserved atom.
 */
export function isFullyModelledStyle(
  style: string | null | undefined,
  properties: readonly string[] = INLINE_STYLE_PROPERTIES,
): boolean {
  const declarations = parseDeclarations(style)
  if (declarations.size === 0) return false
  for (const [name, value] of declarations) {
    if (!properties.includes(name)) return false
    if (modelledValue(name, value) === null) return false
  }
  return true
}

const LENGTH = /^-?\d+(?:\.\d+)?(?:px|em|rem|%|pt|ex|ch)?$/i
const VERTICAL_ALIGNMENTS = new Set(['top', 'middle', 'bottom', 'baseline'])

/** Validate every CSS declaration understood by the editor or sanitizer policy. */
export function isAllowedDeclaration(property: string, value: string): boolean {
  switch (property.toLowerCase()) {
    case 'text-align': return safeAlign(value) !== null
    case 'color':
    case 'background-color': return safeColor(value) !== null
    case 'font-family': return safeFontFamily(value) !== null
    case 'font-size': return safeFontSize(value) !== null
    case 'line-height': return safeLineHeight(value) !== null
    case 'padding-inline-start': return indentLevels(value) !== null
    case 'list-style-type': return safeListStyle(value) !== null
    case 'padding': {
      const parts = value.trim().split(/\s+/)
      return parts.length >= 1 && parts.length <= 4 && parts.every((part) => LENGTH.test(part))
    }
    case 'width':
    case 'height': return LENGTH.test(value.trim())
    case 'vertical-align': return VERTICAL_ALIGNMENTS.has(value.trim().toLowerCase())
    default: return false
  }
}

/** Filter a style attribute while preserving the spelling of accepted declarations. */
export function filterStyle(style: string, permitted: ReadonlySet<string>): string | null {
  const kept: string[] = []
  let dropped = false
  for (const part of style.split(';')) {
    if (part.trim() === '') continue
    const colon = part.indexOf(':')
    const property = colon < 0 ? '' : part.slice(0, colon).trim().toLowerCase()
    const value = colon < 0 ? '' : part.slice(colon + 1).trim()
    if (property === '' || value === '' || !permitted.has(property) || !isAllowedDeclaration(property, value)) {
      dropped = true
      continue
    }
    kept.push(part.trim())
  }
  if (kept.length === 0) return null
  return dropped ? kept.join(';') : style
}

/** Every CSS property any element may carry under a policy. */
export function allStyleProperties(elements: Record<string, { styleProperties?: string[] }>): string[] {
  const out = new Set<string>()
  for (const element of Object.values(elements)) {
    for (const property of element.styleProperties ?? []) out.add(property)
  }
  return [...out]
}
