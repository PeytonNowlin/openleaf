/**
 * Keyboard shortcuts.
 *
 * Bindings follow whatever convention the largest number of users already have
 * in their fingers, which usually means Word and Google Docs rather than
 * anything invented here. Where those disagree, the web convention wins,
 * because this editor lives in a browser.
 *
 * `Mod` resolves to Cmd on macOS and Ctrl elsewhere.
 *
 * ## On Tab
 *
 * Tab is deliberately NOT bound to list indentation, even though Word does it
 * and users ask for it. Inside a `contenteditable`, capturing Tab removes the
 * only way a keyboard user has to leave the editor, which is a WCAG 2.1.2
 * keyboard-trap failure -- and for the institutional users who most need a free
 * editor, that is a procurement blocker rather than a rough edge.
 *
 * Indentation uses `Mod-[` and `Mod-]` instead, matching Google Docs and
 * VS Code. If Tab is ever added it must come with a documented escape (Escape
 * then Tab, or a first-Tab-escapes heuristic) and real screen reader testing.
 */

import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import type { Command } from 'prosemirror-state'
import {
  indentListItem,
  insertHorizontalRule,
  outdentListItem,
  setParagraph,
  toggleTextAlign,
  splitListItemCommand,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleUnderline,
} from './commands.js'

/** A shortcut, its command, and a human label for the help surface. */
export interface Shortcut {
  keys: string
  command: Command
  label: string
}

/**
 * The default shortcut table.
 *
 * Exported as data rather than as a finished keymap so that an integrator can
 * remove a binding that collides with their own application, and so the help
 * dialog and the toolbar tooltips can render the real bindings instead of a
 * hand-maintained duplicate list that drifts.
 */
export const shortcuts: Shortcut[] = [
  // Marks. Mod-b/i/u are universal; Mod-Shift-x and Mod-e follow GitHub.
  { keys: 'Mod-b', command: toggleBold, label: 'Bold' },
  { keys: 'Mod-i', command: toggleItalic, label: 'Italic' },
  // Note: Mod-u is a View Source accelerator in some browsers. It has not been
  // a problem in testing, but if it becomes one the workaround belongs here.
  { keys: 'Mod-u', command: toggleUnderline, label: 'Underline' },
  { keys: 'Mod-Shift-x', command: toggleStrike, label: 'Strikethrough' },
  { keys: 'Mod-e', command: toggleInlineCode, label: 'Inline code' },

  // Blocks. Mod-Alt-N for headings matches Google Docs.
  { keys: 'Mod-Alt-0', command: setParagraph, label: 'Paragraph' },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    keys: `Mod-Alt-${level}`,
    command: toggleHeading(level),
    label: `Heading ${level}`,
  })),
  { keys: 'Mod-Shift-.', command: toggleBlockquote, label: 'Blockquote' },
  { keys: 'Mod-Alt-c', command: toggleCodeBlock, label: 'Code block' },
  { keys: 'Mod-Shift-Enter', command: insertHorizontalRule, label: 'Horizontal rule' },

  // Alignment. Mod-Shift-L/E/R/J is Word and Google Docs, unchanged since the
  // nineties, and it is one of the few shortcut families authors actually have
  // in their fingers. There is deliberately no binding for "clear alignment":
  // pressing the one already in force does that, which is what the same keys do
  // in both of those editors.
  { keys: 'Mod-Shift-l', command: toggleTextAlign('left'), label: 'Align left' },
  { keys: 'Mod-Shift-e', command: toggleTextAlign('center'), label: 'Align centre' },
  { keys: 'Mod-Shift-r', command: toggleTextAlign('right'), label: 'Align right' },
  { keys: 'Mod-Shift-j', command: toggleTextAlign('justify'), label: 'Justify' },

  // Lists. Mod-Shift-7/8 matches Word and Google Docs.
  { keys: 'Mod-Shift-7', command: toggleOrderedList, label: 'Numbered list' },
  { keys: 'Mod-Shift-8', command: toggleBulletList, label: 'Bulleted list' },
  { keys: 'Mod-]', command: indentListItem, label: 'Indent list item' },
  { keys: 'Mod-[', command: outdentListItem, label: 'Outdent list item' },

  // History.
  { keys: 'Mod-z', command: undo, label: 'Undo' },
  { keys: 'Mod-Shift-z', command: redo, label: 'Redo' },
  { keys: 'Mod-y', command: redo, label: 'Redo' },
]

/**
 * Build the keymap bindings object.
 *
 * `Enter` chains: splitting a list item must be tried before ProseMirror's
 * default paragraph split, or pressing Enter in a list creates a paragraph
 * instead of the next bullet.
 */
export function buildKeymap(
  custom: Record<string, Command> = {},
): Record<string, Command> {
  const bindings: Record<string, Command> = {}

  for (const { keys, command } of shortcuts) {
    // Later entries chain behind earlier ones so two shortcuts can share a key
    // and the first that applies wins -- which is how Mod-y and Mod-Shift-z
    // both mean redo without clobbering each other.
    const existing = bindings[keys]
    bindings[keys] = existing ? chainCommands(existing, command) : command
  }

  bindings['Enter'] = chainCommands(splitListItemCommand, baseKeymap['Enter'] as Command)
  bindings['Shift-Enter'] = chainCommands(
    exitCode,
    (state, dispatch) => {
      const br = state.schema.nodes['hard_break']
      if (!br) return false
      if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView())
      return true
    },
  )

  return { ...bindings, ...custom }
}

/** Human-readable shortcut for a label, with the platform's modifier symbol. */
export function shortcutFor(label: string, isMac = detectMac()): string | null {
  const found = shortcuts.find((s) => s.label === label)
  if (!found) return null
  return found.keys
    .replace(/Mod/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Alt/g, isMac ? '⌥' : 'Alt')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/-/g, isMac ? '' : '+')
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}
