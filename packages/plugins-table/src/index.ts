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
import type { Node as PMNode } from 'prosemirror-model'
import type { Command } from 'prosemirror-state'
import type { ViewMutationRecord } from 'prosemirror-view'
import {
  columnResizing,
  deleteTable,
  mergeCells,
  splitCell,
  tableEditing,
  TableView,
} from 'prosemirror-tables'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  colgroupSyncPlugin,
  deleteColumn,
  deleteRow,
  inTable,
  insertTable,
  toggleHeaderRow,
} from './commands.js'
import { openCaptionDialog, openCellProperties, openRowProperties, openTableProperties } from './dialogs.js'
import { buildInsertGrid } from './grid.js'
import { TABLE_ICON_PATHS } from './icons.js'
import { tableContextMenu } from './menu.js'
import { nestedTablePastePlugin } from './paste.js'
import { COLUMN_RESIZE_HANDLE_WIDTH, nestedColumnResizePlugin } from './resize.js'
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

/**
 * `TableView`, plus the caption it does not know about.
 *
 * `columnResizing` installs a node view for tables, and that node view builds
 * the element itself: a wrapper div, a `<colgroup>` it owns for resize widths,
 * and a `<tbody>`. It never consults the table node's `toDOM`, so once this
 * bundle loads, the caption core renders is simply absent from the editor.
 *
 * That produced the worst version of the bug it was meant to fix. Saving still
 * kept the caption -- serialization goes through `toDOM` and never through a
 * node view -- so the caption was invisible while editing and reappeared in the
 * stored HTML. An author would reasonably conclude it had been deleted, and the
 * only way to find out otherwise is to read the database.
 *
 * Only the caption is re-added. The preserved `<colgroup>` markup deliberately
 * is not: this view's own colgroup is what drives column resizing, and a second
 * one would fight it for the same columns. The author's colgroup is still
 * stored and still emitted on save; it is the resize widths that win on screen,
 * which is the same bargain the resizing feature already makes.
 */
class CaptionedTableView extends TableView {
  constructor(node: PMNode, defaultCellMinWidth: number) {
    super(node, defaultCellMinWidth)
    this.syncCaption(node)
  }

  override update(node: PMNode): boolean {
    const handled = super.update(node)
    if (handled) this.syncCaption(node)
    return handled
  }

  override ignoreMutation(record: ViewMutationRecord): boolean {
    // The caption is ours, not content. Without this, ProseMirror treats a
    // change inside it as an edit to the document and tries to re-read it.
    const caption = this.currentCaption()
    if (caption && record.target instanceof Node && caption.contains(record.target)) return true
    return super.ignoreMutation(record)
  }

  private currentCaption(): HTMLElement | null {
    const first = this.table.firstElementChild
    return first && first.nodeName === 'CAPTION' ? (first as HTMLElement) : null
  }

  private syncCaption(node: PMNode): void {
    const html = (node.attrs['caption'] as string | null) ?? null
    const existing = this.currentCaption()

    if (!html) {
      existing?.remove()
      return
    }

    // Rebuild only when the markup actually changed. Replacing it on every
    // update would discard the DOM under the user's selection on every
    // keystroke inside the table.
    if (existing && existing.getAttribute('data-openleaf-caption') === html) return

    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const rebuilt = tpl.content.firstElementChild
    if (!rebuilt || rebuilt.nodeName !== 'CAPTION') {
      existing?.remove()
      return
    }

    // Editor-only. The caption is not part of `contentDOM`, so a caret must not
    // enter it. `toDOM` no longer stamps this: clipboard serialization shares
    // that path and would persist the marker. This view never runs on save.
    rebuilt.setAttribute('contenteditable', 'false')
    rebuilt.setAttribute('data-openleaf-caption', html)

    // A caption must be the table's first child for the browser to render it.
    if (existing) existing.replaceWith(rebuilt)
    else this.table.insertBefore(rebuilt, this.table.firstChild)
  }
}

/** The ProseMirror plugins table editing needs. */
export function tableEditingPlugins() {
  return [
    // `EditorView.someProp` walks from the start of this list and stops at the
    // first handler that returns true. Nested-table hit-testing has to run
    // *before* `columnResizing` so it can claim an outer border; `columnResizing`
    // has to run *before* `tableEditing` so a mousedown on a handle is a drag
    // rather than a cell selection. Paste nesting has to run *before*
    // `tableEditing` so a closed table at a text caret is not unwrapped into
    // `insertCells`.
    nestedColumnResizePlugin(COLUMN_RESIZE_HANDLE_WIDTH),
    columnResizing({
      View: CaptionedTableView,
      handleWidth: COLUMN_RESIZE_HANDLE_WIDTH,
    }),
    nestedTablePastePlugin(),
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
  deleteColumn,
  deleteRow,
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
  deleteTable,
  mergeCells,
  splitCell,
} from 'prosemirror-tables'
