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
 * A new tool is its own module beside this one, added to the array below --
 * which is also where the integrator's permission gate is applied, so a tool is
 * gated by having been added rather than by its author remembering to.
 */

import type { AgentTool } from './agent.js'
import { applyCommandTool } from './apply-command.js'
import { findTextTool } from './find-text.js'
import { getCapabilitiesTool } from './get-capabilities.js'
import { getDocumentTool } from './get-document.js'
import { getStructureTool } from './get-structure.js'
import { insertHtmlTool } from './insert-html.js'
import { listEditorsTool } from './list-editors.js'
import { gated } from './permission.js'
import { replaceAtTool } from './replace-at.js'

// In the order an agent works through them: find an editor, ask what it can do,
// read what is in it or map it, find a place inside it, then change what is
// there -- replacing markup, adding markup beside it, or running one of the
// editor's own commands. The browser lists tools in registration order, so this
// is also the order they are offered in -- and the reads coming before the
// writes is the order the task itself has to happen in.
//
// `gated` wraps each descriptor in the host's permission predicate. Mapping it
// over the whole array is what makes "every tool call is gated" a property of
// the set rather than a rule eight handlers have to keep -- including the
// listing, which takes no editor and so has no argument-resolving chokepoint of
// its own to hang a check on.
export const agentTools: readonly AgentTool[] = [
  listEditorsTool,
  getCapabilitiesTool,
  getDocumentTool,
  getStructureTool,
  findTextTool,
  replaceAtTool,
  insertHtmlTool,
  applyCommandTool,
].map(gated)
