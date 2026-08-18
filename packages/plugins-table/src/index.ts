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
 * column commands, and the toolbar controls -- roughly 25 KB that a site
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
 * carrying its own copy, which is what keeps it 25 KB instead of 200 KB.
 *
 * Or as a module:
 *
 * ```ts
 * import { installTableEditing } from '@openleaf/plugins-table'
 * installTableEditing()
 * ```
 */

import {
  canInsert,
  isNodeActive,
  registerEditorPlugin,
  schema,
} from '@openleaf/core'
import { registerIcons, registerToolbarItem } from '@openleaf/ui'
import { TABLE_ICON_PATHS } from './icons.js'
import type { Command, EditorState } from 'prosemirror-state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  tableEditing,
  toggleHeaderRow,
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
      const cell = schema.nodes['table_cell']
      const header = schema.nodes['table_header']
      const row = schema.nodes['table_row']
      const tableType = schema.nodes['table']
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
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeaderRow,
} from 'prosemirror-tables'
