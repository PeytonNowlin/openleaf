/**
 * An opt-in WebMCP tool surface for OpenLeaf.
 *
 * An agent driving the page can ask which OpenLeaf editors are on it and get a
 * stable identifier for each. It contributes nothing to the document format --
 * no nodes, no marks, no toolbar items, no icons, no styles -- so a deployment
 * that does not install it is byte-for-byte the deployment it is today.
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-webmcp.min.js"></script>
 * ```
 */

import { registerEditorPlugin } from '@openleaf-editor/core'
import { resolveModelContext } from './agent.js'
import { agentHandles } from './handles.js'
import { agentRegistry } from './registry.js'
import { agentTools } from './tools.js'

export type { AgentTool, AgentToolAnnotations, AgentToolInputSchema } from './agent.js'
export type { ToolErrorCode } from './result.js'
export { agentTools } from './tools.js'

/**
 * Options for {@link installAgentTools}.
 *
 * Empty today, and a bag rather than a bare call on purpose: the install is the
 * integrator's one hook into this package, so the permission predicate that
 * lets a host allow reads and refuse writes belongs in here. Adding a field to
 * an options object is a smaller change to a published function than adding a
 * parameter to one.
 */
export interface AgentToolsOptions {}

let installed = false

/**
 * Held because aborting this signal is the only way a registered tool goes
 * away: the API exposes no `unregisterTool`, no bulk replace and no clear. It
 * has to be created at registration time, so it is created whether or not
 * anything ever aborts it -- a teardown path cannot be retrofitted onto a
 * registration that was made without a signal.
 */
let teardown: AbortController | undefined

/**
 * Register the agent tool set for this page. Idempotent.
 *
 * The second call is ignored, options and all. A CMS template that includes the
 * bundle on two paths must not try to register the same tool names twice, which
 * the browser rejects with `InvalidStateError: Duplicate tool name`.
 *
 * In a browser with no agent API this is silent: no error, no console output,
 * and no half-wired editor. The editor plugin is still registered, because it
 * is the register and nothing else -- it adds no behaviour, no decorations and
 * no keybindings, and the tool set is a plain value a consumer can drive
 * without any browser API at all. Skipping it would make the package testable
 * only in one flagged engine, which is the failure mode `tools.ts` exists to
 * avoid.
 */
export function installAgentTools(options: AgentToolsOptions = {}): void {
  if (installed) return
  installed = true

  // Two plugins, both per editor and both storage rather than behaviour: the
  // register, which is how a tool finds an editor by name, and the handle
  // table, which is how it finds a place inside one after the document has
  // moved under it.
  registerEditorPlugin(() => [agentRegistry(), agentHandles()])

  const context = resolveModelContext()
  if (!context) return

  teardown ??= new AbortController()
  for (const tool of agentTools) {
    // `registerTool` returns a promise that rejects on a name already taken.
    // The `installed` flag above stops that for a bundle loaded twice, but not
    // for two *copies* of this package on one page. In that case the tools the
    // first copy registered are already there and already work, so the second
    // copy's rejection is nothing an integrator can act on -- and an unhandled
    // rejection reads as a page error, which is exactly the console noise the
    // no-API path above is careful not to produce.
    void context.registerTool(tool, { signal: teardown.signal }).catch(() => {})
  }
}
