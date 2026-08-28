/**
 * The marker every agent-written transaction carries.
 *
 * Two things need it and neither can be retrofitted onto an unmarked write.
 * The author's undo has to reverse one agent action per press rather than
 * whatever fell inside `prosemirror-history`'s time window -- agent calls
 * arrive in a burst, so elapsed time is exactly the wrong thing to group on --
 * and anything watching the document has to be able to tell an edit the author
 * made from one made on their behalf.
 *
 * A `PluginKey` rather than a bare string, which is the repo's convention for
 * transaction metadata: `core/src/autolink.ts` and `core/src/isolating-selection.ts`
 * both key their metadata this way, and a key is an object nothing else on the
 * page can collide with by choosing the same name.
 */

import { PluginKey, type Transaction } from 'prosemirror-state'

/** What a marked transaction carries: which tool wrote it. */
export interface AgentMark {
  tool: string
}

/**
 * No plugin holds this key. It exists only as a name for metadata, which is
 * what a `PluginKey` is under the convention -- an object identity nothing else
 * on the page can claim by picking the same string.
 */
export const agentKey = new PluginKey('openleaf-webmcp')

/**
 * Mark a transaction as agent-originated, and hand it back.
 *
 * Returns the same transaction rather than a copy -- `setMeta` mutates and
 * returns `this` -- so this reads as a wrapper at the one place a tool
 * dispatches: `view.dispatch(markAgent(tr, name))`. That is the whole point of
 * it being a function: a tool that dispatched an unmarked transaction would be
 * invisible to undo grouping, and the omission would be invisible in review.
 */
export function markAgent(tr: Transaction, tool: string): Transaction {
  return tr.setMeta(agentKey, { tool } satisfies AgentMark)
}
