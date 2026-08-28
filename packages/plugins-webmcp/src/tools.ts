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
import { findTextTool } from './find-text.js'
import { getCapabilitiesTool } from './get-capabilities.js'
import { getDocumentTool } from './get-document.js'
import { getStructureTool } from './get-structure.js'
import { listEditorsTool } from './list-editors.js'
import { replaceAtTool } from './replace-at.js'

// In the order an agent works through them: find an editor, ask what it can do,
// read what is in it or map it, find a place inside it, then change what is
// there. The browser lists tools in registration order, so this is also the
// order they are offered in -- and the reads coming before the writes is the
// order the task itself has to happen in.
export const agentTools: readonly AgentTool[] = [
  listEditorsTool,
  getCapabilitiesTool,
  getDocumentTool,
  getStructureTool,
  findTextTool,
  replaceAtTool,
]
