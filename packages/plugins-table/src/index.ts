/**
 * Opt-in table editing.
 *
 * ## What is and is not in this package
 *
 * The table *schema* is not here -- it lives in `@openleaf-editor/core` and ships in
 * every deployment. That split is deliberate and the fidelity harness is what
 * forced it: without table node types in the base schema, a `<table>` in stored
 * content is claimed by the preservation layer and becomes an opaque atom.
 * Faithful, but uneditable. "We read your tables but you may not touch them" is
 * not something you can tell a CMS.
 *
 * So everyone gets tables that read and write correctly, for about a kilobyte.
 * What is opt-in is the weight: cell selection, column resizing, the row and
 * column commands, property dialogs, the insert grid, the context menu, and the
 * toolbar controls.
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
 * carrying its own copy.
 *
 * Or as a module:
 *
 * ```ts
 * import { installTableEditing } from '@openleaf-editor/plugins-table'
 * installTableEditing()
 * ```
 */

import { registerEditorPlugin } from '@openleaf-editor/core'
import { registerIcons, registerStyles, registerToolbarItem } from '@openleaf-editor/ui'
import type { Command } from 'prosemirror-state'
import {
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  tableEditing,
} from 'prosemirror-tables'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  colgroupSyncPlugin,
  inTable,
  insertTable,
  toggleHeaderRow,
} from './commands.js'
import { openCaptionDialog, openCellProperties, openRowProperties, openTableProperties } from './dialogs.js'
import { buildInsertGrid } from './grid.js'
import { TABLE_ICON_PATHS } from './icons.js'
import { tableContextMenu } from './menu.js'
import { TABLE_UI_CSS } from './styles.js'

export const TABLE_TOOLBAR_ITEMS = [
  'insertTable',
  'tableProperties',
  'rowProperties',
  'cellProperties',
  'tableCaption',
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

/** The ProseMirror plugins table editing needs. */
export function tableEditingPlugins() {
  return [
    // Resizing must come first: it reads cell geometry that tableEditing's
    // selection handling would otherwise have already consumed.
    columnResizing(),
    tableEditing({ allowTableNodeSelection: true }),
    colgroupSyncPlugin(),
    tableContextMenu(),
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
  registerStyles(TABLE_UI_CSS)
  registerEditorPlugin(() => tableEditingPlugins())

  registerToolbarItem({
    id: 'insertTable',
    type: 'custom',
    label: 'Insert table',
    icon: 'table',
    render: (ctx) => buildInsertGrid(ctx),
    isEnabled: (state) => insertTable()(state),
  })

  const dialogs: Array<[string, string, string, (view: Parameters<typeof openTableProperties>[0], host: HTMLElement) => Promise<void>]> = [
    ['tableProperties', 'Table properties', 'tableProperties', openTableProperties],
    ['rowProperties', 'Row properties', 'rowProperties', openRowProperties],
    ['cellProperties', 'Cell properties', 'cellProperties', openCellProperties],
    ['tableCaption', 'Table caption', 'tableCaption', openCaptionDialog],
  ]

  for (const [id, label, icon, open] of dialogs) {
    registerToolbarItem({
      id,
      type: 'button',
      kind: 'action',
      label,
      icon,
      run: ({ view, host }) => {
        void open(view, host)
      },
      isEnabled: (state) => inTable(state),
    })
  }

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
      isEnabled: (state) => inTable(state) && command(state),
    })
  }
}

export {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  colgroupHtmlWithWidths,
  colgroupSyncPlugin,
  inTable,
  insertTable,
  mergeStyle,
  setCellAttrs,
  setCellVerticalAlign,
  setRowAttrs,
  setTableAttrs,
  setTableCaption,
  setTableColgroup,
  styleValueOrNull,
  toggleHeaderRow,
  widthsFromColgroup,
} from './commands.js'

export { buildInsertGrid, GRID_SIZE } from './grid.js'
export { tableContextMenu } from './menu.js'

export {
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
} from 'prosemirror-tables'
