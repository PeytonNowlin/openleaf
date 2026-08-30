/**
 * The write path: the one place in this package that changes a document.
 *
 * Every tool that edits goes through here, and that is a design decision rather
 * than tidiness. A write has half a dozen ways to be wrong before it has any
 * way to be right -- the handle is spent, the handle belongs to another editor,
 * the editor is readonly, its author has the HTML source view open, the range
 * covers markup the editor promised to hand back untouched, the content does
 * not survive the paste policy -- and each of those has to answer with the
 * document exactly as it was. A second tool that re-derived those checks would
 * eventually differ from this one in a case nobody thought to test, and the
 * case it differed in would be a write to the wrong place. `writeAt` is the
 * whole path for a tool that can hand over a finished transaction;
 * `refuseWrite` is the same guards on their own, for the one tool that cannot.
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
import { detectSource, normalizeGeneric, normalizePastedHtml } from '@openleaf-editor/paste'
import { closeHistory } from 'prosemirror-history'
import { Slice, type Node as PMNode } from 'prosemirror-model'
import { PluginKey, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { AgentToolInputSchema } from './agent.js'
import { stringArg, withEditor } from './editor-arg.js'
import { resolveHandle } from './handles.js'
import type { RegisteredEditor } from './registry.js'
import { fail, ok } from './result.js'
import { refuseInSourceMode } from './source-mode.js'

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
 *
 * Two things need that and neither can be retrofitted onto an unmarked write.
 * The author's undo has to reverse one agent action per press rather than
 * whatever fell inside `prosemirror-history`'s time window -- agent calls
 * arrive in a burst, so elapsed time is exactly the wrong thing to group on --
 * and anything watching the document has to be able to tell an edit the author
 * made from one made on their behalf.
 */
export const agentKey = new PluginKey('openleaf-webmcp')

/**
 * What the marker carries: the name of the tool the agent called.
 *
 * The tool name, and not something a tool happens to have in hand at the point
 * it dispatches. `openleaf_apply_command` used to mark the id of the *command*
 * it ran -- `{ tool: 'bold' }` -- which made the field mean one thing on one
 * write path and something else on another, and left a reader of a marked
 * transaction with no way to know which. The tool name is the value every write
 * path has, it is the string the agent actually called and the one this
 * package's own documentation names, and it is page-global where a command id
 * is not: `registerToolbarItem` is last-wins, so `bold` may be an integrator's
 * command rather than the built-in one. A tool that wants to report which
 * command it ran does that in its result, where the agent reads it.
 */
export interface AgentEdit {
  tool: string
}

/** Mark a transaction as agent-originated. Private: `dispatchAgent` is the door. */
function markAgent(tr: Transaction, tool: string): Transaction {
  const edit: AgentEdit = { tool }
  return tr.setMeta(agentKey, edit)
}

/**
 * The document each editor was left holding by this package's last write.
 *
 * Identity rather than a flag, and that is what makes "consecutive" mean the
 * right thing. A `doc` node is replaced only by a transaction that changed the
 * document, so `view.state.doc === lastWrite.get(view)` says precisely "nothing
 * has edited this document since the agent last did" -- without being fooled by
 * the caret moves, focus changes and step-free transactions that pass through
 * an editor a person is sitting in front of, and without asking the clock.
 *
 * Keyed by the view because the view is the object that survives a
 * reconfigure -- the plugin views around it do not, which is the same reason
 * the register holds identifiers per host rather than in a closure -- and weak
 * so that an editor leaving the page takes its entry with it.
 */
const lastWrite = new WeakMap<EditorView, PMNode>()

/** One millisecond after the epoch: as old as a timestamp gets without meaning "none". */
const EPOCH = 1

/**
 * Join this write to the agent's previous one, or open a new undo event.
 *
 * `prosemirror-history` groups by elapsed time and adjacency, and both are the
 * wrong question about an agent. Tool calls arrive in a burst, so a restructure
 * that touched six paragraphs would collapse into one step or fragment into six
 * depending on how quickly the model answered and how far apart the paragraphs
 * were -- and the author who watched it happen would have no way to know how
 * many times to press undo. The marker is the right question: one run of
 * consecutive agent writes is one thing the author asked for, and one press
 * takes it back. A slow agent gets the same answer as a fast one.
 *
 * Three mechanisms, and they are not three spellings of the same trick. Each
 * closes one edge of the run.
 *
 *   - `appendedTransaction` is the metadata `EditorState.applyTransaction`
 *     leaves on a plugin's appended transaction, and history reads it as "this
 *     belongs to the event already in progress" no matter how long ago that
 *     event started. `core/src/autolink.ts` uses it for the same reason. It is
 *     what holds the run together, and it is why a slow agent groups.
 *   - `closeHistory` on the FIRST write of a run stops the run reaching
 *     backwards. Without it the opening write is subject to the ordinary time
 *     window, so a write landing next to a sentence the author had just typed
 *     would be merged into the author's event -- and undoing the agent would
 *     take the person's own work with it. It is also what makes a human edit
 *     *between* two agent writes break the run: the write after it opens a
 *     fresh event instead of reopening the one before.
 *   - `setTime(EPOCH)` stops the run reaching forwards, and it is the half that
 *     is easy to miss. History remembers the timestamp of the last transaction
 *     it grouped; the author's next keystroke starts a new event only if that
 *     timestamp is more than `newGroupDelay` old, or if the keystroke is not
 *     adjacent to it. An agent write is neither of those things -- it happened
 *     just now, and the author's caret is very often exactly where it landed --
 *     so the first thing they typed afterwards would join the agent's event and
 *     be undone with it. Dating the transaction to the epoch says the true
 *     thing to the only mechanism that asks: as far as *time-based* grouping
 *     goes, this write is ancient, and nothing may coalesce with it on the
 *     strength of having happened soon after. It is not zero, because history
 *     reads a zero timestamp as "no previous event" and would then refuse to
 *     append the rest of the run.
 */
function groupWithRun(tr: Transaction, view: EditorView): Transaction {
  const dated = tr.setTime(EPOCH)
  if (lastWrite.get(view) === view.state.doc) return dated.setMeta('appendedTransaction', dated)
  return closeHistory(dated)
}

/**
 * Dispatch an agent transaction: marked, grouped, and checked that it landed.
 *
 * The one `dispatch` in this package. `writeAt` covers every tool that can hand
 * over a finished transaction, but `openleaf_apply_command` cannot -- it runs
 * the editor's own command and dispatches what that produced -- so the marker,
 * the undo grouping and the did-it-land check live one level below `writeAt`,
 * where both paths reach them. A tool that dispatched for itself would be
 * ungrouped and unmarked, and neither omission shows up in a diff.
 *
 * Answers whether the change actually landed. The editor gets the last word
 * even after every guard above agreed: a `filterTransaction` -- core's,
 * honouring stored `contenteditable="false"`, or one an integrator added --
 * drops a transaction silently and leaves the state object identical. Reporting
 * success there would be reporting a write that did not happen.
 */
export function dispatchAgent(editor: RegisteredEditor, tr: Transaction, tool: string): boolean {
  const { view } = editor
  const before = view.state
  view.dispatch(groupWithRun(markAgent(tr, tool), view))
  if (view.state === before) return false
  // Recorded only on a write that landed. A dropped transaction added nothing
  // to the history, so treating the next write as its continuation would append
  // it to whatever event the author's own last edit opened.
  lastWrite.set(view, view.state.doc)
  return true
}

/** The refusal a dropped dispatch answers with, in one place because two paths use it. */
export const dispatchRefused = (): string =>
  fail('refused', 'the editor refused that change: that text is locked.')

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
 * The range a write is aimed at, or the refusal that stops it before it starts.
 *
 * Split out of `writeAt` for the one tool that cannot hand back a finished
 * transaction: `openleaf_apply_command` has to know which range it is working
 * on before it can decide whether the command it was given exists on that
 * editor's bar. Both callers ask these three questions in this order, which is
 * what keeps "a handle from another editor is a refusal" true of every write
 * tool rather than of whichever one remembered it.
 */
export function targetFor(
  args: Record<string, unknown>,
  editor: RegisteredEditor,
): AgentTarget | string {
  const handle = stringArg(args, 'handle')
  if (handle === '') {
    return fail(
      'invalid-argument',
      'pass "handle", a handle from openleaf_find_text or openleaf_get_structure ' +
        'naming the text to act on',
    )
  }

  const found = resolveHandle(handle)
  if (!found.ok) return fail(found.error, found.message)
  if (found.editor !== editor) {
    // The handle alone would have been enough to find the editor -- handles are
    // page-unique. Requiring the id as well is what turns an agent that has
    // muddled two editors' handles into a refusal rather than into a
    // correct-looking write to the document it did not mean. Neither argument
    // is safe to prefer: the handle would act on a document the agent did not
    // name, and the id would check the wrong editor's bar for what is allowed.
    return fail(
      'invalid-argument',
      `that handle names text in "${found.editor.id}", not in "${editor.id}"; ` +
        'pass the editor it came from, or search this one with openleaf_find_text',
    )
  }

  return { editor, from: found.from, to: found.to }
}

/**
 * Resolve a write's target, refuse it or dispatch it -- once.
 *
 * `change` is called only with a range it is allowed to write to, and it
 * returns either the transaction to dispatch or a `fail()` string to hand back
 * unchanged. Returning the transaction rather than dispatching it is what makes
 * "exactly one transaction per call" a property of this function instead of a
 * rule each tool has to keep: `dispatchAgent` is the only `dispatch` in the
 * package, and this is the only caller a tool needs.
 */
export function writeAt(
  tool: string,
  args: Record<string, unknown>,
  change: (target: AgentTarget) => Transaction | string,
): string {
  return withEditor(args, (editor) => {
    const target = targetFor(args, editor)
    if (typeof target === 'string') return target

    const refusal = refuseWrite(editor, target.from, target.to)
    if (refusal) return refusal

    const built = change(target)
    if (typeof built === 'string') return built

    if (!dispatchAgent(editor, built, tool)) return dispatchRefused()
    return ok({ id: editor.id })
  })
}

/**
 * Whether an agent may write to a given range at all, asked once.
 *
 * Three refusals, and none of them is this package's own policy: each one is a
 * guard the editor already applies to the person sitting in front of it. An
 * agent that got past any of them would be doing something no keyboard shortcut
 * and no toolbar button can do, which is the opposite of what routing through
 * the editor's own guards is for.
 *
 * It answers with the finished failure string rather than a boolean so that
 * every tool that writes refuses in the same words. Exported because a tool
 * that cannot hand `writeAt` a finished transaction -- `openleaf_apply_command`
 * runs the editor's own command and captures what it produces -- still has to
 * ask exactly these three questions, in exactly this order.
 */
export function refuseWrite(editor: RegisteredEditor, from: number, to: number): string | null {
  if (editor.host.hasAttribute('readonly')) {
    return fail(
      'refused',
      'that editor is readonly. Its own toolbar is unavailable too, so there is ' +
        'nothing to retry while the attribute is set.',
    )
  }

  const editingSource = refuseInSourceMode(
    editor,
    'a change made now would be discarded when the view closes. Read the ' +
      'document again before retrying.',
  )
  if (editingSource) return editingSource

  if (touchesPreserved(editor.view.state.doc, from, to)) {
    return fail(
      'preserved-region',
      'that range covers markup the editor preserves verbatim and hands back ' +
        'byte-identical; nothing edits inside it. Target text outside it.',
    )
  }

  return null
}

/**
 * Agent HTML through the paste policy, as the foreign input it always is.
 *
 * `normalizePastedHtml` is the same call `transformPastedHTML` makes, so what an
 * agent may write is what a person may paste -- one policy, not a second one
 * that drifts. But it *dispatches*: it asks `detectSource` where the markup came
 * from and picks the normalizer for that source, and one of those branches is
 * laxer than the rest. `looksLikeOpenLeaf` is the bare presence of
 * `data-pm-slice=`, the attribute ProseMirror stamps on its own clipboard HTML,
 * and it selects `normalizeOpenLeaf`, which keeps inline styles -- correct for a
 * copy out of this editor, which is the same schema and the same trust domain as
 * where it is going.
 *
 * An agent's argument is never that. It is a string that arrived from outside
 * the page, and the signal is one it can write into its own HTML: setting
 * `data-pm-slice` on a `<div>` would let it choose its own sanitizer and land
 * `style="position:fixed"` in the document, which is precisely the markup this
 * package exists to make unreachable. So the choice is taken away from it and
 * the foreign-input normalizer is called directly.
 *
 * Only that one branch is overridden. `word`, `excel` and `gdocs` all end in
 * `stripAllStyles` and strip their own vendor debris besides, so steering into
 * one of them can only make the policy stricter -- and an agent that genuinely
 * forwards a Word fragment should get the Word cleanup, not the generic one.
 */
function sanitizeForeign(html: string): string {
  if (detectSource(html) === 'openleaf') return normalizeGeneric(html)
  return normalizePastedHtml(html)
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

  const sanitized = sanitizeForeign(html)

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
