/**
 * `openleaf_insert_html` -- adding content beside a handle rather than over it.
 *
 * The sibling of `openleaf_replace_at`, and everything the two share is in
 * `write.ts`: one transaction, marked as the agent's; a refusal before anything
 * is touched; the same paste policy over the HTML. What is here is the one
 * question insertion asks and replacement does not.
 *
 * Replacement is fitted to the range it lands in -- `replaceRange` opens the
 * content as far as it has to and splits what it has to -- and that is right
 * for a call whose whole meaning is "this text becomes that". An insertion has
 * no such licence: an agent that asks for a heading in the middle of a sentence
 * has asked for something the schema does not allow, and the fitting that
 * serves replacement would answer it by splitting the paragraph in two, or by
 * quietly keeping the words and dropping the heading. Either way the agent is
 * told the call succeeded and reads back a document nobody asked for. So the
 * schema is asked first, and an insertion it will not accept is a failure that
 * names what the position holds.
 */

import type { ResolvedPos } from 'prosemirror-model'
import type { AgentTool } from './agent.js'
import { editorArgumentWith } from './editor-arg.js'
import { fail } from './result.js'
import { agentSlice, handleArgument, writeAt } from './write.js'

const NAME = 'openleaf_insert_html'

export const insertHtmlTool: AgentTool = {
  name: NAME,
  title: 'Insert HTML into an OpenLeaf editor',
  description:
    'Insert HTML before or after the text one handle names, leaving that text ' +
    'in place; "position" is "before" or "after". Returns JSON: ' +
    '{"ok":true,"id":string}. The HTML goes through the same policy a person\'s ' +
    'paste does, which drops a space at either edge of it; use &nbsp; for one. ' +
    'Content the position cannot hold is refused with ' +
    '"invalid-position" rather than reshaped: a handle from openleaf_find_text ' +
    'names inline text and takes inline HTML, one from openleaf_get_structure ' +
    'names a whole block and takes blocks. The handle survives the insertion.',
  inputSchema: editorArgumentWith(
    {
      ...handleArgument,
      html: {
        type: 'string',
        description: 'The HTML to insert.',
      },
      position: {
        type: 'string',
        description: '"before" or "after" the text the handle names.',
      },
    },
    ['handle', 'html', 'position'],
  ),
  annotations: {
    // A write, so the client driving the agent can decide this is a call to put
    // to a person -- and nothing of the document comes back, so there is no
    // untrusted content in the answer.
    readOnlyHint: false,
    untrustedContentHint: false,
  },
  execute(args) {
    const html = args['html']
    if (typeof html !== 'string' || html === '') {
      return fail('invalid-argument', 'pass "html", the content to insert')
    }

    // Required rather than defaulted to one end. "Insert at this heading" means
    // opposite things to an agent writing an introduction and one writing a
    // section, and guessing which would be wrong half the time silently.
    const position = args['position']
    if (position !== 'before' && position !== 'after') {
      return fail(
        'invalid-argument',
        'pass "position": "before" or "after" the text the handle names',
      )
    }

    return writeAt(NAME, args, (target) => {
      // The whole handle range is what `writeAt` has already checked for
      // preserved markup, which is stricter than the point being written to and
      // deliberately so: inserting against the edge of an atom the editor
      // promises to hand back byte-identical is not a thing to allow on the
      // grounds that the position is technically outside it.
      const slice = agentSlice(html, target)
      if (typeof slice === 'string') return slice

      const { state } = target.editor.view
      const at = position === 'before' ? target.from : target.to
      const $at = state.doc.resolve(at)

      // The question the fitting would otherwise answer by improvising. `index`
      // is where in the parent the content would go, so this is exactly "may
      // these nodes sit here, with these marks, in this parent" -- which
      // catches a block aimed into a paragraph, an image aimed into a code
      // block, and a marked-up run aimed somewhere marks are not allowed.
      if (!$at.parent.canReplace($at.index(), $at.index(), slice.content)) return wontFit($at)

      const tr = state.tr.insert(at, slice.content)
      // A transaction with no steps would still dispatch, and would still leave
      // `writeAt` a new state object to compare against -- so it would be
      // reported as a write that happened. Unreachable while the check above
      // holds, which is the point: this is what makes that "unreachable" true
      // rather than assumed.
      if (tr.steps.length === 0) return wontFit($at)
      return tr
    })
  },
}

/**
 * The refusal, naming what the position can hold.
 *
 * The content expression (`inline*`, `block+`, `text*`) is the schema's own
 * answer and the most useful thing to hand back: an agent that reads it knows
 * whether to reshape the HTML or to ask for a different handle, which is the
 * two ways out of this failure.
 */
function wontFit($at: ResolvedPos): string {
  return fail(
    'invalid-position',
    `that HTML cannot go there: a "${$at.parent.type.name}" holds ` +
      `${$at.parent.type.spec.content ?? 'nothing'}. Send inline HTML at a handle from ` +
      'openleaf_find_text, or whole blocks at one from openleaf_get_structure. ' +
      'Nothing was inserted.',
  )
}
