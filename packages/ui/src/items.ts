/**
 * The default toolbar items.
 *
 * Every one is a thin binding of a core command to a label and an icon. No
 * editing logic lives here -- if a button needs to know something about the
 * document, that knowledge belongs in `@openleaf-editor/core` where a keyboard
 * shortcut and a test can reach it too.
 */

import {
  activeFontFamily,
  activeFontSize,
  activeLineHeight,
  activeLink,
  activeTextAlign,
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
  indent,
  insertHorizontalRule,
  insertImage,
  isMarkActive,
  isNodeActive,
  LINE_HEIGHT_PRESETS,
  outdent,
  redo,
  safeFontFamily,
  setFontFamily,
  setFontSize,
  setLineHeight,
  setLink,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleTextAlign,
  toggleUnderline,
  undo,
  unsetLink,
  type Align,
} from '@openleaf-editor/core'
import type { Command } from 'prosemirror-state'
import { promptForImage, promptForLink } from './dialog.js'
import { promptHelp } from './help.js'
import type { IconName } from './icons.js'
import { getToolbarItem, registerToolbarItem } from './registry.js'
import { imageUploaderFor, runUploader } from './upload.js'
import { blockTypeControl } from './block-type.js'

/** Event the host listens for to switch between rich and source views. */
export const SOURCE_TOGGLE_EVENT = 'openleaf:toggle-source'
export const FULLSCREEN_TOGGLE_EVENT = 'openleaf:toggle-fullscreen'
export const VISUAL_AIDS_TOGGLE_EVENT = 'openleaf:toggle-visual-aids'

/** Register the built-in items. Idempotent. */
export function registerDefaultItems(): void {
  if (getToolbarItem('undo') && getToolbarItem('blockType') && getToolbarItem('source')) return

  registerToolbarItem({
    id: 'blockType',
    // `custom`, not `select`: it builds its own DOM because it carries formats
    // the host injects at mount time. `type: 'select'` is the declarative
    // contract for a fixed preset list, which this is not.
    type: 'custom',
    kind: 'action',
    label: 'Paragraph style',
    render: ({ view, host, formats }) => blockTypeControl(view, host, formats ?? []),
  })

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

  /* ---- typography ----
     Preset selects over core's font / size / line-height commands. The schema
     already models these so inherited HTML stays editable; these controls are
     the chrome that was missing from the default bar. */

  registerToolbarItem({
    id: 'fontFamily',
    type: 'select',
    label: 'Font family',
    selectMod: 'wide',
    options: [
      { value: '', label: 'Default' },
      // Option values are the validated spelling the schema stores (quoted when
      // the name has a space), so getValue can match them after a round-trip.
      ...FONT_FAMILIES.map((family) => ({
        value: safeFontFamily(family) ?? family,
        label: family,
      })),
    ],
    getValue: (state) => activeFontFamily(state) ?? '',
    applyValue: (value) => setFontFamily(value === '' ? null : value),
  })

  registerToolbarItem({
    id: 'fontSize',
    type: 'select',
    label: 'Font size',
    options: [
      { value: '', label: 'Default' },
      ...FONT_SIZE_PRESETS.map((px) => ({ value: `${px}px`, label: String(px) })),
    ],
    getValue: (state) => activeFontSize(state) ?? '',
    applyValue: (value) => setFontSize(value === '' ? null : value),
  })

  registerToolbarItem({
    id: 'lineHeight',
    type: 'select',
    label: 'Line height',
    options: [
      { value: '', label: 'Default' },
      ...LINE_HEIGHT_PRESETS.map((value) => ({ value, label: value })),
    ],
    getValue: (state) => activeLineHeight(state) ?? '',
    applyValue: (value) => setLineHeight(value === '' ? null : value),
  })

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

  /* ---- alignment ----
     Toggles, not actions, and the pressed state is the EXPLICIT alignment only.
     A paragraph nobody has aligned follows the document's reading direction, so
     lighting up the left button for it would be wrong in Arabic and Hebrew --
     and `aria-pressed="true"` on a paragraph that is not left-aligned is a lie
     a screen reader repeats. See activeTextAlign in core. */

  const alignItems: Array<{ id: string; label: string; icon: IconName; align: Align }> = [
    { id: 'alignLeft', label: 'Align left', icon: 'alignLeft', align: 'left' },
    { id: 'alignCenter', label: 'Align centre', icon: 'alignCenter', align: 'center' },
    { id: 'alignRight', label: 'Align right', icon: 'alignRight', align: 'right' },
    { id: 'alignJustify', label: 'Justify', icon: 'alignJustify', align: 'justify' },
  ]

  for (const item of alignItems) {
    registerToolbarItem({
      id: item.id,
      type: 'button',
      kind: 'toggle',
      label: item.label,
      icon: item.icon,
      command: toggleTextAlign(item.align),
      isActive: (state) => activeTextAlign(state) === item.align,
      shortcut: item.label,
    })
  }

  registerToolbarItem({
    id: 'indent',
    type: 'button',
    kind: 'action',
    label: 'Indent',
    icon: 'indent',
    command: indent,
    shortcut: 'Indent',
  })

  registerToolbarItem({
    id: 'outdent',
    type: 'button',
    kind: 'action',
    label: 'Outdent',
    icon: 'outdent',
    command: outdent,
    shortcut: 'Outdent',
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
        title: (existing?.['title'] as string | undefined) ?? null,
        target: (existing?.['target'] as string | undefined) ?? null,
      }, host).then((result) => {
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
      // One item, two dialogs, decided by whether this page can upload. A file
      // picker that appears and then fails because no uploader was registered is
      // worse than no picker: the author has already chosen the file.
      const uploader = imageUploaderFor(host)
      const options = uploader
        ? { upload: (file: File) => runUploader(uploader, file, host), host }
        : { host }

      void promptForImage(host.ownerDocument, options).then((result) => {
        if (!result) {
          view.focus()
          return
        }
        insertImage({
          src: result.src,
          alt: result.alt,
          title: result.title,
          width: result.width,
          height: result.height,
          align: result.align,
          className: result.className,
          ...(result.caption ? { caption: result.caption } : {}),
        })(view.state, view.dispatch, view)
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
      host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true, composed: true }))
    },
  })

  registerToolbarItem({
    id: 'fullscreen',
    type: 'button',
    kind: 'toggle',
    label: 'Fullscreen',
    icon: 'fullscreen',
    isActive: () => false,
    run: ({ host }) => {
      host.dispatchEvent(new CustomEvent(FULLSCREEN_TOGGLE_EVENT, { bubbles: true, composed: true }))
    },
  })

  registerToolbarItem({
    id: 'visualAids',
    type: 'button',
    kind: 'toggle',
    label: 'Visual aids',
    icon: 'visualAids',
    isActive: () => false,
    run: ({ host }) => {
      host.dispatchEvent(new CustomEvent(VISUAL_AIDS_TOGGLE_EVENT, { bubbles: true, composed: true }))
    },
  })

  registerToolbarItem({
    id: 'help',
    type: 'button',
    kind: 'action',
    label: 'Help',
    icon: 'help',
    run: ({ host }) => {
      promptHelp(host.ownerDocument)
    },
  })
}
