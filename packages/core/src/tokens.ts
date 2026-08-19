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

/** HTML5 ids: no spaces, not empty. */
const ID = /^[^\s]+$/

/** A single class token. */
const CLASS_TOKEN = /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/

/** An `id` the schema will store, or null. */
export function safeId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const candidate = value.trim()
  if (candidate === '' || !ID.test(candidate)) return null
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
    if (token === '' || exclude.has(token) || !CLASS_TOKEN.test(token)) continue
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
