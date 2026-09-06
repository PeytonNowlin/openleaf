/**
 * `openleaf_list_editors` -- what an agent calls first.
 *
 * Every other tool takes an editor identifier, so this is the one call that
 * needs none, and the only way to learn a name that the rest of the surface
 * will accept.
 */

import type { AgentTool } from './agent.js'
import { listEditors } from './registry.js'
import { ok } from './result.js'

export const listEditorsTool: AgentTool = {
  name: 'openleaf_list_editors',
  title: 'List OpenLeaf editors',
  description:
    'List the OpenLeaf rich text editors on this page. Returns JSON: ' +
    '{"ok":true,"editors":[{"id":string,"label":string|null}]}. Pass an "id" ' +
    'back to any other openleaf_* tool to act on that editor. An editor ' +
    'removed from the page stops appearing here, so list again rather than ' +
    'reusing an id from an earlier task.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: {
    readOnlyHint: true,
    // The label is authored page chrome, not document content. Nothing an
    // author typed into an editor can reach an agent through this call.
    untrustedContentHint: false,
  },
  execute() {
    return ok({
      editors: listEditors().map((editor) => ({
        id: editor.id,
        // The accessible name the integrator gave the editor, which is what
        // distinguishes two editors whose identifiers are both ordinals.
        label: editor.host.getAttribute('aria-label'),
      })),
    })
  },
}
