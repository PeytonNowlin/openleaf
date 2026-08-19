/**
 * Opt-in table editing.
 *
 * ## What is and is not in this package
 *
 * The table *schema* is not here -- it lives in `@openleaf/core` and ships in
 * every deployment. That split is deliberate and the fidelity harness is what
 * forced it: without table node types in the base schema, a `<table>` in stored
 * content is claimed by the preservation layer and becomes an opaque atom.
 * Faithful, but uneditable. "We read your tables but you may not touch them" is
 * not something you can tell a CMS.
 *
 * So everyone gets tables that read and write correctly, for about a kilobyte.
 * What is opt-in is the weight: cell selection, column resizing, the row and
 * column commands, and the toolbar controls -- 12.5 KB gzipped that a site
 * forbidding tables has no reason to download.
 *
 * ## Loading it
 *
 * As a second script tag, after the core bundle:
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-tables.min.js"></script>
 * ```
 *
 * The second bundle shares the first one's ProseMirror runtime rather than
 * carrying its own copy, which is what keeps it 12.5 KB instead of ~200 KB.
 *
 * Or as a module:
 *
 * ```ts
 * import { installTableEditing } from '@openleaf/plugins-table'
 * installTableEditing()
 * ```
 */

import { canInsert, isNodeActive, registerEditorPlugin } from '@openleaf/core'
import { registerIcons, registerToolbarItem } from '@openleaf/ui'
import { TABLE_ICON_PATHS } from './icons.js'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import {
  addColumnAfter as addColumnAfterRaw,
  addColumnBefore as addColumnBeforeRaw,
  addRowAfter as addRowAfterRaw,
  addRowBefore as addRowBeforeRaw,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  tableEditing,
  toggleHeaderRow as toggleHeaderRowRaw,
} from 'prosemirror-tables'

export const TABLE_TOOLBAR_ITEMS = [
  'insertTable',
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'deleteTable',
] as const

/** A layout string for the default toolbar plus the table controls. */
export const TABLE_LAYOUT_SUFFIX = ` | ${TABLE_TOOLBAR_ITEMS.join(' ')}`

/** Is the selection inside a table? Table commands are useless outside one. */
export function inTable(state: EditorState): boolean {
  return isNodeActive(state, 'table')
}

/**
 * Insert a table with a header row.
 *
 * A header row by default rather than a plain grid: a table without headers is
 * an accessibility problem that authors rarely go back and fix, and defaults
 * decide what most documents look like.
 */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    if (!canInsert(state, 'table')) return false
    if (dispatch) {
      // From the state's schema, not an imported singleton: a plugin that
      // captured one schema would build nodes the editor's schema rejects.
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
 * Keep `scope` valid when cells change role.
 *
 * `td` and `th` share an attribute set, so the upstream toggle copies `scope`
 * onto a body cell (invalid HTML) and creates header cells without it.
 * Inserting a table already writes `scope="col"`; toggling and adding columns
 * should not undo that.
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

  // Walked by row and column rather than as a flat descendant list, because a
  // header's scope depends on where it sits. `setNodeMarkup` only changes
  // attributes, so every node keeps its size and these positions stay valid.
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
      // A header in the top row labels a column. A header that opens a later
      // row labels that row -- writing "col" there tells a screen reader the
      // opposite of the truth, which is worse than the missing scope this
      // replaces.
      tr.setNodeMarkup(pos, undefined, {
        ...cellNode.attrs,
        scope: rowIndex === 0 || cellIndex > 0 ? 'col' : 'row',
      })
    })
  })
  return tr
}

function withCellScope(command: Command): Command {
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

/** The ProseMirror plugins table editing needs. */
export function tableEditingPlugins() {
  return [
    // Resizing must come first: it reads cell geometry that tableEditing's
    // selection handling would otherwise have already consumed.
    columnResizing(),
    tableEditing({ allowTableNodeSelection: true }),
  ]
}

let installed = false

/**
 * Install table editing: register the plugins and the toolbar controls.
 *
 * Idempotent, because a bundle loaded twice -- which happens in CMS templates
 * more often than anyone would like -- should not produce two sets of buttons.
 */
export function installTableEditing(): void {
  if (installed) return
  installed = true

  registerIcons(TABLE_ICON_PATHS)
  registerEditorPlugin(() => tableEditingPlugins())

  registerToolbarItem({
    id: 'insertTable',
    type: 'button',
    kind: 'action',
    label: 'Insert table',
    icon: 'table',
    command: insertTable(),
  })

  const commands: Array<[string, string, Command]> = [
    ['addRowBefore', 'Insert row above', addRowBefore],
    ['addRowAfter', 'Insert row below', addRowAfter],
    ['deleteRow', 'Delete row', deleteRow],
    ['addColumnBefore', 'Insert column before', addColumnBefore],
    ['addColumnAfter', 'Insert column after', addColumnAfter],
    ['deleteColumn', 'Delete column', deleteColumn],
    ['mergeCells', 'Merge cells', mergeCells],
    ['splitCell', 'Split cell', splitCell],
    ['toggleHeaderRow', 'Toggle header row', toggleHeaderRow],
    ['deleteTable', 'Delete table', deleteTable],
  ]

  const icons: Record<string, string> = {
    addRowBefore: 'rowBefore',
    addRowAfter: 'rowAfter',
    deleteRow: 'rowDelete',
    addColumnBefore: 'columnBefore',
    addColumnAfter: 'columnAfter',
    deleteColumn: 'columnDelete',
    mergeCells: 'mergeCells',
    splitCell: 'splitCell',
    toggleHeaderRow: 'headerRow',
    deleteTable: 'tableDelete',
  }

  for (const [id, label, command] of commands) {
    registerToolbarItem({
      id,
      type: 'button',
      kind: 'action',
      label,
      ...(icons[id] ? { icon: icons[id] } : {}),
      command,
      // Every one of these is meaningless outside a table. Reporting them as
      // disabled rather than letting them silently no-op is the difference
      // between a control that looks broken and one that looks unavailable.
      isEnabled: (state) => inTable(state) && command(state),
    })
  }
}

export {
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
} from 'prosemirror-tables'
