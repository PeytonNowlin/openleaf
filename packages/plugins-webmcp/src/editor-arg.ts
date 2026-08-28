/**
 * The `id` argument every tool but the listing takes.
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
  const id = args['id']
  if (typeof id !== 'string' || id === '') {
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
