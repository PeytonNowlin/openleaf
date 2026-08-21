/**
 * The one error type OpenLeaf throws on purpose.
 *
 * Before this there were four styles and no way to tell them apart: `parseHtml`
 * coerced anything to an empty document, `serializeHtml(null)` surfaced a raw
 * ProseMirror `TypeError` with nothing naming OpenLeaf in it, a bad
 * `registerEditorPlugin` argument was accepted and failed much later through
 * `console.error`, and a schema collision threw on some unrelated later call.
 * A `catch` block could not distinguish "the integrator passed the wrong thing"
 * from "the library has a bug", so integrators either swallowed everything or
 * nothing.
 *
 * `code` is the stable part. Messages are for people and may be reworded; the
 * code is what a `catch` should switch on.
 */

export type OpenLeafErrorCode =
  /** A public function was called with a value it cannot accept. */
  | 'invalid-argument'
  /** Input nests deeper than the recursive DOM walks can survive. */
  | 'depth-limit'
  /** Two schema extensions define the same node or mark name. */
  | 'schema-conflict'
  /** No `Document` was available and none was supplied. */
  | 'no-document'

export class OpenLeafError extends Error {
  readonly code: OpenLeafErrorCode

  constructor(code: OpenLeafErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    // Set explicitly rather than via a class field: a field would be an own
    // property on every instance, and `name` is conventionally read off the
    // prototype chain by anything formatting an error.
    this.name = 'OpenLeafError'
  }
}

/**
 * A duck check rather than `instanceof`.
 *
 * Two copies of `@openleaf-editor/core` on one page -- which the plugin bundles
 * exist to prevent but a mis-pinned install still produces -- have two distinct
 * `OpenLeafError` classes, and `instanceof` is false across them. The code is
 * what callers actually branch on, so that is what this checks.
 */
export function isOpenLeafError(value: unknown, code?: OpenLeafErrorCode): boolean {
  if (!(value instanceof Error) || value.name !== 'OpenLeafError') return false
  return code === undefined || (value as OpenLeafError).code === code
}
