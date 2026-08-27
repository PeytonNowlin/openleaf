/**
 * Paste into a table cell: nest a table, do not merge it into the host grid.
 *
 * `tableEditing`'s `handlePaste` calls `pastedCells`, which unwraps a slice
 * whose outer node has `tableRole == "table"` even when that table is *closed*
 * (`openStart`/`openEnd` are 0). A caret inside a cell then goes through
 * `insertCells`, which grows the host and rewrites `colspan` on cells the
 * author did not select. A 2×2 pasted at a text caret in a 2×2 replaced the
 * host outright.
 *
 * Nested tables are valid — `table_cell` is `block+` — so the right shape for
 * a whole table (or a slice of loose cells) dropped on a text caret is a child
 * table, not a smashed grid.
 *
 * CellSelection is the other gesture: the author selected the target rectangle.
 * That still maps through `tableEditing.handlePaste`. This plugin must sit
 * *before* `tableEditing` in the plugin list so a TextSelection paste is
 * claimed first; `EditorView.someProp` walks from the start and stops at the
 * first `handlePaste` that returns true.
 *
 * Loose cells at a text caret have no obviously right answer. Nesting them in a
 * new table is the choice here: mapping would be the data-loss path this file
 * exists to close, and refusing looks like a broken clipboard. The new table
 * keeps the pasted cells' own `colspan`; the host grid is not consulted. A
 * whole table — closed from external HTML, or open by one from a full-table
 * cell selection — is inserted as itself, so caption, colgroup and section
 * counts survive.
 */

import { canInsert } from '@openleaf-editor/core'
import type { Node, Schema, Slice } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import {
  __pastedCells as pastedCells,
  CellSelection,
  isInTable,
  tableNodeTypes,
} from 'prosemirror-tables'
import type { EditorView } from 'prosemirror-view'

const nestedTablePasteKey = new PluginKey('openleaf-nested-table-paste')

export function nestedTablePastePlugin(): Plugin {
  return new Plugin({
    key: nestedTablePasteKey,
    props: {
      handlePaste: (view, _event, slice) => handleNestedTablePaste(view, slice),
    },
  })
}

export function handleNestedTablePaste(view: EditorView, slice: Slice): boolean {
  if (!isInTable(view.state)) return false
  if (view.state.selection instanceof CellSelection) return false

  const table = wholeTableInSlice(slice) ?? tableFromPastedCells(view.state.schema, slice)
  if (!table) return false

  // `canInsert` walking into an isolating cell is the common case and succeeds.
  // If it does not, still claim the paste: falling through to `tableEditing`
  // is how a 2×2 once replaced its host.
  if (!canInsert(view.state, 'table')) return true

  view.dispatch(
    view.state.tr
      .replaceSelectionWith(table)
      .scrollIntoView()
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  )
  return true
}

/**
 * The table node a caret-paste should nest, or null.
 *
 * External HTML without `data-pm-slice` is *not* an open table.
 * `parseFromClipboard` runs `Slice.maxOpen` then closes back to isolating
 * nodes, and `table` is isolating, so a pasted `<table>` arrives closed with
 * its caption, colgroup and section counts already on the node.
 *
 * The shape that actually arrives open is an internal copy of every cell.
 * `CellSelection.content()` returns `new Slice(Fragment.from(table), 1, 1)`
 * when the selection covers the whole grid — the table node, furniture
 * included, open by one. `pastedCells` unwraps that the same way it unwraps a
 * closed table, and `table.create(null, rows)` was how a nested paste dropped
 * the accessibility name.
 *
 * The predicate: after descending through single open wrappers that are not
 * table structure, the fragment has exactly one child and that child is a
 * table. Open depths describe how the slice fits a parent, not missing rows —
 * the table node in the fragment is complete, so we keep it rather than
 * rebuild. That is also why a `colwidth` that no longer matches never arises
 * here: we do not rebuild the grid.
 *
 * Deliberately refuses a fragment of rows or cells (a copied rectangle, not a
 * table) and a fragment with more than one top-level child (the paste starts
 * in one block and ends in another).
 */
export function wholeTableInSlice(slice: Slice): Node | null {
  let { content, openStart, openEnd } = slice
  while (content.childCount === 1 && openStart > 0 && openEnd > 0) {
    const child = content.child(0)
    const role = child.type.spec['tableRole'] as string | undefined
    if (role === 'table') return child
    if (role === 'row' || role === 'cell' || role === 'header_cell') return null
    openStart -= 1
    openEnd -= 1
    content = child.content
  }
  if (content.childCount !== 1) return null
  const node = content.child(0)
  return node.type.spec['tableRole'] === 'table' ? node : null
}

function tableFromPastedCells(schema: Schema, slice: Slice): Node | null {
  const cells = pastedCells(slice)
  if (!cells) return null
  const types = tableNodeTypes(schema)
  const rows = cells.rows.map((frag) => types.row.create(null, frag))
  return types.table.create(null, rows)
}
