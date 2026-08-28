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
  /** The named editor is not on the page -- gone, or never there. List again. */
  | 'unknown-editor'
  /** The arguments do not match the schema the tool published. Read it and retry. */
  | 'invalid-argument'
  /**
   * A handle no longer names anything -- the text it pointed at was deleted, or
   * the editor holding it has left the page. The agent's move is to search
   * again, which is why this is not folded into `invalid-argument`.
   */
  | 'stale-handle'
  /**
   * No command of that name is available on that editor -- either the
   * deployment never registered one, or this editor's toolbar layout does not
   * carry it. One code for both, because the agent's next move is the same:
   * read `openleaf_get_capabilities` for that editor, which reports exactly the
   * intersection of the two.
   */
  | 'unknown-command'
  /**
   * The editor offers that command, but it cannot be driven from here: it is a
   * dialog or a control that builds its own interface, with no plain command
   * underneath it. Nothing to retry, and not a mistake in the call.
   */
  | 'unsupported-command'
  /**
   * The range names markup the editor is preserving verbatim. Nothing edits in
   * there -- that is the whole of the byte-identical promise -- so the agent's
   * move is to target text outside it, not to retry.
   */
  | 'preserved-region'
  /**
   * The content did not survive the editor's paste policy: it parsed to nothing
   * a document can hold, or it was nested past the parser's limit. Separate from
   * `invalid-argument` because the arguments were fine; the content was not, and
   * re-reading the schema will not help.
   */
  | 'rejected-content'
  /**
   * The content is allowed and the place is allowed; the pair is not. The
   * document model will not hold that content at that position -- a block
   * inside a sentence, an image inside a code block -- and the alternative to
   * saying so is fitting it into some shape nobody asked for. Separate from
   * `rejected-content` because here the schema is worth re-reading: the way out
   * is to reshape the HTML, or to ask for a handle that names a whole block.
   */
  | 'invalid-position'
  /**
   * The editor would not make the change -- the command does not apply at that
   * position, or the editor is not accepting writes at all. The document is
   * exactly as it was.
   */
  | 'refused'

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
