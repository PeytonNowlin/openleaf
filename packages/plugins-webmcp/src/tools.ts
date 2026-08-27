/**
 * The tool set, as a plain value.
 *
 * This is the seam the whole feature is built around. `installAgentTools` is a
 * thin wrapper that hands this array to the browser; the tests call these
 * handlers directly, against real editors in a real browser. That keeps the
 * suite independent of a launch flag and of a spec surface that has already
 * been renamed twice, while still exercising every line that does the work.
 *
 * The descriptors close over the page-global editor register rather than over
 * an editor, so building them at module scope touches no DOM -- which is what
 * lets the published entry point import under bare Node.
 *
 * A new tool is its own module beside this one, added to the array below.
 */

import type { AgentTool } from './agent.js'
import { listEditorsTool } from './list-editors.js'

export const agentTools: readonly AgentTool[] = [listEditorsTool]
