/**
 * The write path: the one place in this package that changes a document.
 *
 * Every tool that edits goes through `writeAt`, and that is a design decision
 * rather than tidiness. A write has four ways to be wrong before it has any way
 * to be right -- the handle is spent, the handle belongs to another editor, the
 * range covers markup the editor promised to hand back untouched, the content
 * does not survive the paste policy -- and each of those has to answer with the
 * document exactly as it was. A second tool that re-derived those checks would
 * eventually differ from this one in a case nobody thought to test, and the
 * case it differed in would be a write to the wrong place.
 *
 * Two orderings in here are load-bearing:
 *
 *   - Sanitize, THEN parse. The preservation layer is a catch-all: markup the
 *     schema does not recognize is wrapped and kept rather than rejected. Hand
 *     it agent HTML directly and hostile or malformed input becomes an opaque
 *     atom the document then carries faithfully forever -- preserved *because*
 *     it was unparseable. Running the paste policy first means an agent can put
 *     nothing into the document that a person could not have pasted into it.
 *   - Check, THEN build. Nothing here touches the view until every refusal has
 *     been ruled out, so a failed call is not a partial write; it is not a
 *     write at all.
 */

import { parseHtml } from '@openleaf-editor/core'
import { normalizePastedHtml } from '@openleaf-editor/paste'
import { Slice, type Node as PMNode } from 'prosemirror-model'
import { PluginKey, type Transaction } from 'prosemirror-state'
import type { AgentToolInputSchema } from './agent.js'
import { withEditor } from './editor-arg.js'
import { resolveHandle } from './handles.js'
import type { RegisteredEditor } from './registry.js'
import { fail, ok } from './result.js'

/**
 * The marker every transaction this package dispatches carries.
 *
 * A `PluginKey` rather than a bare string, which is the repo's convention for
 * transaction metadata a feature owns -- autolink and the isolating-selection
 * guard both key off their own plugin key -- and it is what keeps this marker
 * from colliding with a host's own metadata on a page nobody here controls.
 *
 * It is deliberately not attached to any plugin. Nothing needs to *hold* state
 * for it; what it names is "this change came from an agent, not from the
 * person", which a transaction either carries or does not.
 */
export const agentKey = new PluginKey('openleaf-webmcp')

/** What the marker carries: which tool made the change. */
export interface AgentEdit {
  tool: string
}

/**
 * Mark a transaction as agent-originated.
 *
 * Exported for the tools that cannot hand `writeAt` a finished transaction --
 * a command applied through the toolbar registry dispatches its own -- so that
 * there is still exactly one place that knows what the marker looks like.
 */
export function markAgent(tr: Transaction, tool: string): Transaction {
  const edit: AgentEdit = { tool }
  return tr.setMeta(agentKey, edit)
}

/**
 * The `handle` argument every write tool takes, so all of them describe it
 * alike -- and so that widening it when another tool starts issuing handles is
 * one edit rather than one per write tool.
 */
export const handleArgument: AgentToolInputSchema['properties'] = {
  handle: {
    type: 'string',
    description:
      'An opaque handle for the text to act on, from openleaf_find_text or ' +
      'openleaf_get_structure.',
  },
}

/** A range a write may act on: already resolved, already checked. */
export interface AgentTarget {
  editor: RegisteredEditor
  from: number
  to: number
}

/**
 * Resolve a write's target, refuse it or dispatch it -- once.
 *
 * `change` is called only with a range it is allowed to write to, and it
 * returns either the transaction to dispatch or a `fail()` string to hand back
 * unchanged. Returning the transaction rather than dispatching it is what makes
 * "exactly one transaction per call" a property of this function instead of a
 * rule each tool has to keep: there is one `dispatch` in the package, and it is
 * below.
 */
export function writeAt(
  tool: string,
  args: Record<string, unknown>,
  change: (target: AgentTarget) => Transaction | string,
): string {
  return withEditor(args, (editor) => {
    const handle = args['handle']
    if (typeof handle !== 'string' || handle === '') {
      return fail(
        'invalid-argument',
        'pass "handle", a handle from openleaf_find_text or openleaf_get_structure ' +
          'naming the text to act on',
      )
    }

    const found = resolveHandle(handle)
    if (!found.ok) return fail(found.error, found.message)
    if (found.editor !== editor) {
      // The handle alone would have been enough to find the editor -- handles
      // are page-unique. Requiring the id as well is what turns an agent that
      // has muddled two editors' handles into a refusal rather than into a
      // correct-looking write to the document it did not mean.
      return fail(
        'invalid-argument',
        `that handle names text in "${found.editor.id}", not in "${editor.id}"; ` +
          'search the editor you meant with openleaf_find_text',
      )
    }

    const { from, to } = found
    if (touchesPreserved(editor.view.state.doc, from, to)) {
      return fail(
        'preserved-region',
        'that range covers markup the editor preserves verbatim and hands back ' +
          'byte-identical; nothing edits inside it. Target text outside it.',
      )
    }

    const built = change({ editor, from, to })
    if (typeof built === 'string') return built

    editor.view.dispatch(markAgent(built, tool))
    return ok({ id: editor.id })
  })
}

/**
 * Agent HTML, sanitized and then parsed, fitted to the range it is going into.
 *
 * One call from "a string an agent sent" to "content this range can hold",
 * because every step between the two is a place to get it wrong and none of
 * them is particular to one tool. Returns a `fail()` string rather than
 * throwing, and rather than an empty slice: "the policy left nothing" is an
 * answer an agent can act on, while an empty slice handed back to a caller is a
 * silent deletion of whatever the range held.
 */
export function agentSlice(html: string, target: AgentTarget): Slice | string {
  const { state } = target.editor.view

  // The same call `transformPastedHTML` makes, so what an agent may write is
  // exactly what a person may paste -- one policy, not a second one that drifts.
  const sanitized = normalizePastedHtml(html)

  let parsed: PMNode
  try {
    parsed = parseHtml(sanitized, { schema: state.schema })
  } catch {
    // `parseHtml` throws past 500 levels of nesting. A throw out of a handler
    // reaches the agent as a rejected call with no shape to it and nothing to
    // retry against, which is the one thing every result in this package exists
    // to avoid.
    return fail(
      'rejected-content',
      'that HTML is nested too deeply for the editor to parse; send something flatter',
    )
  }

  if (nothingLeft(parsed)) {
    // Content an author could not paste is content an agent cannot write, and
    // this is what that looks like from the far end: the policy ran, and what
    // came out the other side was nothing a document can hold.
    return fail(
      'rejected-content',
      "nothing in that HTML survived the editor's paste policy: it holds no text " +
        'and no content this editor can store',
    )
  }

  // A handle comes in two shapes and the same HTML has to be right for both.
  // A search hands back an inline range inside one textblock; an outline hands
  // back a whole block's node range, boundary tokens included. The
  // discriminator is the range itself: only an inline one resolves to a
  // textblock at both ends with the same parent at each.
  const $from = state.doc.resolve(target.from)
  const inline = $from.parent.isTextblock && $from.parent === state.doc.resolve(target.to).parent

  // A model asked for a sentence answers with `<p>a sentence</p>`, and so does
  // the HTML parser given bare text. Dropped into an inline range as a block,
  // that wrapper splits the paragraph the agent was editing in two -- which is
  // not what it asked for and not what the same content pasted there would do.
  // So a lone paragraph going into a run of inline text contributes its
  // contents and not itself. A heading, a list or a quote is structure the
  // agent chose, and stays a block -- as does everything replacing a block
  // range, where a paragraph is the block the agent is asking for.
  const only = parsed.childCount === 1 ? parsed.firstChild : null
  if (inline && only?.type.name === 'paragraph') return new Slice(only.content, 0, 0)

  // Open depths of zero, the same slice `insertHtml` builds: `replaceRange`
  // opens it as far as the destination needs.
  return new Slice(parsed.content, 0, 0)
}

/**
 * True when a parse produced nothing worth writing.
 *
 * Not `content.size === 0`: the document type is `block+`, so a parse of
 * markup that was entirely dropped still comes back as one empty paragraph.
 * The question is whether anything visible survived, which is text or a leaf --
 * an image, a rule, a preserved atom.
 */
function nothingLeft(doc: PMNode): boolean {
  if (doc.textContent !== '') return false
  let leaf = false
  doc.descendants((node) => {
    if (node.isLeaf && !node.isText) leaf = true
    return !leaf
  })
  return !leaf
}

/**
 * The document-model spelling of "inside preserved markup".
 *
 * `isInsidePreserved` in core answers for a DOM element, which is the right
 * question at parse and serialize time and the wrong one here -- a tool has a
 * range, not an element. The model's answer is these two node types: markup the
 * schema did not recognize is stored as an atom carrying its own HTML, and
 * those atoms are what the byte-identical promise is made about.
 */
const PRESERVED = new Set(['unknown_block', 'unknown_inline'])

/**
 * `nodesBetween` reports every node the range overlaps *and* every ancestor of
 * it, so one walk answers both "the range contains preserved markup" and "the
 * range is inside some". The second is unreachable through today's handles --
 * a preserved atom holds no positions, so nothing can point inside one -- but
 * it costs nothing to have the walk answer both, and a later way of naming a
 * range should not be able to reopen the question.
 */
function touchesPreserved(doc: PMNode, from: number, to: number): boolean {
  let preserved = false
  doc.nodesBetween(from, to, (node) => {
    if (PRESERVED.has(node.type.name)) preserved = true
    return !preserved
  })
  return preserved
}
