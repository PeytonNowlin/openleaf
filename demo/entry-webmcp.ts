/**
 * Entry point for the opt-in agent tool bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and an agent arriving on the page can find the editors. In a browser
 * with no agent API the call is silent, so the tag is safe to ship to everyone.
 *
 * Two things are hung on the host global, because installing on load is also
 * what takes the options argument away from a script-tag integrator -- by the
 * time their own code runs, `installAgentTools` has been called and a second
 * call is ignored. Both follow the way `registerSaveHandler` is exposed by the
 * session bundle:
 *
 *   - `agentTools`, the seam the whole feature is built around -- a plain value
 *     with executable handlers, which a script tag has no other way to reach.
 *   - `registerAgentPermission`, which is `installAgentTools({ allowTool })` on
 *     its own. Without it the permission gate would be reachable only from a
 *     bundler build, and "allow reads, refuse writes" is exactly the decision a
 *     CMS integrator dropping in a script tag wants to make. It is set-once and
 *     non-clearing for the reason it is here at all: it is on a global anything
 *     on the page can reach, so a second caller must not be able to replace the
 *     integrator's policy or take it off.
 */
import * as webmcp from '@openleaf-editor/plugins-webmcp'

webmcp.installAgentTools()

const host = globalThis as typeof globalThis & {
  OpenLeaf?: {
    agentTools?: typeof webmcp.agentTools
    registerAgentPermission?: typeof webmcp.registerAgentPermission
  }
}
if (host.OpenLeaf) {
  host.OpenLeaf.agentTools = webmcp.agentTools
  host.OpenLeaf.registerAgentPermission = webmcp.registerAgentPermission
}
