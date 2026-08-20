/**
 * URL and attribute-name primitives, re-exported from the shared package.
 *
 * Same shape as `css.ts` and `embed.ts`: one definition lives in
 * `@openleaf-editor/content-policy` and both the editor and the sanitizers
 * import it, rather than each writing its own copy and drifting.
 */
export {
  URL_ATTRIBUTES,
  isEventHandlerAttribute,
  isSafeUrl,
  safeUrlOrNull,
} from '@openleaf-editor/content-policy/url'
