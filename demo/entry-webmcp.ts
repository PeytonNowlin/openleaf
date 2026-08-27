/**
 * Entry point for the opt-in agent tool bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and an agent arriving on the page can find the editors. In a browser
 * with no agent API the call is silent, so the tag is safe to ship to everyone.
 *
 * The tool set is hung on the host global as well. It is the seam the whole
 * feature is built around -- a plain value with executable handlers -- and a
 * script-tag integrator has no other way to reach it, the same way
 * `registerSaveHandler` is exposed by the session bundle.
 */
import * as webmcp from '@openleaf-editor/plugins-webmcp'

webmcp.installAgentTools()

const host = globalThis as typeof globalThis & {
  OpenLeaf?: { agentTools?: typeof webmcp.agentTools }
}
if (host.OpenLeaf) host.OpenLeaf.agentTools = webmcp.agentTools
