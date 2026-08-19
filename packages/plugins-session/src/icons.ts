/**
 * Session-tool icons. Stroked 24x24 paths, no letterforms.
 *
 * Save is a downward arrow into a tray rather than a floppy disk: the disk is a
 * metaphor that no longer describes what the control does, and it is still a
 * picture of Latin-script storage hardware. Preview is an eye, print is a
 * printer, find is a lens, new document is a blank page.
 */

export const SESSION_ICONS: Record<string, string> = {
  find: 'M11 5a6 6 0 1 0 .01 0M20 20l-4-4',
  wordCount: 'M4 7h16M4 12h10M4 17h13',
  save: 'M12 3v12M8 11l4 4 4-4M4 21h16',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 12a2 2 0 1 0 .01 0',
  print: 'M6 9V3h12v6M6 18H5a2 2 0 0 1-2-2v-5h18v5a2 2 0 0 1-2 2h-1M6 14h12v7H6z',
  newDocument: 'M7 3h8l5 5v13H7zM15 3v5h5M12 12v6M9 15h6',
}
