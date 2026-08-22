/**
 * URL and attribute-name primitives, re-exported from the shared package.
 *
 * Same shape as `css.ts` and `embed.ts`: one definition lives in
 * `@openleaf-editor/content-policy` and both the editor and the sanitizers
 * import it, rather than each writing its own copy and drifting.
 */
import { NEVER_CARRY_ATTRIBUTES, isEventHandlerAttribute } from '@openleaf-editor/content-policy/url'

export {
  NEVER_CARRY_ATTRIBUTES,
  URL_ATTRIBUTES,
  isEventHandlerAttribute,
  isSafeUrl,
  safeUrlOrNull,
} from '@openleaf-editor/content-policy/url'

/**
 * Attributes no policy may re-enable, whatever it says.
 *
 * One predicate, because the reference enforcer and every generated adapter
 * config have to agree about this or the guarantee is only true of whichever one
 * you happen to run. `sanitizeHtml` refusing an attribute while
 * `toDOMPurifyConfig` copies it into `ALLOWED_ATTR` is the cross-runtime
 * divergence this package exists to prevent.
 *
 * The list is content-policy's `NEVER_CARRY_ATTRIBUTES` -- `srcdoc`, `srcset`,
 * `imagesrcset`, `formaction`, `xlink:href` -- plus event handlers and `ping`.
 * `ping` is not in the shared set because content-policy classifies it as a URL
 * attribute and checks it; here there is no value worth keeping, since its only
 * purpose is to fire a background request.
 */
export function isNeverAllowedAttribute(name: string): boolean {
  const lower = name.toLowerCase()
  return isEventHandlerAttribute(lower) || NEVER_CARRY_ATTRIBUTES.has(lower) || lower === 'ping'
}
