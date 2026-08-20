/**
 * Canonical URL safety shared by the editor and sanitizers.
 *
 * A link is the cheapest XSS vector there is: `<a href="javascript:...">` needs
 * no injected element, no script tag, and no clever parsing trick -- just a user
 * who clicks. OpenLeaf's schema previously accepted any `href` at all.
 *
 * The checks here are deliberately a small allowlist of schemes rather than a
 * blocklist of dangerous ones. A blocklist is a promise to have thought of every
 * scheme, including the ones a browser will invent later.
 */

/**
 * Schemes an author may link to.
 *
 * `data:` is absent on purpose. `data:text/html` is a full XSS vector, and
 * distinguishing safe data URLs from dangerous ones by sniffing the media type
 * is exactly the kind of parsing that gets defeated. Integrators who genuinely
 * need inline images can permit them in their server-side policy, where the
 * decision is explicit and reviewable.
 */
const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel', 'ftp', 'ftps'])

/** Matches a leading URL scheme, per RFC 3986. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i

/**
 * Strip the characters browsers ignore when resolving a scheme.
 *
 * `java\tscript:alert(1)` and `java\nscript:alert(1)` both navigate. Browsers
 * discard ASCII whitespace and control characters while parsing the scheme, so
 * any check that does not do the same is trivially bypassed. Attribute values
 * arrive already entity-decoded from `getAttribute`, so `&#106;avascript:` is
 * covered by the same normalization.
 */
function normalize(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f-\u00a0]/g, '').toLowerCase()
}

/**
 * Is this URL safe to put in an `href` or `src`?
 *
 * Relative URLs, fragments and query-only URLs are allowed: they cannot carry a
 * scheme, so they cannot execute. Protocol-relative `//host/path` is allowed
 * because it inherits the page's scheme.
 */
export function isSafeUrl(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const candidate = normalize(value)
  if (candidate === '') return false

  const match = SCHEME.exec(candidate)
  // No scheme means relative, fragment or protocol-relative. All are safe.
  if (!match) return true

  return SAFE_SCHEMES.has(match[1] as string)
}

/** The safe URL, or null when it should be dropped. */
export function safeUrlOrNull(value: string | null | undefined): string | null {
  return isSafeUrl(value) ? (value as string) : null
}

/** Attributes whose values are URLs and therefore need checking. */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'cite',
  'longdesc',
  'srcdoc',
  'xlink:href',
  'ping',
])

/** True for `onclick`, `onmouseover` and every other inline event handler. */
export function isEventHandlerAttribute(name: string): boolean {
  return /^on/i.test(name)
}
