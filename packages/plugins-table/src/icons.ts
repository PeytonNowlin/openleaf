/**
 * Table icons, registered by the plugin rather than shipped in core.
 *
 * Eleven icons is about a kilobyte, and a deployment with tables switched off has
 * no reason to download it. Same 24x24 stroked geometry as the built-in set so
 * they sit level with the rest of the toolbar.
 */

export const TABLE_ICON_PATHS: Record<string, string> = {
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16',
  rowBefore: 'M3 14h18v6H3zM12 3v7M9 6l3-3 3 3',
  rowAfter: 'M3 4h18v6H3zM12 21v-7M9 18l3 3 3-3',
  rowDelete: 'M3 9h18v6H3zM8 4l8 16M16 4L8 20',
  columnBefore: 'M14 3v18h6V3zM3 12h7M6 9l-3 3 3 3',
  columnAfter: 'M4 3v18h6V3zM21 12h-7M18 9l3 3-3 3',
  columnDelete: 'M9 3h6v18H9zM4 8l16 8M20 8L4 16',
  mergeCells: 'M3 5h18v14H3zM12 5v3M12 16v3M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2',
  splitCell: 'M3 5h18v14H3zM12 5v14M9 9l-2 3 2 3M15 9l2 3-2 3',
  headerRow: 'M3 4h18v5H3zM3 9v11h18V9M3 14h18M9 9v11M15 9v11',
  tableDelete: 'M3 4h18v16H3zM3 10h18M9 4v16M8 14l8-8M16 14l-8-8',
  tableProperties: 'M3 4h18v16H3zM3 10h18M9 4v16M16 14h4M18 12v4',
  rowProperties: 'M3 9h18v6H3zM16 6h4M18 4v4',
  cellProperties: 'M3 4h18v16H3zM12 4v16M3 12h18M16 8h4M18 6v4',
  tableCaption: 'M3 9h18v11H3zM7 4h10M12 4v3',
}
