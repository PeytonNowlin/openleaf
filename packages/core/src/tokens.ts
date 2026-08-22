/**
 * Tokens the schema is willing to write onto `id` and `class`.
 *
 * Both attributes are how an author names a thing in the page, and both are
 * how pasted content impersonates the page. The checks here are deliberately
 * syntactic: they refuse characters that would let a value escape the
 * attribute, and they do not try to guess whether a class name is "yours".
 * Which class names a deployment offers in a pick list is an integrator
 * decision; which characters may appear in one is not.
 */

/**
 * HTML5 ids and class tokens: a non-empty run of non-whitespace.
 *
 * Class names are not CSS identifiers. Tailwind (`md:w-1/2`, `p-[10px]`),
 * leading digits (`2col`), and non-ASCII (`größe-mittel`) are legal in HTML
 * and in CSS (with escaping at selector time, which is the site's problem).
 * Restricting tokens to ASCII identifiers silently deleted half of a mixed
 * `class` whenever another token survived the filter -- the modelled write
 * then overrode the residue that would have carried the original string.
 * Policy about *which* classes a deployment stores belongs in sanitize, not
 * here.
 */
const HTML_TOKEN = /^[^\s]+$/

/** An `id` the schema will store, or null. */
export function safeId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const candidate = value.trim()
  if (candidate === '' || !HTML_TOKEN.test(candidate)) return null
  return candidate
}

/**
 * Class tokens the schema will store, or null when none survive.
 *
 * Known alignment classes are stripped here when `exclude` is given, so an
 * image can carry `ol-float-left` as its modelled `align` without also
 * writing it twice in `class`.
 */
export function safeClassList(
  value: string | null | undefined,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  if (value === null || value === undefined) return null
  const kept: string[] = []
  const seen = new Set<string>()
  for (const token of value.trim().split(/\s+/)) {
    if (token === '' || exclude.has(token) || !HTML_TOKEN.test(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    kept.push(token)
  }
  return kept.length > 0 ? kept.join(' ') : null
}

/** Image floats the toolbar can express. Centre is not a float: it is a block. */
export type ImageAlign = 'left' | 'right' | 'center'

export const IMAGE_ALIGNMENTS: readonly ImageAlign[] = ['left', 'right', 'center']

export const IMAGE_ALIGN_CLASS: Readonly<Record<ImageAlign, string>> = {
  left: 'ol-float-left',
  right: 'ol-float-right',
  center: 'ol-align-center',
}

const CLASS_TO_ALIGN = new Map<string, ImageAlign>(
  (Object.entries(IMAGE_ALIGN_CLASS) as Array<[ImageAlign, string]>).map(([align, name]) => [
    name,
    align,
  ]),
)

/** The modelled alignment class in this list, if any. */
export function imageAlignFromClass(value: string | null | undefined): ImageAlign | null {
  if (!value) return null
  for (const token of value.split(/\s+/)) {
    const align = CLASS_TO_ALIGN.get(token)
    if (align) return align
  }
  return null
}

export const IMAGE_ALIGN_CLASSES: ReadonlySet<string> = new Set(Object.values(IMAGE_ALIGN_CLASS))

/*
 * Attribute names the schema is willing to write back.
 *
 * The HTML parser accepts names `setAttribute` refuses. `<p ="v">` parses to one
 * attribute literally named `="v"`, and every engine's `setAttribute` throws
 * `InvalidCharacterError` on it -- so a name the parser produced through error
 * recovery was carried in as residue and then detonated on the way out, in the
 * middle of rendering a document. One stray `=` typed in the source box left the
 * editor blank with no way back, and a stored document containing one could not
 * be loaded at all.
 *
 * This is the XML `Name` production, which is what `setAttribute` validates
 * against. Deliberately the spec's rule rather than the host's: browsers are
 * laxer than the spec for HTML documents and jsdom implements it strictly, so
 * asking the current runtime would accept names in a browser session that then
 * throw on a jsdom server -- the cross-environment divergence this project
 * refuses elsewhere. Being stricter than the strictest runtime is the only test
 * that makes stored content portable.
 *
 * Nothing legal is lost. Every name a document could have meant -- including
 * non-ASCII and namespaced ones -- is a `Name`; the names this rejects exist
 * only because a parser recovered from malformed markup.
 */
const NAME_START =
  'A-Za-z_:' +
  '\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF' +
  '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF' +
  '\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_REST = NAME_START + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040'
const ATTRIBUTE_NAME = new RegExp(`^[${NAME_START}][${NAME_REST}]*$`, 'u')

/**
 * True for a name that can be written back with `setAttribute` anywhere.
 *
 * Used where unmodelled attributes are picked up to be carried through the
 * round trip: an attribute that cannot be written is not content, and refusing
 * it there is what keeps `serializeHtml(parseHtml(x))` from throwing.
 */
export function isWritableAttributeName(name: string): boolean {
  return ATTRIBUTE_NAME.test(name)
}
