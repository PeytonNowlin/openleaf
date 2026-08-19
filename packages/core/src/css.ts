/**
 * The CSS the schema is willing to model, and nothing else.
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
 * through a three-property allowlist whose values must match a colour or one of
 * four keywords -- and an allowlist stays safe against whatever CSS gains next,
 * which a list of known-bad functions does not.
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
export const MODELLED_PROPERTIES: readonly string[] = ['text-align', 'color', 'background-color']

/**
 * The subset a mark can represent, and therefore the subset the preservation
 * layer may unwrap a `<span>` for. `text-align` is deliberately absent: it is a
 * block attribute, so unwrapping the element that carries it loses it.
 */
export const COLOUR_PROPERTIES: readonly string[] = ['color', 'background-color']

/**
 * Split a `style` attribute into declarations.
 *
 * Deliberately reads the raw attribute rather than the CSSOM. `element.style`
 * normalizes as it parses -- Chrome turns `#ff0000` into `rgb(255, 0, 0)` -- and
 * anything that reads through it rewrites every hex colour in an archive on the
 * first save. The parse is trivial because the values that survive validation
 * contain no semicolons or quotes; anything that does fails validation and is
 * dropped, so a naive split cannot be tricked into producing a value the
 * validators would not have accepted anyway.
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
 * So: set the attribute, then check whether the browser honoured it, and fall
 * back to `cssText` if it did not. Under an ordinary CSP the author's spelling
 * survives; under a strict one the formatting still renders, at the cost of the
 * normalization. Getting both right in the environment that has both is not
 * possible, and of the two, "it renders" has to win.
 */
export function applyStyleAttribute(el: Element, css: string): void {
  el.setAttribute('style', css)
  const style = (el as HTMLElement).style
  // `length` is zero when the attribute was set but not parsed, which is exactly
  // the CSP-blocked case. It is also zero if the declaration was invalid, where
  // falling through costs nothing because there was nothing to render.
  if (style && style.length === 0) style.cssText = css
}

/**
 * Is every declaration in this `style` attribute one the schema models?
 *
 * The preservation layer asks this before unwrapping a `<span style>`. A span
 * carrying only colour is fully representable as marks, so unwrapping it loses
 * nothing and the text inside stays editable. One carrying `font-family` as well
 * is not, and it must stay an opaque preserved atom -- faithful, uneditable, and
 * exactly what happens today rather than a regression.
 */
export function isFullyModelledStyle(
  style: string | null | undefined,
  properties: readonly string[] = COLOUR_PROPERTIES,
): boolean {
  const declarations = parseDeclarations(style)
  if (declarations.size === 0) return false
  for (const [name, value] of declarations) {
    if (!properties.includes(name)) return false
    const valid = name === 'text-align' ? safeAlign(value) : safeColor(value)
    if (valid === null) return false
  }
  return true
}
