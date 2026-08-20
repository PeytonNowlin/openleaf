/**
 * Table, row and cell property dialogs.
 *
 * These are the editing surface for attributes the schema already stores:
 * border, padding, background, alignment, caption and column widths. A caption
 * is still an attribute rather than a child node -- see tables.ts -- so this
 * dialog is how an author changes it without an upstream cell-map fix.
 */

import { parseDeclarations } from '@openleaf-editor/core'
import { promptFields, type FieldSpec } from '@openleaf-editor/ui'
import type { EditorView } from 'prosemirror-view'
import { TableMap } from 'prosemirror-tables'
import {
  captionHtmlFromText,
  captionTextFromHtml,
  colorOrNull,
  colgroupHtmlWithWidths,
  emptyToNull,
  findCell,
  findRow,
  findTable,
  mergeStyle,
  setCellAttrs,
  setRowAttrs,
  setTableAttrs,
  setTableCaption,
  styleValueOrNull,
  widthsFromColgroup,
} from './commands.js'

const ALIGN_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
] as const

const VALIGN_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
] as const

function select(
  name: string,
  label: string,
  value: string | null | undefined,
  options: typeof ALIGN_OPTIONS | typeof VALIGN_OPTIONS,
): FieldSpec {
  return { name, label, value: value ?? '', options: [...options] }
}

function backgroundField(value: string | undefined): FieldSpec {
  return {
    name: 'background',
    label: 'Background',
    value: value ?? '',
    hint: 'A CSS colour, for example #cc0000.',
  }
}

export async function openTableProperties(view: EditorView, host: HTMLElement): Promise<void> {
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const attrs = table.node.attrs
  const style = parseDeclarations(attrs['style'] as string | null)
  const columns = TableMap.get(table.node).width
  const widths = widthsFromColgroup(attrs['colgroup'] as string | null, columns)

  const result = await promptFields<Record<string, string>>(
    host.ownerDocument,
    'Table properties',
    [
      { name: 'border', label: 'Border', value: (attrs['border'] as string | null) ?? '' },
      { name: 'cellpadding', label: 'Cell padding', value: (attrs['cellpadding'] as string | null) ?? '' },
      { name: 'cellspacing', label: 'Cell spacing', value: (attrs['cellspacing'] as string | null) ?? '' },
      { name: 'width', label: 'Width', value: (attrs['width'] as string | null) ?? style.get('width') ?? '' },
      select('align', 'Alignment', attrs['align'] as string | null, ALIGN_OPTIONS),
      backgroundField(style.get('background-color')),
      {
        name: 'caption',
        label: 'Caption',
        value: captionTextFromHtml(attrs['caption'] as string | null),
        hint: 'The table’s accessible name. Shown above the grid.',
      },
      {
        name: 'columns',
        label: 'Column widths',
        value: widths.join(', '),
        hint: 'Comma-separated, one value per column. Empty slots are omitted.',
      },
    ],
    {},
    (values) => ({ value: values }),
  )
  if (!result) return

  const parsed = (result['columns'] ?? '').split(',').map((part) => emptyToNull(part))
  while (parsed.length < columns) parsed.push(null)

  setTableAttrs({
    border: emptyToNull(result['border']),
    cellpadding: emptyToNull(result['cellpadding']),
    cellspacing: emptyToNull(result['cellspacing']),
    width: emptyToNull(result['width']),
    align: emptyToNull(result['align']),
    caption: captionHtmlFromText(result['caption'] ?? '', attrs['caption'] as string | null),
    // Patched, not rebuilt: the stored colgroup may carry a class, a span, or
    // attributes from whatever wrote it, and a save that changes no width must
    // not throw those away.
    colgroup: colgroupHtmlWithWidths(attrs['colgroup'] as string | null, parsed.slice(0, columns)),
    style: mergeStyle(attrs['style'] as string | null, {
      'background-color': colorOrNull(result['background']),
      width: null,
    }),
  })(view.state, view.dispatch)
}

export async function openRowProperties(view: EditorView, host: HTMLElement): Promise<void> {
  const row = findRow(view.state.selection.$from)
  if (!row) return
  const attrs = row.node.attrs
  const style = parseDeclarations(attrs['style'] as string | null)

  const result = await promptFields<Record<string, string>>(
    host.ownerDocument,
    'Row properties',
    [
      select('align', 'Alignment', attrs['align'] as string | null, ALIGN_OPTIONS),
      select('valign', 'Vertical alignment', attrs['valign'] as string | null, VALIGN_OPTIONS),
      backgroundField(style.get('background-color')),
    ],
    {},
    (values) => ({ value: values }),
  )
  if (!result) return

  setRowAttrs({
    align: emptyToNull(result['align']),
    valign: emptyToNull(result['valign']),
    style: mergeStyle(attrs['style'] as string | null, {
      'background-color': colorOrNull(result['background']),
    }),
  })(view.state, view.dispatch)
}

export async function openCellProperties(view: EditorView, host: HTMLElement): Promise<void> {
  const cell = findCell(view.state.selection.$from)
  if (!cell) return
  const attrs = cell.node.attrs
  const style = parseDeclarations(attrs['style'] as string | null)

  const result = await promptFields<Record<string, string>>(
    host.ownerDocument,
    'Cell properties',
    [
      { name: 'width', label: 'Width', value: (attrs['width'] as string | null) ?? '' },
      { name: 'height', label: 'Height', value: (attrs['height'] as string | null) ?? '' },
      { name: 'padding', label: 'Padding', value: style.get('padding') ?? '' },
      select('align', 'Alignment', attrs['align'] as string | null, ALIGN_OPTIONS),
      select('valign', 'Vertical alignment', attrs['valign'] as string | null, VALIGN_OPTIONS),
      backgroundField(style.get('background-color')),
    ],
    {},
    // Reported rather than silently dropped: mergeStyle would refuse the value
    // anyway, and an author who typed something is owed the reason it went.
    (values) => {
      const padding = emptyToNull(values['padding'])
      if (padding !== null && styleValueOrNull('padding', padding) === null) {
        return { error: 'Padding takes one to four lengths, for example 4px or 2px 4px.' }
      }
      return { value: values }
    },
  )
  if (!result) return

  setCellAttrs({
    width: emptyToNull(result['width']),
    height: emptyToNull(result['height']),
    align: emptyToNull(result['align']),
    valign: emptyToNull(result['valign']),
    style: mergeStyle(attrs['style'] as string | null, {
      'background-color': colorOrNull(result['background']),
      padding: emptyToNull(result['padding']),
    }),
  })(view.state, view.dispatch)
}

export async function openCaptionDialog(view: EditorView, host: HTMLElement): Promise<void> {
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const result = await promptFields<{ caption: string }>(
    host.ownerDocument,
    'Table caption',
    [
      {
        name: 'caption',
        label: 'Caption',
        value: captionTextFromHtml(table.node.attrs['caption'] as string | null),
        hint: 'The table’s accessible name.',
      },
    ],
    {},
    (values) => ({ value: { caption: values['caption'] ?? '' } }),
  )
  if (!result) return
  setTableCaption(result.caption)(view.state, view.dispatch)
}
