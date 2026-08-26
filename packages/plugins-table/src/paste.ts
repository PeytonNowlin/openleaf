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
 * keeps the pasted cells' own `colspan`; the host grid is not consulted.
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

  const table = closedTableInSlice(slice) ?? tableFromPastedCells(view.state.schema, slice)
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
 * A slice whose closed content is one table, not an open descent *into* a table.
 *
 * `pastedCells` treats those two the same — it unwraps any single child with
 * `tableRole == "table"`, closed or not. A copied row is an open table and
 * should stay "cells"; a copied or HTML-pasted `<table>` is closed and should
 * nest as itself, attributes included.
 */
export function closedTableInSlice(slice: Slice): Node | null {
  let { content, openStart, openEnd } = slice
  while (content.childCount === 1 && openStart > 0 && openEnd > 0) {
    const child = content.child(0)
    if (child.type.spec['tableRole'] === 'table') return null
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
