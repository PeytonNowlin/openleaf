/**
 * Table commands that are not already in `prosemirror-tables`.
 *
 * Property edits, caption/colgroup, nested insert and vertical alignment live
 * here so a test can apply them without standing up a toolbar.
 */

import { canInsert, isNodeActive, parseDeclarations, safeColor, serializeDeclarations } from '@openleaf-editor/core'
import type { Node, ResolvedPos } from 'prosemirror-model'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import { Plugin } from 'prosemirror-state'
import {
  addColumnAfter as addColumnAfterRaw,
  addColumnBefore as addColumnBeforeRaw,
  addRowAfter as addRowAfterRaw,
  addRowBefore as addRowBeforeRaw,
  CellSelection,
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

function applyCellScope(tr: Transaction): Transaction {
  const header = tr.doc.type.schema.nodes['table_header']
  const cell = tr.doc.type.schema.nodes['table_cell']
  if (!header || !cell) return tr

  let tablePos = -1
  for (let depth = tr.selection.$from.depth; depth > 0; depth -= 1) {
    if (tr.selection.$from.node(depth).type.spec['tableRole'] === 'table') {
      tablePos = tr.selection.$from.before(depth)
      break
    }
  }
  if (tablePos < 0) return tr

  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr

  table.forEach((row, rowOffset, rowIndex) => {
    const rowPos = tablePos + 1 + rowOffset
    row.forEach((cellNode, cellOffset, cellIndex) => {
      const pos = rowPos + 1 + cellOffset
      if (cellNode.type === cell && cellNode.attrs['scope']) {
        tr.setNodeMarkup(pos, undefined, { ...cellNode.attrs, scope: null })
        return
      }
      if (cellNode.type !== header) return
      const scope = cellNode.attrs['scope']
      if (scope !== null && scope !== undefined && scope !== '') return
      tr.setNodeMarkup(pos, undefined, {
        ...cellNode.attrs,
        scope: rowIndex === 0 || cellIndex > 0 ? 'col' : 'row',
      })
    })
  })
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

export const addColumnAfter = withCellScope(addColumnAfterRaw)
export const addColumnBefore = withCellScope(addColumnBeforeRaw)
export const addRowAfter = withCellScope(addRowAfterRaw)
export const addRowBefore = withCellScope(addRowBeforeRaw)
export const toggleHeaderRow = withCellScope(toggleHeaderRowRaw)

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

export function mergeStyle(
  existing: string | null | undefined,
  patch: Record<string, string | null>,
): string | null {
  const declarations = parseDeclarations(existing)
  for (const [name, value] of Object.entries(patch)) {
    if (!value) declarations.delete(name)
    else declarations.set(name, value)
  }
  return serializeDeclarations(declarations)
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

export function widthsFromColgroup(html: string | null | undefined, columns: number): string[] {
  const widths = Array.from({ length: columns }, () => '')
  if (!html) return widths
  if (typeof document === 'undefined') return widths
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const cols = [...tpl.content.querySelectorAll('col')]
  cols.forEach((col, index) => {
    if (index < columns) widths[index] = col.getAttribute('width') ?? ''
  })
  return widths
}

export function setTableColgroup(widths: Array<string | null | undefined>): Command {
  return setTableAttrs({ colgroup: colgroupHtmlFromWidths(widths) })
}

function colgroupFromCellWidths(table: Node): string | null {
  const map = TableMap.get(table)
  const widths: string[] = []
  let any = false
  for (let col = 0; col < map.width; col += 1) {
    const cell = table.nodeAt(map.map[col] ?? 0)
    const colwidth = cell?.attrs['colwidth'] as number[] | null
    if (colwidth?.[0]) {
      widths.push(String(colwidth[0]))
      any = true
    } else {
      widths.push('')
    }
  }
  return any ? colgroupHtmlFromWidths(widths) : null
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
        const next = colgroupFromCellWidths(node)
        if (next === null) return false
        if (next === node.attrs['colgroup']) return false
        tr ??= state.tr
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, colgroup: next })
        return false
      })
      return tr
    },
  })
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
