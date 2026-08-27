/**
 * Tool results, as JSON encoded into the string `executeTool` resolves to.
 *
 * The browser's execute path returns a string and nothing else -- measured, not
 * assumed -- so structure has to be encoded into it. One envelope for every
 * tool, so an agent can branch on `ok` before it reads anything else, and every
 * tool's `description` states the shape it puts inside.
 *
 * A handler never throws out to the browser. A thrown error reaches the agent
 * as a rejected call with no shape to it, which is exactly the "retry sensibly"
 * case a failure result exists for.
 */

/**
 * Why a call did not happen.
 *
 * A short stable token the agent can branch on, alongside a `message` a model
 * can read. Deliberately not an HTTP-shaped number: the agent's next move
 * differs per case, and `404` does not say "list the editors again".
 */
export type ToolErrorCode =
  /** No editor of that name is on the page. List them again; do not guess. */
  | 'unknown-editor'
  /** The call was malformed: a required argument missing, empty, or not a string. */
  | 'invalid-argument'
  /**
   * A handle no longer names anything -- the text it pointed at was deleted, or
   * the editor holding it has left the page. The agent's move is to search
   * again, which is why this is not folded into `invalid-argument`.
   */
  | 'stale-handle'

/**
 * A success: the payload, carrying `"ok": true`.
 *
 * The flag is spread last so a payload field of the same name cannot invert the
 * answer an agent branches on before it reads anything else.
 */
export function ok(payload: Record<string, unknown>): string {
  return JSON.stringify({ ...payload, ok: true })
}

/** `{"ok":false,"error":"<code>","message":"<what to do about it>"}` */
export function fail(error: ToolErrorCode, message: string): string {
  return JSON.stringify({ ok: false, error, message })
}
