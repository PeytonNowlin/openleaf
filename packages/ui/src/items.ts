/**
 * The default toolbar items.
 *
 * Every one is a thin binding of a core command to a label and an icon. No
 * editing logic lives here -- if a button needs to know something about the
 * document, that knowledge belongs in `@openleaf/core` where a keyboard
 * shortcut and a test can reach it too.
 */

import {
  activeLink,
  insertHorizontalRule,
  insertImage,
  isMarkActive,
  isNodeActive,
  redo,
  setLink,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleUnderline,
  undo,
  unsetLink,
} from '@openleaf/core'
import type { Command } from 'prosemirror-state'
import { promptForImage, promptForLink } from './dialog.js'
import type { IconName } from './icons.js'
import { registerToolbarItem } from './registry.js'

/** Event the host listens for to switch between rich and source views. */
export const SOURCE_TOGGLE_EVENT = 'openleaf:toggle-source'

let registered = false

/** Register the built-in items. Idempotent. */
export function registerDefaultItems(): void {
  if (registered) return
  registered = true

  registerToolbarItem({
    id: 'undo',
    type: 'button',
    kind: 'action',
    label: 'Undo',
    icon: 'undo',
    command: undo,
    shortcut: 'Undo',
  })

  registerToolbarItem({
    id: 'redo',
    type: 'button',
    kind: 'action',
    label: 'Redo',
    icon: 'redo',
    command: redo,
    shortcut: 'Redo',
  })

  /* ---- character marks ---- */

  interface MarkItem {
    id: string
    label: string
    icon: IconName
    /** Schema mark name the active predicate asks about. */
    mark: string
    command: Command
  }

  const markItems: MarkItem[] = [
    { id: 'bold', label: 'Bold', icon: 'bold', mark: 'strong', command: toggleBold },
    { id: 'italic', label: 'Italic', icon: 'italic', mark: 'em', command: toggleItalic },
    {
      id: 'underline',
      label: 'Underline',
      icon: 'underline',
      mark: 'underline',
      command: toggleUnderline,
    },
    {
      id: 'strikethrough',
      label: 'Strikethrough',
      icon: 'strikethrough',
      mark: 'strike',
      command: toggleStrike,
    },
    { id: 'code', label: 'Inline code', icon: 'code', mark: 'code', command: toggleInlineCode },
  ]

  for (const item of markItems) {
    registerToolbarItem({
      id: item.id,
      type: 'button',
      kind: 'toggle',
      label: item.label,
      icon: item.icon,
      command: item.command,
      isActive: (state) => isMarkActive(state, item.mark),
      shortcut: item.label,
    })
  }

  /* ---- block structure ----
     These get toggle semantics too. A blockquote or a list is a state the
     cursor is either in or not, exactly like bold, and leaving them as plain
     actions means a screen reader user cannot tell whether they are inside a
     list without moving the caret and inferring it. */

  registerToolbarItem({
    id: 'bulletList',
    type: 'button',
    kind: 'toggle',
    label: 'Bulleted list',
    icon: 'bulletList',
    command: toggleBulletList,
    isActive: (state) => isNodeActive(state, 'bullet_list'),
    shortcut: 'Bulleted list',
  })

  registerToolbarItem({
    id: 'orderedList',
    type: 'button',
    kind: 'toggle',
    label: 'Numbered list',
    icon: 'orderedList',
    command: toggleOrderedList,
    isActive: (state) => isNodeActive(state, 'ordered_list'),
    shortcut: 'Numbered list',
  })

  registerToolbarItem({
    id: 'blockquote',
    type: 'button',
    kind: 'toggle',
    label: 'Blockquote',
    icon: 'blockquote',
    command: toggleBlockquote,
    isActive: (state) => isNodeActive(state, 'blockquote'),
    shortcut: 'Blockquote',
  })

  registerToolbarItem({
    id: 'codeBlock',
    type: 'button',
    kind: 'toggle',
    label: 'Code block',
    icon: 'codeBlock',
    command: toggleCodeBlock,
    isActive: (state) => isNodeActive(state, 'code_block'),
    shortcut: 'Code block',
  })

  /* ---- insertions ---- */

  registerToolbarItem({
    id: 'link',
    type: 'button',
    kind: 'toggle',
    label: 'Link',
    icon: 'link',
    // Enabled only with a selection: a link needs text to attach to, and
    // silently doing nothing on an empty caret is worse than being disabled.
    isEnabled: (state) => !state.selection.empty,
    isActive: (state) => activeLink(state) !== null,
    run: ({ view, host }) => {
      const existing = activeLink(view.state)
      void promptForLink(host.ownerDocument, {
        href: (existing?.['href'] as string | undefined) ?? '',
        target: (existing?.['target'] as string | undefined) ?? null,
      }).then((result) => {
        if (!result) {
          view.focus()
          return
        }
        setLink(result)(view.state, view.dispatch, view)
        view.focus()
      })
    },
  })

  registerToolbarItem({
    id: 'unlink',
    type: 'button',
    kind: 'action',
    label: 'Remove link',
    icon: 'unlink',
    command: unsetLink,
  })

  registerToolbarItem({
    id: 'image',
    type: 'button',
    kind: 'action',
    label: 'Insert image',
    icon: 'image',
    run: ({ view, host }) => {
      void promptForImage(host.ownerDocument).then((result) => {
        if (!result) {
          view.focus()
          return
        }
        insertImage({ src: result.src, alt: result.alt })(view.state, view.dispatch, view)
        view.focus()
      })
    },
  })

  registerToolbarItem({
    id: 'horizontalRule',
    type: 'button',
    kind: 'action',
    label: 'Horizontal rule',
    icon: 'horizontalRule',
    command: insertHorizontalRule,
    shortcut: 'Horizontal rule',
  })

  /* ---- mode ---- */

  registerToolbarItem({
    id: 'source',
    type: 'button',
    kind: 'toggle',
    label: 'HTML source',
    icon: 'source',
    // Source view is host state, not document state, so no predicate can derive
    // it. The host pushes the value with setItemState -- which is exactly why
    // that escape hatch exists.
    isActive: () => false,
    run: ({ host }) => {
      host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true }))
    },
  })
}
