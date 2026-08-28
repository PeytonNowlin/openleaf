/**
 * The integrator's veto over every tool call.
 *
 * Installing this package is already a decision, but it is a coarse one: it
 * offers an agent the whole set or none of it. A host that wants an agent to
 * read its documents and not rewrite them, or to touch the draft editor and not
 * the published one, has nowhere to say so short of forking the package. This
 * is that place.
 *
 * The predicate is **synchronous and answers with a boolean**, deliberately.
 * The proposal's `requestUserInteraction` is the mechanism an "ask the person
 * first" flow would be built on, and it is not something the shipping
 * implementation can be relied on for; a consent model that stages a change as
 * a reviewable diff is a substantially larger feature than a veto. So this asks
 * a question the host can answer out of what it already knows -- who is signed
 * in, which editor this is, whether the document is locked -- and nothing else.
 *
 * The gate wraps the descriptors rather than living inside the handlers, which
 * is what makes it impossible for a later tool to be added without one. See
 * `gated` below and the array in `tools.ts`.
 */

import type { AgentTool } from './agent.js'
import { fail } from './result.js'

/** What the host is told about a call before it happens. */
export interface AgentToolCall {
  /** The tool being called, e.g. `'openleaf_replace_at'`. */
  readonly tool: string
  /**
   * The editor the call names, or `null` for `openleaf_list_editors` -- the one
   * tool that takes no editor, because it is where an identifier comes from.
   *
   * This is the identifier as the agent sent it, not a resolved editor: the
   * decision is asked before anything is looked up, so a host is never handed a
   * half-started call. An id naming an editor that is not on the page arrives
   * here as the string the agent sent, and is answered by the tool as
   * `unknown-editor` if the host allows it through.
   */
  readonly editor: string | null
  /**
   * Whether the call only reads. The tool's own `readOnlyHint` annotation --
   * the same flag the client driving the agent reads -- so that
   * `({ readOnly }) => readOnly` is the whole of "allow reads, refuse writes"
   * and stays correct when a tool is added.
   */
  readonly readOnly: boolean
}

/**
 * Whether a call may proceed. `true` allows it; anything else refuses it.
 *
 * Called on every tool call, before any argument is validated and before
 * anything is looked up, so a refusal cannot be a partial anything.
 */
export type AgentPermission = (call: AgentToolCall) => boolean

/**
 * Module state rather than a closure, because the tool descriptors are built at
 * module scope and the host's decision arrives later -- at install, or from a
 * script tag after the bundle has already installed itself. Read at call time,
 * so the order of the two does not matter.
 */
let permission: AgentPermission | null = null

/**
 * Install the predicate that gates every tool call, or `null` to clear it.
 *
 * Usually reached as `installAgentTools({ allowTool })`, which is where an
 * integrator with a bundler puts it. This is the same setting on its own, for
 * the script-tag build: that bundle installs on load, so by the time an
 * integrator's code runs, `installAgentTools` has already been called and
 * ignores a second one. It is hung on `OpenLeaf` by the bundle entry point, the
 * same way the session bundle exposes `registerSaveHandler`.
 *
 * Last writer wins. Any script on the page can call it -- and any script on the
 * page can call the tools themselves through `agentTools`, so this is not a
 * boundary that was holding anything before.
 */
export function registerAgentPermission(allowTool: AgentPermission | null): void {
  permission = allowTool
}

/**
 * The same tool, with the host's veto in front of it.
 *
 * Every descriptor goes through here on its way into `agentTools`, which is the
 * point: the gate is applied where the set is composed, not inside each
 * handler, so a tool added later is gated by having been added at all. There is
 * no line for its author to forget to write. `test/permission.test.ts` asserts
 * it of every tool in the set rather than of a list of names, so the invariant
 * fails loudly if a later tool ever reaches the array ungated.
 *
 * With no predicate installed this costs one property read and a call, and
 * every tool behaves exactly as it did before this existed.
 */
export function gated(tool: AgentTool): AgentTool {
  return {
    ...tool,
    execute(args) {
      if (permission) {
        const id = args['id']
        let allowed: boolean
        try {
          allowed = permission({
            tool: tool.name,
            editor: typeof id === 'string' && id !== '' ? id : null,
            readOnly: tool.annotations.readOnlyHint,
          })
        } catch {
          // A host predicate that throws has not said yes, and the safe reading
          // of "did not say yes" on a write path is no. Reporting the thrown
          // message back would hand an agent the host's internals; reporting
          // nothing at all -- letting the throw out -- reaches it as a rejected
          // call with no shape to it, which is what every result here exists to
          // avoid. So it refuses, in the same words a deliberate refusal uses.
          allowed = false
        }
        if (!allowed) {
          return fail(
            'refused',
            `this page does not allow ${tool.name} here. Nothing was read or ` +
              "changed. That is the site's own policy, not a mistake in the " +
              'call, so retrying it will not help.',
          )
        }
      }
      return tool.execute(args)
    },
  }
}
