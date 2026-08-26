/**
 * Table commands that are not already in `prosemirror-tables`.
 *
 * Property edits, caption/colgroup, nested insert and vertical alignment live
 * here so a test can apply them without standing up a toolbar. Column insert and
 * delete also reindex the stored colgroup here: the upstream commands only move
 * cells, and `colgroupFromCellWidths` never runs unless a cell already has
 * `colwidth`.
 *
 * `mergeCells` and `splitCell` stay the stock commands. This file wraps them
 * so that after they run, `colwidth` is one entry per covered column (the
 * same array `colgroupFromCellWidths` already walks) and `applyCellScope`
 * sees the new span. The colgroup sync plugin does the same repair for a
 * stock `mergeCells` dispatched from elsewhere, so the two paths cannot
 * disagree.
 */

import {
  canInsert,
  isNodeActive,
  parseDeclarations,
  safeColor,
  safeTableStyleValue,
  serializeDeclarations,
} from '@openleaf-editor/core'
import type { Node, ResolvedPos } from 'prosemirror-model'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import { Plugin, TextSelection } from 'prosemirror-state'
import {
  addColumnAfter as addColumnAfterRaw,
  addColumnBefore as addColumnBeforeRaw,
  addRowAfter as addRowAfterRaw,
  addRowBefore as addRowBeforeRaw,
  CellSelection,
  deleteColumn as deleteColumnRaw,
  deleteRow as deleteRowRaw,
  mergeCells as mergeCellsRaw,
  splitCell as splitCellRaw,
  TableMap,
  toggleHeaderRow as toggleHeaderRowRaw,
} from 'prosemirror-tables'

export function inTable(state: EditorState): boolean {
  return isNodeActive(state, 'table')
}

export function findRole(
  $pos: ResolvedPos,
  role: 'table' | 'row' | 'cell' | 'header_cell',
): { node: Node; pos: number; depth: number } | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    const found = node.type.spec['tableRole'] as string | undefined
    if (role === 'cell') {
      if (found !== 'cell' && found !== 'header_cell') continue
    } else if (found !== role) continue
    return { node, pos: $pos.before(depth), depth }
  }
  return null
}

export function findTable($pos: ResolvedPos) {
  return findRole($pos, 'table')
}

export function findRow($pos: ResolvedPos) {
  return findRole($pos, 'row')
}

export function findCell($pos: ResolvedPos) {
  return findRole($pos, 'cell')
}

export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    if (!canInsert(state, 'table')) return false
    if (dispatch) {
      const cell = state.schema.nodes['table_cell']
      const header = state.schema.nodes['table_header']
      const row = state.schema.nodes['table_row']
      const tableType = state.schema.nodes['table']
      if (!cell || !header || !row || !tableType) return false

      const headerCells = Array.from({ length: cols }, () =>
        header.createAndFill({ scope: 'col' }),
      ).filter((n): n is NonNullable<typeof n> => n !== null)
      const bodyRows = Array.from({ length: Math.max(0, rows - 1) }, () =>
        row.create(
          null,
          Array.from({ length: cols }, () => cell.createAndFill()).filter(
            (n): n is NonNullable<typeof n> => n !== null,
          ),
        ),
      )

      const table = tableType.create(null, [row.create(null, headerCells), ...bodyRows])
      dispatch(state.tr.replaceSelectionWith(table).scrollIntoView())
    }
    return true
  }
}

/**
 * The `scope` this header should carry, given where it sits and how far it spans.
 *
 * Axis is the rule `applyCellScope` has always used: the first row, and every
 * header that is not the row-opening cell, heads a column. `colspan` / `rowspan`
 * then promote that axis to the HTML group tokens — a two-column header is
 * `colgroup`, not `col`, which is what a screen reader needs to hear.
 */
function expectedHeaderScope(
  rowIndex: number,
  cellIndex: number,
  colspan: number,
  rowspan: number,
): string {
  const axis = rowIndex === 0 || cellIndex > 0 ? 'col' : 'row'
  if (axis === 'col' && colspan > 1) return 'colgroup'
  if (axis === 'row' && rowspan > 1) return 'rowgroup'
  return axis
}

function scopeOf(node: Node): string | null {
  const scope = node.attrs['scope']
  return scope === null || scope === undefined || scope === '' ? null : String(scope)
}

function scopeSpanMismatch(current: string, expected: string): boolean {
  return (
    (current === 'col' && expected === 'colgroup') ||
    (current === 'colgroup' && expected === 'col') ||
    (current === 'row' && expected === 'rowgroup') ||
    (current === 'rowgroup' && expected === 'row')
  )
}

/**
 * Rewrite header cell `scope` for a table.
 *
 * `fillMissing` is how insert and toggle-header give a new `<th>` the same
 * `scope` `insertTable` uses. Merge and split already have a scope, just the
 * wrong one for the new span, so the colgroup sync plugin calls this with
 * `fillMissing: false` and only repairs contradictions — otherwise a keystroke
 * inside a table would invent `scope` on headers the author had left bare.
 *
 * The selection is captured and restored around the rewrite. Every change here
 * is a `setNodeMarkup`, which replaces the cell node, and mapping a text
 * selection through a replacement can drag it to the node boundary. The symptom
 * was not a broken caret but a broken command: inserting a row moved the caret
 * out of the cell the author was editing, so the next table command found no
 * cell and did nothing at all.
 */
function applyCellScope(
  tr: Transaction,
  tablePos?: number,
  fillMissing = true,
): Transaction {
  const header = tr.doc.type.schema.nodes['table_header']
  const cell = tr.doc.type.schema.nodes['table_cell']
  if (!header || !cell) return tr

  let pos = tablePos ?? -1
  if (pos < 0) {
    for (let depth = tr.selection.$from.depth; depth > 0; depth -= 1) {
      if (tr.selection.$from.node(depth).type.spec['tableRole'] === 'table') {
        pos = tr.selection.$from.before(depth)
        break
      }
    }
  }
  if (pos < 0) return tr

  const table = tr.doc.nodeAt(pos)
  if (!table) return tr

  // Only a plain text selection needs restoring: CellSelection maps itself and
  // stays a CellSelection, which is what multi-cell commands act on.
  const restore = tr.selection instanceof TextSelection ? tr.selection.from : null
  const stepsBefore = tr.steps.length

  table.forEach((row, rowOffset, rowIndex) => {
    const rowPos = pos + 1 + rowOffset
    row.forEach((cellNode, cellOffset, cellIndex) => {
      const cellPos = rowPos + 1 + cellOffset
      if (cellNode.type === cell) {
        if (cellNode.attrs['scope']) {
          tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, scope: null })
        }
        return
      }
      if (cellNode.type !== header) return
      const expected = expectedHeaderScope(
        rowIndex,
        cellIndex,
        (cellNode.attrs['colspan'] as number) || 1,
        (cellNode.attrs['rowspan'] as number) || 1,
      )
      const current = scopeOf(cellNode)
      if (current === expected) return
      // A set `scope` is author intent — a first-row cell can still be a row
      // header — unless the span has outgrown the token (`col` on colspan=2).
      if (current !== null && !scopeSpanMismatch(current, expected)) return
      if (current === null && !fillMissing) return
      tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, scope: expected })
    })
  })

  // Mapped through only the steps this pass added, so the caret lands where it
  // was rather than where the last replacement pushed it.
  if (restore !== null && tr.steps.length > stepsBefore) {
    const at = tr.mapping.slice(stepsBefore).map(restore)
    tr.setSelection(TextSelection.near(tr.doc.resolve(at)))
  }
  return tr
}

export function withCellScope(command: Command): Command {
  return (state, dispatch, view) => {
    if (!dispatch) return command(state, undefined, view)
    return command(
      state,
      (tr) => {
        dispatch(applyCellScope(tr))
      },
      view,
    )
  }
}

/**
 * Columns the selection covers, as a half-open range on the table map.
 *
 * `prosemirror-tables` uses the same rect for insert-after (`right`) and
 * insert-before (`left`). Reading it here, before the command rewrites the
 * cells, is what lets the colgroup patch aim at the same index.
 */
function selectedColumnRange(state: EditorState): { tablePos: number; left: number; right: number } | null {
  const table = findTable(state.selection.$from)
  if (!table) return null
  const map = TableMap.get(table.node)
  const tableStart = table.pos + 1
  const sel = state.selection
  const rect =
    sel instanceof CellSelection
      ? map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart)
      : (() => {
          const cell = findCell(sel.$from)
          return cell ? map.findCell(cell.pos - tableStart) : null
        })()
  if (!rect) return null
  return { tablePos: table.pos, left: rect.left, right: rect.right }
}

/**
 * Reindex the stored colgroup the same way the column command reindexes cells.
 *
 * `colgroupFromCellWidths` only runs when a cell carries `colwidth`. Tables
 * whose widths live only on inherited `<col>` elements never hit that path, so
 * insert/delete used to leave the furniture describing the previous columns:
 * every remaining column inherited the previous column's width and class.
 */
function withColgroupColumns(
  kind: 'before' | 'after' | 'delete',
  command: Command,
): Command {
  return (state, dispatch, view) => {
    if (!dispatch) return command(state, undefined, view)
    const range = selectedColumnRange(state)
    return command(
      state,
      (tr) => {
        if (range) applyColgroupColumnChange(tr, range, kind)
        dispatch(tr)
      },
      view,
    )
  }
}

function applyColgroupColumnChange(
  tr: Transaction,
  range: { tablePos: number; left: number; right: number },
  kind: 'before' | 'after' | 'delete',
): void {
  const pos = tr.mapping.map(range.tablePos)
  const table = tr.doc.nodeAt(pos)
  if (!table || table.type.spec['tableRole'] !== 'table') return
  const stored = table.attrs['colgroup'] as string | null | undefined
  if (!stored) return

  let next = stored
  if (kind === 'delete') {
    for (let col = range.right - 1; col >= range.left; col -= 1) {
      next = colgroupHtmlDeleteColumn(next, col) ?? next
    }
  } else {
    next = colgroupHtmlInsertColumn(next, kind === 'before' ? range.left : range.right) ?? next
  }

  const width = TableMap.get(table).width
  next = colgroupHtmlMatchWidth(next, width) ?? next
  if (next === stored) return
  tr.setNodeMarkup(pos, undefined, { ...table.attrs, colgroup: next })
}

/**
 * Visual cell attributes Word/Excel authors expect a new row or column to
 * inherit from the cell they were in.
 *
 * Copied: `align`, `valign`, `style` (background and padding), `bgcolor`, and
 * — on a new *row* only — `colwidth`, so every cell in a column still carries
 * the same stored widths the next resize will read.
 *
 * Not copied, on purpose:
 * - `class` — often a band (`odd`/`even`) the author wanted on one row
 * - `scope` / `headers` / `abbr` — identity of the source cell; `applyCellScope`
 *   owns `scope`
 * - `colwidth` on a new *column* — `withColgroupColumns` inserts a bare `<col>`
 *   so later columns keep their own widths; stamping the neighbour's colwidth
 *   onto the new cells would make the sync plugin fight that bare column
 * - header vs body type — stock `addRow` / `addColumn` already copy the type,
 *   and `maintainTableSections` refuses to insert into `<thead>` / `<tfoot>`
 * - header `style` onto a body cell — the neighbour lookup requires matching
 *   type, so a body row inserted below a header copies from the body row on
 *   the other side, not from the header chrome
 */
const COPIED_CELL_ATTRS = ['align', 'valign', 'style', 'bgcolor'] as const

function withCopiedCellFormatting(command: Command): Command {
  return (state, dispatch, view) => {
    if (!dispatch) return command(state, undefined, view)
    const found = findTable(state.selection.$from)
    const before = found ? { pos: found.pos, node: found.node } : null
    return command(
      state,
      (tr) => {
        if (before) copyFormattingOntoInsertedCells(tr, before)
        dispatch(tr)
      },
      view,
    )
  }
}

function copyFormattingOntoInsertedCells(
  tr: Transaction,
  before: { pos: number; node: Node },
): void {
  const pos = tr.mapping.map(before.pos)
  const after = tr.doc.nodeAt(pos)
  if (!after || after.type.spec['tableRole'] !== 'table') return

  const insertedRow = insertedRowIndex(before.node, after)
  if (insertedRow !== null) {
    copyOntoInsertedRow(tr, pos, after, insertedRow)
    return
  }
  const insertedCol = insertedColumnIndex(before.node, after)
  if (insertedCol !== null) copyOntoInsertedColumn(tr, pos, after, insertedCol)
}

function insertedRowIndex(before: Node, after: Node): number | null {
  if (after.childCount !== before.childCount + 1) return null
  const text = (row: Node) => row.textContent
  for (let at = 0; at <= before.childCount; at += 1) {
    let matches = true
    for (let i = 0; i < before.childCount; i += 1) {
      const afterIndex = i < at ? i : i + 1
      if (text(before.child(i)) !== text(after.child(afterIndex))) {
        matches = false
        break
      }
    }
    if (matches) return at
  }
  return null
}

function insertedColumnIndex(before: Node, after: Node): number | null {
  const beforeMap = TableMap.get(before)
  const afterMap = TableMap.get(after)
  if (afterMap.width !== beforeMap.width + 1 || afterMap.height !== beforeMap.height) {
    return null
  }
  const textAt = (table: Node, map: TableMap, row: number, col: number) =>
    table.nodeAt(map.map[row * map.width + col] ?? 0)?.textContent ?? ''
  for (let at = 0; at <= beforeMap.width; at += 1) {
    let matches = true
    outer: for (let row = 0; row < beforeMap.height; row += 1) {
      for (let col = 0; col < beforeMap.width; col += 1) {
        const afterCol = col < at ? col : col + 1
        if (textAt(before, beforeMap, row, col) !== textAt(after, afterMap, row, afterCol)) {
          matches = false
          break outer
        }
      }
    }
    if (matches) return at
  }
  return null
}

function copyOntoInsertedRow(tr: Transaction, tablePos: number, table: Node, rowIndex: number): void {
  const map = TableMap.get(table)
  const row = table.child(rowIndex)
  if (!row) return
  let offset = 0
  for (let i = 0; i < rowIndex; i += 1) offset += table.child(i).nodeSize
  const rowPos = tablePos + 1 + offset
  let cellOffset = 0
  let col = 0
  row.forEach((cell) => {
    const cellPos = rowPos + 1 + cellOffset
    const colspan = (cell.attrs['colspan'] as number) || 1
    if (!cell.textContent && colspan === 1 && ((cell.attrs['rowspan'] as number) || 1) === 1) {
      const source = neighbourCell(table, map, rowIndex, col, 'row', cell.type)
      if (source) {
        tr.setNodeMarkup(cellPos, undefined, {
          ...cell.attrs,
          ...copiedCellAttrs(source, { includeColwidth: true }),
        })
      }
    }
    cellOffset += cell.nodeSize
    col += colspan
  })
}

function copyOntoInsertedColumn(
  tr: Transaction,
  tablePos: number,
  table: Node,
  colIndex: number,
): void {
  const map = TableMap.get(table)
  table.forEach((row, rowOffset, rowIndex) => {
    const rowPos = tablePos + 1 + rowOffset
    let col = 0
    row.forEach((cell, cellOffset) => {
      const colspan = (cell.attrs['colspan'] as number) || 1
      if (
        col === colIndex &&
        !cell.textContent &&
        colspan === 1 &&
        ((cell.attrs['rowspan'] as number) || 1) === 1
      ) {
        const source = neighbourCell(table, map, rowIndex, colIndex, 'col', cell.type)
        if (source) {
          tr.setNodeMarkup(rowPos + 1 + cellOffset, undefined, {
            ...cell.attrs,
            ...copiedCellAttrs(source, { includeColwidth: false }),
          })
        }
      }
      col += colspan
    })
  })
}

function neighbourCell(
  table: Node,
  map: TableMap,
  row: number,
  col: number,
  axis: 'row' | 'col',
  type: Node['type'],
): Node | null {
  const prefer = axis === 'row' ? (row > 0 ? -1 : 1) : col > 0 ? -1 : 1
  const limit = axis === 'row' ? map.height : map.width
  for (const dir of [prefer, -prefer]) {
    const at = (axis === 'row' ? row : col) + dir
    if (at < 0 || at >= limit) continue
    const index = axis === 'row' ? at * map.width + col : row * map.width + at
    const node = table.nodeAt(map.map[index] ?? 0)
    if (node && node.type === type) return node
  }
  return null
}

function copiedCellAttrs(
  source: Node,
  { includeColwidth }: { includeColwidth: boolean },
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const key of COPIED_CELL_ATTRS) {
    if (source.attrs[key] != null) next[key] = source.attrs[key]
  }
  if (
    includeColwidth &&
    source.attrs['colwidth'] != null &&
    ((source.attrs['colspan'] as number) || 1) === 1
  ) {
    // A spanning neighbour holds one width per column it covers. Copying that
    // array onto a colspan=1 cell would disagree with the schema's length check.
    next['colwidth'] = source.attrs['colwidth']
  }
  return next
}

/**
 * Snapshot each column's width before a merge or split, then write those
 * widths back onto the cells the command produced.
 *
 * Stock `mergeCells` grows `colwidth` with `addColSpan`, which inserts `0` for
 * every newly covered column rather than taking the other cell's width. Stock
 * `splitCell` then treats `0` as "no width". The array is one entry per
 * covered column — the same invariant `colgroupFromCellWidths` already
 * documents — so "sum" here means concatenate, not fold into a single number.
 * Folding would make the next resize fight the colgroup: the spanning cell
 * would report one width for every column it covers.
 *
 * Missing entries are filled from another cell in the same column, then from
 * the stored colgroup. A column nobody knows a width for stays unknown: we do
 * not invent one, and we do not divide a neighbour's width across the hole
 * (100 and unknown is not 50/50). An odd pair such as 100 and 101 stays
 * `[100, 101]` so a later split restores the same integers.
 */
function withPreservedColumnWidths(command: Command): Command {
  return (state, dispatch, view) => {
    if (!dispatch) return command(state, undefined, view)
    const found = findTable(state.selection.$from)
    const snapshot = found ? { pos: found.pos, widths: columnWidths(found.node) } : null
    return command(
      state,
      (tr) => {
        if (snapshot) applyColumnWidthsToCells(tr, snapshot.pos, snapshot.widths)
        dispatch(tr)
      },
      view,
    )
  }
}

function applyColumnWidthsToCells(
  tr: Transaction,
  tablePos: number,
  widths: Array<number | null>,
): void {
  const pos = tr.mapping.map(tablePos)
  const table = tr.doc.nodeAt(pos)
  if (!table || table.type.spec['tableRole'] !== 'table') return
  writeColwidthOntoCells(tr, pos, table, widths)
}

function writeColwidthOntoCells(
  tr: Transaction,
  tablePos: number,
  table: Node,
  widths: Array<number | null>,
  spanningOnly = false,
): void {
  const map = TableMap.get(table)
  const seen = new Set<number>()
  for (let i = 0; i < map.map.length; i += 1) {
    const rel = map.map[i] ?? 0
    if (seen.has(rel)) continue
    seen.add(rel)
    const cell = table.nodeAt(rel)
    if (!cell) continue
    const colspan = (cell.attrs['colspan'] as number) || 1
    if (spanningOnly && colspan < 2) continue
    const col = i % map.width
    const next = colwidthForSpan(widths, col, col + colspan)
    const current = cell.attrs['colwidth'] as number[] | null
    // Incomplete knowledge (`null`) is not a reason to wipe a partial array
    // stock merge left behind. Only write when every covered column is known.
    if (next === null || sameColwidth(current, next)) continue
    tr.setNodeMarkup(tablePos + 1 + rel, undefined, { ...cell.attrs, colwidth: next })
  }
}

function colwidthForSpan(
  widths: Array<number | null>,
  left: number,
  right: number,
): number[] | null {
  const slice = widths.slice(left, right)
  if (slice.length === 0 || slice.some((width) => width == null)) return null
  return slice as number[]
}

function sameColwidth(a: number[] | null | undefined, b: number[] | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.length === b.length && a.every((width, i) => width === b[i])
}

export const addColumnAfter = withColgroupColumns(
  'after',
  withCellScope(withCopiedCellFormatting(addColumnAfterRaw)),
)
export const addColumnBefore = withColgroupColumns(
  'before',
  withCellScope(withCopiedCellFormatting(addColumnBeforeRaw)),
)
export const deleteColumn = withColgroupColumns('delete', deleteColumnRaw)
export const addRowAfter = withCellScope(
  withCopiedCellFormatting(maintainTableSections(addRowAfterRaw, 'after')),
)
export const addRowBefore = withCellScope(
  withCopiedCellFormatting(maintainTableSections(addRowBeforeRaw, 'before')),
)
export const deleteRow = withCellScope(maintainTableSections(deleteRowRaw, 'delete'))
export const toggleHeaderRow = withCellScope(toggleHeaderRowRaw)
export const mergeCells = withCellScope(withPreservedColumnWidths(mergeCellsRaw))
export const splitCell = withCellScope(withPreservedColumnWidths(splitCellRaw))

/**
 * Keep `headerRows` / `footerRows` attached to the rows that actually live in
 * those sections.
 *
 * The counts are how serialize rebuilds `<thead>` and `<tfoot>` (see html.ts).
 * Upstream row commands never touch them, so deleting the header row left
 * `headerRows: 1` and the first data row was serialized as `<thead>`. Inserting
 * above the header left the empty row in `<thead>` and demoted the real header
 * into `<tbody>`. The same shift happens at `<tfoot>`.
 *
 * Deletes decrement the count for the section the removed rows belonged to.
 * Inserts that would land inside a section are redirected to the nearest body
 * slot instead: the author asked for a row, not a new header or footer.
 */
function maintainTableSections(
  command: Command,
  kind: 'before' | 'after' | 'delete',
): Command {
  return (state, dispatch, view) => {
    const table = findTable(state.selection.$from)
    if (!table) return command(state, dispatch, view)

    const headerRows = (table.node.attrs['headerRows'] as number) || 0
    const footerRows = (table.node.attrs['footerRows'] as number) || 0
    const rowCount = table.node.childCount
    const indices = selectedRowIndices(state, table.node, table.pos)

    if (kind === 'delete') {
      if (!dispatch) return command(state, undefined, view)
      return command(
        state,
        (tr) => {
          const mapped = tr.mapping.mapResult(table.pos)
          if (mapped.deleted) {
            dispatch(tr)
            return
          }
          const next = tr.doc.nodeAt(mapped.pos)
          if (next?.type.spec['tableRole'] === 'table') {
            let header = headerRows
            let footer = footerRows
            for (const index of indices) {
              if (index < headerRows) header -= 1
              else if (index >= rowCount - footerRows) footer -= 1
            }
            tr.setNodeMarkup(mapped.pos, undefined, {
              ...next.attrs,
              headerRows: Math.max(0, header),
              footerRows: Math.max(0, footer),
            })
          }
          dispatch(tr)
        },
        view,
      )
    }

    const rowIndex = indices[0]
    if (rowIndex === undefined) return command(state, dispatch, view)

    const natural = kind === 'before' ? rowIndex : rowIndex + 1
    let insertAt = natural
    if (insertAt < headerRows) insertAt = headerRows
    if (insertAt > rowCount - footerRows) insertAt = rowCount - footerRows

    if (insertAt === natural) return command(state, dispatch, view)
    if (!dispatch) return command(state, undefined, view)

    const working = stateWithRowSelection(state, table.node, table.pos, insertAt, rowCount)
    const redirected = insertAt >= rowCount ? addRowAfterRaw : addRowBeforeRaw
    return redirected(working, dispatch)
  }
}

function selectedRowIndices(state: EditorState, table: Node, tablePos: number): number[] {
  const found = new Set<number>()
  const addFrom = ($pos: ResolvedPos) => {
    const row = findRow($pos)
    if (!row) return
    const index = rowIndexAt(table, tablePos, row.pos)
    if (index >= 0) found.add(index)
  }
  const { selection } = state
  if (selection instanceof CellSelection) {
    selection.forEachCell((_node, pos) => {
      addFrom(state.doc.resolve(pos + 1))
    })
  } else {
    addFrom(selection.$from)
  }
  return [...found].sort((a, b) => a - b)
}

function rowIndexAt(table: Node, tablePos: number, rowPos: number): number {
  let offset = tablePos + 1
  for (let i = 0; i < table.childCount; i += 1) {
    if (offset === rowPos) return i
    offset += table.child(i).nodeSize
  }
  return -1
}

function stateWithRowSelection(
  state: EditorState,
  table: Node,
  tablePos: number,
  insertAt: number,
  rowCount: number,
): EditorState {
  const rowIndex = insertAt >= rowCount ? rowCount - 1 : insertAt
  let pos = tablePos + 1
  for (let i = 0; i < rowIndex; i += 1) pos += table.child(i).nodeSize
  const cellPos = pos + 1
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(cellPos + 1))))
}

export function selectedCellPositions(state: EditorState): number[] {
  const { selection } = state
  if (selection instanceof CellSelection) {
    const positions: number[] = []
    selection.forEachCell((_node, pos) => {
      positions.push(pos)
    })
    return positions
  }
  const cell = findCell(selection.$from)
  return cell ? [cell.pos] : []
}

/**
 * Patch declarations onto a style attribute, validating every value written.
 *
 * The validation is here rather than in each caller because this is the choke
 * point: a value reaches the stored style attribute only through this function,
 * and `serializeDeclarations` joins on `;`, so an unchecked value carrying one
 * becomes extra declarations. `padding: 0;position:fixed;inset:0` is a
 * page-covering overlay, written from a property dialog and saved.
 *
 * `safeTableStyleValue` is core's own parse-path validator, so a dialog cannot
 * disagree with the schema about what an acceptable value is.
 */
export function mergeStyle(
  existing: string | null | undefined,
  patch: Record<string, string | null>,
): string | null {
  const declarations = parseDeclarations(existing)
  for (const [name, value] of Object.entries(patch)) {
    const safe = value ? safeTableStyleValue(name, value) : null
    if (!safe) declarations.delete(name)
    else declarations.set(name, safe)
  }
  return serializeDeclarations(declarations)
}

/** A style value the schema will keep, or null. For a dialog's commit step. */
export function styleValueOrNull(property: string, value: string | undefined): string | null {
  const trimmed = emptyToNull(value)
  return trimmed ? safeTableStyleValue(property, trimmed) : null
}

export function setTableAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const table = findTable(state.selection.$from)
    if (!table) return false
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, ...attrs }))
    }
    return true
  }
}

export function setRowAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const row = findRow(state.selection.$from)
    if (!row) return false
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(row.pos, undefined, { ...row.node.attrs, ...attrs }))
    }
    return true
  }
}

export function setCellAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const positions = selectedCellPositions(state)
    if (positions.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos)
        if (!node) continue
        const next = { ...node.attrs, ...attrs }
        tr.setNodeMarkup(pos, undefined, next)
      }
      dispatch(tr)
    }
    return true
  }
}

export function setCellVerticalAlign(value: string | null): Command {
  return setCellAttrs({ valign: value })
}

export function captionTextFromHtml(html: string | null | undefined): string {
  if (!html || typeof document === 'undefined') return html?.replace(/<[^>]+>/g, '') ?? ''
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  return tpl.content.querySelector('caption')?.textContent ?? ''
}

export function captionHtmlFromText(text: string, previous: string | null | undefined): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (previous && captionTextFromHtml(previous) === trimmed) return previous
  if (typeof document === 'undefined') {
    return `<caption>${escapeText(trimmed)}</caption>`
  }
  const caption = document.createElement('caption')
  caption.textContent = trimmed
  return caption.outerHTML
}

export function setTableCaption(text: string): Command {
  return (state, dispatch) => {
    const table = findTable(state.selection.$from)
    if (!table) return false
    const caption = captionHtmlFromText(text, table.node.attrs['caption'] as string | null)
    return setTableAttrs({ caption })(state, dispatch)
  }
}

export function colgroupHtmlFromWidths(widths: Array<string | null | undefined>): string | null {
  if (widths.every((width) => !width)) return null
  if (typeof document === 'undefined') {
    const cols = widths.map((width) => (width ? `<col width="${escapeAttr(width)}">` : '<col>')).join('')
    return `<colgroup>${cols}</colgroup>`
  }
  const group = document.createElement('colgroup')
  for (const width of widths) {
    const col = document.createElement('col')
    if (width) col.setAttribute('width', width)
    group.appendChild(col)
  }
  return group.outerHTML
}

/** The `<col>` elements of a stored colgroup, or null when there is no DOM. */
function colsOf(html: string | null | undefined): { group: Element; cols: Element[] } | null {
  if (!html) return null
  if (typeof document === 'undefined') return null
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const group = tpl.content.querySelector('colgroup')
  if (!group) return null
  return { group, cols: [...group.querySelectorAll('col')] }
}

/** `span` as a count of columns covered, defaulting to 1. */
function spanOf(col: Element): number {
  const raw = Number(col.getAttribute('span') ?? '1')
  return Number.isInteger(raw) && raw > 0 ? raw : 1
}

/**
 * Column widths, one per column.
 *
 * `span` is honoured: `<col span="2" width="120">` sets two columns to 120, not
 * one. Reading the elements positionally would report the second column as
 * having no width, and then saving would write that back.
 */
export function widthsFromColgroup(html: string | null | undefined, columns: number): string[] {
  const parsed = colsOf(html)
  if (!parsed) return Array.from({ length: columns }, () => '')
  return widthsFromCols(parsed.cols, columns)
}

/** The same reading, from `<col>` elements somebody has already parsed. */
function widthsFromCols(cols: readonly Element[], columns: number): string[] {
  const widths = Array.from({ length: columns }, () => '')
  let column = 0
  for (const col of cols) {
    const width = col.getAttribute('width') ?? ''
    for (let i = 0; i < spanOf(col); i += 1) {
      if (column < columns) widths[column] = width
      column += 1
    }
  }
  return widths
}

/**
 * Write widths into an existing colgroup rather than replacing it.
 *
 * Inherited markup carries more than widths -- `<colgroup class="layout">`,
 * `<col span="2">`, whatever else a previous CMS wrote -- and the table
 * properties dialog saves the whole table, so rebuilding the colgroup from
 * widths alone dropped all of it on a save that changed nothing else.
 *
 * An unchanged set of widths returns the stored markup untouched, so saving the
 * dialog is genuinely a no-op. When a width does change, the existing elements
 * are patched: a spanned `<col>` keeps its span while its columns still agree,
 * and is split into one `<col>` per column -- carrying its other attributes --
 * only when they no longer do.
 */
export function colgroupHtmlWithWidths(
  existing: string | null | undefined,
  widths: Array<string | null | undefined>,
): string | null {
  const parsed = colsOf(existing)
  if (!parsed) return colgroupHtmlFromWidths(widths)

  const wanted = widths.map((width) => width ?? '')
  // From the elements just parsed, not from the string again: this ran twice per
  // table per transaction, and an HTML parse is not a cheap way to read an
  // attribute you are already holding.
  const current = widthsFromCols(parsed.cols, wanted.length)
  if (current.every((width, i) => width === wanted[i])) return existing ?? null

  let column = 0
  for (const col of parsed.cols) {
    const span = spanOf(col)
    const covered = wanted.slice(column, column + span)
    column += span
    if (covered.length === 0) continue
    if (covered.every((width) => width === covered[0])) {
      setWidth(col, covered[0] ?? '')
      continue
    }
    // The columns this element covers no longer share a width, so it has to
    // become one element per column. Its other attributes come along; `span`
    // cannot, because each replacement now covers exactly one column.
    const parent = col.parentNode
    if (!parent) continue
    for (const width of covered) {
      const clone = col.cloneNode(false) as Element
      clone.removeAttribute('span')
      setWidth(clone, width)
      parent.insertBefore(clone, col)
    }
    parent.removeChild(col)
  }

  // More columns than the stored colgroup described. Bare `<col>` for each, so
  // the widths that follow land on the right column.
  for (; column < wanted.length; column += 1) {
    const col = parsed.group.ownerDocument.createElement('col')
    setWidth(col, wanted[column] ?? '')
    parsed.group.appendChild(col)
  }

  return parsed.group.outerHTML
}

/**
 * Insert a bare `<col>` so columns after `at` keep the `<col>` they already had.
 *
 * A spanned element that covers `at` is split around the insertion rather than
 * widened: the new column must not inherit the neighbour's class or width, which
 * is the same shift insert-without-a-patch produced for unspanned columns.
 */
export function colgroupHtmlInsertColumn(
  existing: string | null | undefined,
  at: number,
): string | null {
  const parsed = colsOf(existing)
  if (!parsed) return existing ?? null

  let column = 0
  for (const col of parsed.cols) {
    const span = spanOf(col)
    if (at <= column) {
      parsed.group.insertBefore(parsed.group.ownerDocument.createElement('col'), col)
      return parsed.group.outerHTML
    }
    if (at < column + span) {
      const left = at - column
      const right = span - left
      const parent = col.parentNode
      if (!parent) break
      if (left > 0) {
        const before = col.cloneNode(false) as Element
        setSpan(before, left)
        parent.insertBefore(before, col)
      }
      parent.insertBefore(parsed.group.ownerDocument.createElement('col'), col)
      setSpan(col, right)
      return parsed.group.outerHTML
    }
    column += span
  }

  parsed.group.appendChild(parsed.group.ownerDocument.createElement('col'))
  return parsed.group.outerHTML
}

/**
 * Drop the `<col>` covering column `at`, or decrement its `span` when it covers
 * more than one column.
 */
export function colgroupHtmlDeleteColumn(
  existing: string | null | undefined,
  at: number,
): string | null {
  const parsed = colsOf(existing)
  if (!parsed) return existing ?? null

  let column = 0
  for (const col of parsed.cols) {
    const span = spanOf(col)
    if (at >= column && at < column + span) {
      if (span <= 1) col.remove()
      else setSpan(col, span - 1)
      return parsed.group.outerHTML
    }
    column += span
  }
  return existing ?? null
}

/** Pad or trim so the colgroup describes exactly `columns` columns. */
function colgroupHtmlMatchWidth(existing: string | null | undefined, columns: number): string | null {
  const parsed = colsOf(existing)
  if (!parsed) return existing ?? null

  let coverage = 0
  for (const col of [...parsed.group.querySelectorAll('col')]) coverage += spanOf(col)

  while (coverage < columns) {
    parsed.group.appendChild(parsed.group.ownerDocument.createElement('col'))
    coverage += 1
  }
  while (coverage > columns) {
    const cols = [...parsed.group.querySelectorAll('col')]
    const last = cols[cols.length - 1]
    if (!last) break
    const span = spanOf(last)
    if (span <= 1) last.remove()
    else setSpan(last, span - 1)
    coverage -= 1
  }
  return parsed.group.outerHTML
}

function setSpan(col: Element, span: number): void {
  if (span <= 1) col.removeAttribute('span')
  else col.setAttribute('span', String(span))
}

function setWidth(col: Element, width: string): void {
  if (width) col.setAttribute('width', width)
  else col.removeAttribute('width')
}

export function setTableColgroup(widths: Array<string | null | undefined>): Command {
  return setTableAttrs({ colgroup: colgroupHtmlFromWidths(widths) })
}

/**
 * One width per column, from cells first, then the stored colgroup.
 *
 * The first row is not enough: merging it is exactly when its `colwidth`
 * becomes `[100, 0]`, and the other rows still hold the second column's 200.
 * Falling through to the colgroup covers the case where the width never lived
 * on a cell at all — inherited `<col width>` furniture — so a later resize
 * does not invent zeros that then blank those `<col>`s.
 */
function columnWidths(table: Node): Array<number | null> {
  const map = TableMap.get(table)
  const widths: Array<number | null> = Array.from({ length: map.width }, () => null)
  for (let row = 0; row < map.height; row += 1) {
    let previous = -1
    let offset = 0
    for (let col = 0; col < map.width; col += 1) {
      const pos = map.map[row * map.width + col] ?? 0
      if (pos === previous) offset += 1
      else {
        previous = pos
        offset = 0
      }
      if (widths[col] != null) continue
      const cell = table.nodeAt(pos)
      const width = (cell?.attrs['colwidth'] as number[] | null)?.[offset]
      if (typeof width === 'number' && width > 0) widths[col] = width
    }
  }
  const fromGroup = widthsFromColgroup(table.attrs['colgroup'] as string | null, map.width)
  for (let col = 0; col < map.width; col += 1) {
    if (widths[col] != null) continue
    const raw = fromGroup[col]
    if (!raw) continue
    const parsed = Number.parseInt(raw, 10)
    if (parsed > 0) widths[col] = parsed
  }
  return widths
}

function colgroupFromCellWidths(table: Node): string | null {
  const widths = columnWidths(table)
  if (widths.every((width) => width == null)) return null
  // Patched onto whatever the table already stored, for the same reason the
  // properties dialog patches: a column resize must not cost an inherited
  // colgroup its class or its other attributes.
  return colgroupHtmlWithWidths(
    table.attrs['colgroup'] as string | null,
    widths.map((width) => (width != null ? String(width) : '')),
  )
}

/**
 * What `colgroupFromCellWidths` last said about a given table node.
 *
 * The sync plugin below runs on every `docChanged` transaction and asks this
 * question of every table in the document -- so typing a character in a
 * paragraph rebuilt the `TableMap`, walked every cell and parsed the stored
 * colgroup HTML, for tables the transaction had not touched. With one resized
 * 100x20 table that was 1.8 ms of jsdom on the keystroke path.
 *
 * A node is a legitimate cache key because ProseMirror nodes are immutable and
 * persistent: an edit produces new nodes along the path it touched and reuses
 * every other node by identity, so an unchanged table IS the same object, and a
 * changed one cannot be. The answer is a pure function of the node -- its
 * `TableMap`, its cells' `colwidth`, its own `colgroup` attribute -- so an entry
 * cannot go stale without the key changing with it. Weak, so a node the document
 * has moved past is collectable.
 */
const colgroupForNode = new WeakMap<Node, string | null>()

function cachedColgroupFromCellWidths(table: Node): string | null {
  const known = colgroupForNode.get(table)
  // `null` is a real answer -- "this table has no resized columns" -- so the
  // miss test is `undefined`, not falsiness.
  if (known !== undefined) return known
  const computed = colgroupFromCellWidths(table)
  colgroupForNode.set(table, computed)
  return computed
}

/**
 * Keep `<colgroup>` in lockstep with column resizing.
 *
 * `prosemirror-tables` writes `colwidth` onto cells. That is enough for the
 * editor; it is not enough for stored HTML, whose column widths live on
 * `<col>`. Updating the furniture attribute after a resize is what makes
 * colgroup a first-class editing feature rather than a round-trip souvenir.
 *
 * Authored colgroups that are not the product of a resize are left alone:
 * inventing `<col>` elements for a table that never had widths would change
 * markup we had no reason to touch.
 */
export function colgroupSyncPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      let tr: Transaction | null = null
      state.doc.descendants((node, pos) => {
        if (node.type.spec['tableRole'] !== 'table') return true
        // Cached on the node: a transaction elsewhere in the document reuses
        // every table node it did not touch, so an untouched table answers from
        // the map instead of rebuilding its TableMap and reparsing its colgroup.
        const known = colgroupForNode.get(node)
        if (known !== undefined) return false

        const widths = columnWidths(node)
        const next = cachedColgroupFromCellWidths(node)
        const repairCells = spanningColwidthNeedsRepair(node, widths)
        const repairScope = cellScopeNeedsRepair(node)
        if (
          !repairCells &&
          !repairScope &&
          (next === null || next === node.attrs['colgroup'])
        ) {
          return false
        }
        tr ??= state.tr
        if (repairCells) writeColwidthOntoCells(tr, pos, node, widths, true)
        if (repairScope) applyCellScope(tr, pos, false)
        const current = tr.doc.nodeAt(pos) ?? node
        if (next !== null && next !== current.attrs['colgroup']) {
          tr.setNodeMarkup(pos, undefined, { ...current.attrs, colgroup: next })
        }
        return false
      })
      return tr
    },
  })
}

function spanningColwidthNeedsRepair(table: Node, widths: Array<number | null>): boolean {
  const map = TableMap.get(table)
  const seen = new Set<number>()
  for (let i = 0; i < map.map.length; i += 1) {
    const rel = map.map[i] ?? 0
    if (seen.has(rel)) continue
    seen.add(rel)
    const cell = table.nodeAt(rel)
    if (!cell) continue
    const colspan = (cell.attrs['colspan'] as number) || 1
    if (colspan < 2) continue
    const col = i % map.width
    const next = colwidthForSpan(widths, col, col + colspan)
    if (next === null) continue
    if (!sameColwidth(cell.attrs['colwidth'] as number[] | null, next)) return true
  }
  return false
}

function cellScopeNeedsRepair(table: Node): boolean {
  const header = table.type.schema.nodes['table_header']
  const cell = table.type.schema.nodes['table_cell']
  if (!header || !cell) return false
  let needed = false
  table.forEach((row, _rowOffset, rowIndex) => {
    row.forEach((cellNode, _cellOffset, cellIndex) => {
      if (cellNode.type === cell && cellNode.attrs['scope']) {
        needed = true
        return
      }
      if (cellNode.type !== header) return
      const current = scopeOf(cellNode)
      if (current === null) return
      const expected = expectedHeaderScope(
        rowIndex,
        cellIndex,
        (cellNode.attrs['colspan'] as number) || 1,
        (cellNode.attrs['rowspan'] as number) || 1,
      )
      if (scopeSpanMismatch(current, expected)) needed = true
    })
  })
  return needed
}

export function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function colorOrNull(value: string | undefined): string | null {
  const trimmed = emptyToNull(value)
  return trimmed ? safeColor(trimmed) : null
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}
