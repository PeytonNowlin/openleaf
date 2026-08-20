/**
 * Table commands that are not already in `prosemirror-tables`.
 *
 * Property edits, caption/colgroup, nested insert and vertical alignment live
 * here so a test can apply them without standing up a toolbar.
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
 * Rewrite header cell `scope` for the table the selection is in.
 *
 * The selection is captured and restored around the rewrite. Every change here
 * is a `setNodeMarkup`, which replaces the cell node, and mapping a text
 * selection through a replacement can drag it to the node boundary. The symptom
 * was not a broken caret but a broken command: inserting a row moved the caret
 * out of the cell the author was editing, so the next table command found no
 * cell and did nothing at all.
 */
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

  // Only a plain text selection needs restoring: CellSelection maps itself and
  // stays a CellSelection, which is what multi-cell commands act on.
  const restore = tr.selection instanceof TextSelection ? tr.selection.from : null
  const stepsBefore = tr.steps.length

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

function setWidth(col: Element, width: string): void {
  if (width) col.setAttribute('width', width)
  else col.removeAttribute('width')
}

export function setTableColgroup(widths: Array<string | null | undefined>): Command {
  return setTableAttrs({ colgroup: colgroupHtmlFromWidths(widths) })
}

function colgroupFromCellWidths(table: Node): string | null {
  const map = TableMap.get(table)
  const widths: string[] = []
  let any = false
  // A cell spanning several columns appears in the map once per column it
  // covers, and its `colwidth` holds one entry per covered column. `offset`
  // tracks how far into that run this column is: reading entry 0 every time
  // wrote the first column's width to every <col> the cell spans, so resizing a
  // later column of a merged cell corrupted the stored colgroup.
  let previous = -1
  let offset = 0
  for (let col = 0; col < map.width; col += 1) {
    const pos = map.map[col] ?? 0
    if (pos === previous) offset += 1
    else {
      previous = pos
      offset = 0
    }
    const cell = table.nodeAt(pos)
    const colwidth = cell?.attrs['colwidth'] as number[] | null
    const width = colwidth?.[offset]
    if (width) {
      widths.push(String(width))
      any = true
    } else {
      widths.push('')
    }
  }
  // Patched onto whatever the table already stored, for the same reason the
  // properties dialog patches: a column resize must not cost an inherited
  // colgroup its class or its other attributes.
  return any ? colgroupHtmlWithWidths(table.attrs['colgroup'] as string | null, widths) : null
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
