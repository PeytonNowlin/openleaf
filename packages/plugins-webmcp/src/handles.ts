/**
 * Handles: how an agent names a place in a document across two calls.
 *
 * A selection cannot do this job. It does not survive the round trip out to an
 * agent and back -- the author clicks somewhere, the editor is re-rendered, the
 * agent takes a second to think -- so the feature needs addressing of its own.
 * A handle is an opaque token standing for a range, held per editor and carried
 * forward through every transaction's position mapping, so an edit in one part
 * of the document does not move a handle in another part off its text.
 *
 * The mapping is the whole point, and one detail of it decides whether this is
 * safe. `tr.mapping.map(pos)` always answers with a position: delete the text a
 * handle names and it slides quietly to the neighbouring one, so a later write
 * lands on text nobody chose. `mapResult(pos, assoc)` answers with a position
 * AND whether the token on that side was deleted, which is what lets a handle
 * whose content is gone fail loudly instead. That failure is the reason this
 * module exists; a handle that is merely wrong is worse than no handle at all.
 *
 * The table lives in ProseMirror plugin state rather than in the plugin view's
 * closure. Registering any other opt-in plugin reconfigures the editor state,
 * and ProseMirror destroys and recreates every plugin view when it does --
 * `state.reconfigure` carries a plugin's *state* across, but a closure would go
 * with the old view, and every outstanding handle with it.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import { listEditors, type RegisteredEditor } from './registry.js'
import type { ToolErrorCode } from './result.js'

/** A non-empty span of the document, in ProseMirror positions. */
export interface HandleRange {
  from: number
  to: number
}

interface HandleEntry extends HandleRange {
  /** Sticky: a handle that has once lost its content never resolves again. */
  stale: boolean
}

type HandleTable = ReadonlyMap<string, HandleEntry>

const handlesKey = new PluginKey<HandleTable>('openleaf-webmcp-handles')

/**
 * How many handles one editor keeps, oldest dropped first.
 *
 * Handles are never explicitly released -- an agent has no reason to, and no
 * call to do it with -- so without a bound the table only grows, and it is
 * walked on every transaction. A page left open through a long agent session
 * would type more slowly the longer it had been open. Dropping the oldest is
 * safe in the way that matters: a dropped handle stops resolving, which is a
 * refusal, not a write to the wrong place.
 */
const MAX_HANDLES = 256

/** A handle that still names its text, and the editor it lives in. */
export interface ResolvedHandle extends HandleRange {
  ok: true
  editor: RegisteredEditor
}

/** A handle that does not, in the shape `fail()` takes. */
export interface UnresolvedHandle {
  ok: false
  error: ToolErrorCode
  message: string
}

export type HandleResolution = ResolvedHandle | UnresolvedHandle

/**
 * Issue a handle for each range, against one editor.
 *
 * One transaction for the whole batch: a search that found forty matches would
 * otherwise dispatch forty times, and each dispatch runs the host's toolbar
 * update. The transaction carries no steps, so the document does not change,
 * the change event does not fire and `prosemirror-history` -- which ignores a
 * transaction with no steps -- gains nothing to undo. Reading stays a read.
 *
 * Ranges are recorded exactly as given: they were measured against the state
 * this transaction is built from, and a step-free transaction maps nothing.
 */
export function createHandles<T extends HandleRange>(
  editor: RegisteredEditor,
  ranges: readonly T[],
): (T & { handle: string })[] {
  const issued = new Map<string, HandleEntry>()
  // Each range comes back carrying its handle rather than as a parallel array
  // the caller has to keep in step: two lists of the same length are exactly
  // how a match ends up wearing another match's handle.
  const handled = ranges.map((range) => {
    const handle = token()
    issued.set(handle, { from: range.from, to: range.to, stale: false })
    return { ...range, handle }
  })
  if (issued.size > 0) editor.view.dispatch(editor.view.state.tr.setMeta(handlesKey, issued))
  return handled
}

/**
 * The one way anything reads a handle back.
 *
 * Every tool that takes a handle goes through here, and takes the failure it
 * returns as its own result: the shape is `fail()`'s arguments so that a caller
 * cannot accidentally paper over a stale handle with a message of its own
 * invention. There is deliberately no variant that answers with a position and
 * a warning -- the caller either has a range it may write to, or it has a
 * refusal to hand back to the agent.
 *
 * An editor that has left the page is not in the register, so its handles stop
 * resolving here without the table having to be told anything.
 */
export function resolveHandle(handle: string): HandleResolution {
  for (const editor of listEditors()) {
    const entry = handlesKey.getState(editor.view.state)?.get(handle)
    if (!entry) continue
    // The document is the last word on the range even after mapping said it
    // survived: a tool that then reads or replaces `to` past the end would
    // throw out of the handler, and a throw reaches the agent as a rejected
    // call with no shape to it.
    const beyond = entry.to > editor.view.state.doc.content.size
    if (entry.stale || beyond) return { ok: false, error: 'stale-handle', message: DELETED }
    return { ok: true, editor, from: entry.from, to: entry.to }
  }
  return { ok: false, error: 'stale-handle', message: UNKNOWN }
}

const DELETED =
  'that handle no longer names any text: what it pointed at was deleted. ' +
  'Search again with openleaf_find_text rather than guessing at a nearby position.'

const UNKNOWN =
  'that handle is not one this page issued, or the editor it belonged to has ' +
  'been removed. Call openleaf_list_editors and search again with openleaf_find_text.'

/**
 * The per-editor half: the handle table, carried through every transaction.
 *
 * It contributes no decorations, no keybindings and no commands. The only thing
 * it does to a document is watch it change.
 */
export function agentHandles(): Plugin<HandleTable> {
  return new Plugin<HandleTable>({
    key: handlesKey,
    state: {
      init: () => new Map(),
      apply(tr, table) {
        const issued = tr.getMeta(handlesKey) as HandleTable | undefined
        if (!issued && !tr.docChanged) return table

        const next = new Map(table)
        if (tr.docChanged) for (const [handle, entry] of next) next.set(handle, remap(entry, tr))
        if (issued) for (const [handle, entry] of issued) next.set(handle, entry)
        // Oldest first, which is insertion order for a Map.
        for (const oldest of next.keys()) {
          if (next.size <= MAX_HANDLES) break
          next.delete(oldest)
        }
        return next
      },
    },
  })
}

/**
 * Carry one range across a transaction, or give up on it.
 *
 * The two ends are biased outward -- `1` at the start, `-1` at the end -- so
 * text typed against either edge lands outside the handle rather than being
 * silently adopted by it. An agent that asked for "beta" and later replaced
 * through a handle that had grown to "beta and then some" would be rewriting
 * something it never read.
 *
 * `deleted` on either end is a deletion that took the first or last character
 * of the range with it, which is where a plain `map()` would slide the handle
 * onto its neighbour. The collapse check catches the rest: a replacement that
 * swallowed the range whole can leave both ends mapped onto the same position
 * with neither end reported deleted.
 */
function remap(entry: HandleEntry, tr: Transaction): HandleEntry {
  if (entry.stale) return entry
  const from = tr.mapping.mapResult(entry.from, 1)
  const to = tr.mapping.mapResult(entry.to, -1)
  if (from.deleted || to.deleted || to.pos <= from.pos) return { ...entry, stale: true }
  return { from: from.pos, to: to.pos, stale: false }
}

/**
 * An opaque token, and opaque is a requirement rather than a preference.
 *
 * Anything an agent can read out of a handle is something it will eventually
 * act on: a handle that spelled out a position would be arithmetic waiting to
 * happen, and one that named its editor would be a way to address an editor
 * without listing it first. This carries no meaning at all -- the meaning is in
 * the table, where a transaction can update it.
 *
 * `getRandomValues` rather than `Math.random` because two live handles must not
 * collide, not because a handle is a secret; it names a range in a document the
 * caller is already inside.
 */
function token(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
