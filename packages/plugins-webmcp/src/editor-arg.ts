/**
 * The arguments every tool shares: the `id` naming an editor, and the reading
 * of a string argument out of whatever the agent actually sent.
 *
 * A page-global tool set has no implicit "current editor" -- there are several
 * on the page and nothing focuses one of them -- so naming an editor is the
 * first thing every other call does. Declaring that argument and resolving it
 * once means the tools agree on its name, on its description, and on what an
 * agent is told when it passes a name that is no longer on the page.
 */

import type { AgentToolInputSchema } from './agent.js'
import { findEditor, type RegisteredEditor } from './registry.js'
import { fail } from './result.js'

/** The input schema for a tool whose only argument is which editor to act on. */
export const editorArgument: AgentToolInputSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'The identifier of the editor, as returned by openleaf_list_editors.',
    },
  },
  required: ['id'],
}

/**
 * The same `id` argument, plus a tool's own arguments.
 *
 * Every tool but the listing names an editor, and it has to be spelled the same
 * way on all of them: `openleaf_list_editors` tells an agent to "pass an id
 * back to any other openleaf_* tool", and a tool that quietly called it
 * something else would make that instruction wrong. The editor argument goes
 * first, and is always required.
 */
export function editorArgumentWith(
  properties: AgentToolInputSchema['properties'],
  required: string[] = [],
): AgentToolInputSchema {
  return {
    type: 'object',
    properties: { ...editorArgument.properties, ...properties },
    required: ['id', ...required],
  }
}

/**
 * One string argument, as the agent sent it, or `''` if it sent nothing usable.
 *
 * Every tool has at least one of these and they were being spelled two
 * different ways, which is one way too many for a check this load-bearing:
 * `args` is whatever the agent sent, the browser parses it but nothing checks
 * it against the schema the tool published, so a missing argument, a `null`, an
 * object and a number all arrive here as things that are not strings. Folding
 * them all into the empty string means a tool's guard is one comparison and
 * every tool guards alike. The message stays the tool's own: it is the only
 * place an agent is told what to send instead.
 */
export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Resolve `args.id` and hand the editor to `answer`, or return the failure.
 *
 * `args` is whatever the agent sent. The browser parses it, but nothing checks
 * it against the schema the tool published, so a missing or non-string `id`
 * arrives here rather than being rejected upstream -- and a handler that let
 * that reach the DOM would throw out to the browser, which reaches the agent as
 * a rejected call with no shape to it and nothing to retry against.
 */
export function withEditor(
  args: Record<string, unknown>,
  answer: (editor: RegisteredEditor) => string,
): string {
  const id = stringArg(args, 'id')
  if (id === '') {
    return fail('invalid-argument', 'pass "id", the identifier of an editor from openleaf_list_editors')
  }

  const editor = findEditor(id)
  if (!editor) {
    return fail(
      'unknown-editor',
      `no editor named "${id}" on this page; call openleaf_list_editors again`,
    )
  }

  return answer(editor)
}
