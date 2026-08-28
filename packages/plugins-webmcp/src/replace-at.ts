/**
 * `openleaf_replace_at` -- the first tool that changes a document.
 *
 * Everything that makes an agent write safe lives in `write.ts`, because three
 * more tools are about to need the same guarantees. What is here is only what
 * is particular to replacing: the arguments, what the agent is told about them,
 * and the one line that turns parsed content into a transaction.
 */

import type { AgentTool } from './agent.js'
import { editorArgumentWith } from './editor-arg.js'
import { fail } from './result.js'
import { agentSlice, handleArgument, writeAt } from './write.js'

const NAME = 'openleaf_replace_at'

export const replaceAtTool: AgentTool = {
  name: NAME,
  title: 'Replace text in an OpenLeaf editor',
  description:
    'Replace the text one handle names with HTML. Returns JSON: ' +
    '{"ok":true,"id":string}. The HTML goes through the same policy a person\'s ' +
    'paste does: what that strips is stripped here, and HTML it leaves nothing ' +
    'of is refused rather than written. A range covering markup the editor ' +
    'preserves verbatim is refused with "preserved-region". The change is one ' +
    'undoable step and it spends the handle -- search again with ' +
    'openleaf_find_text before editing that passage twice.',
  inputSchema: editorArgumentWith(
    {
      ...handleArgument,
      html: {
        type: 'string',
        description: 'The HTML to put in place of the text the handle names.',
      },
    },
    ['handle', 'html'],
  ),
  annotations: {
    // The first tool in the set that is not read-only, which is what tells the
    // client driving the agent that this is the call to ask a person about.
    readOnlyHint: false,
    // Nothing of the document comes back -- an id and a flag. A write tool that
    // returned the new document would be handing the agent the untrusted text
    // it was meant to be editing.
    untrustedContentHint: false,
  },
  execute(args) {
    const html = args['html']
    if (typeof html !== 'string' || html === '') {
      // An empty string is refused rather than treated as a deletion. A model
      // whose template rendered nothing sends exactly that, and "replace" is
      // not a word anyone reads as "delete"; erasing a passage on the strength
      // of an ambiguous argument is not a mistake this tool gets to make.
      return fail(
        'invalid-argument',
        'pass "html", the content to put in place of the text the handle names',
      )
    }

    return writeAt(NAME, args, (target) => {
      const slice = agentSlice(html, target)
      if (typeof slice === 'string') return slice
      // `replaceRange` rather than a bare replace, because it is what a paste
      // goes through: it decides how far to open the content to fit where it is
      // landing, so the same HTML behaves the same way from either direction.
      return target.editor.view.state.tr.replaceRange(target.from, target.to, slice)
    })
  },
}
