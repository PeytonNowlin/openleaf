/**
 * Opt-in insert tools for OpenLeaf.
 *
 * Schema nodes for media, details, figures, page breaks and named anchors live
 * in `@openleaf-editor/core`, so stored documents round-trip without this
 * package. What this bundle adds is the chrome: toolbar items, dialogs, the
 * character and emoji grids, snippet insertion, and in-editor image resize
 * handles.
 */

import {
  insertNonBreakingSpace,
  insertPageBreak,
  insertText,
  registerEditorPlugin,
} from '@openleaf-editor/core'
import { registerIcons, registerStyles, registerToolbarItem } from '@openleaf-editor/ui'
import { CHARACTERS, EMOJI } from './glyphs.js'
import { buildGlyphPicker } from './grid.js'
import { INSERT_ICONS } from './icons.js'
import { promptInsertAnchor, promptInsertDetails, promptInsertMedia, promptInsertSnippet } from './prompts.js'
import { mediaResizePlugin } from './resize.js'
import { listedSnippets, registerHtmlSnippets, type HtmlSnippet } from './snippets.js'
import { INSERT_CSS } from './styles.js'

export const INSERT_TOOLBAR_ITEMS = [
  'media',
  'details',
  'anchor',
  'charmap',
  'emoji',
  'datetime',
  'pagebreak',
  'nbsp',
  'snippet',
] as const

export const INSERT_LAYOUT_SUFFIX = ` | ${INSERT_TOOLBAR_ITEMS.join(' ')}`

export interface InsertOptions {
  snippets?: readonly HtmlSnippet[]
}

let installed = false

export function installInsertTools(options: InsertOptions = {}): void {
  if (installed) return
  installed = true

  if (options.snippets) registerHtmlSnippets(options.snippets)

  registerIcons(INSERT_ICONS)
  registerStyles(INSERT_CSS)
  registerEditorPlugin(() => [mediaResizePlugin()])

  registerToolbarItem({
    id: 'media',
    type: 'button',
    kind: 'action',
    label: 'Insert media',
    icon: 'media',
    run: ({ view, host }) => {
      void promptInsertMedia(view, host)
    },
  })

  registerToolbarItem({
    id: 'details',
    type: 'button',
    kind: 'action',
    label: 'Collapsible section',
    icon: 'details',
    run: ({ view, host }) => {
      void promptInsertDetails(view, host)
    },
  })

  registerToolbarItem({
    id: 'anchor',
    type: 'button',
    kind: 'action',
    label: 'Named anchor',
    icon: 'anchor',
    run: ({ view, host }) => {
      void promptInsertAnchor(view, host)
    },
  })

  registerToolbarItem({
    id: 'charmap',
    type: 'custom',
    label: 'Character map',
    icon: 'charmap',
    render: (ctx) => buildGlyphPicker(ctx, { label: 'Character map', icon: 'charmap', items: CHARACTERS }),
  })

  registerToolbarItem({
    id: 'emoji',
    type: 'custom',
    label: 'Emoji',
    icon: 'emoji',
    render: (ctx) => buildGlyphPicker(ctx, { label: 'Emoji', icon: 'emoji', items: EMOJI }),
  })

  registerToolbarItem({
    id: 'datetime',
    type: 'button',
    kind: 'action',
    label: 'Insert date and time',
    icon: 'datetime',
    command: (state, dispatch, view) => {
      const stamp = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date())
      return insertText(stamp)(state, dispatch, view)
    },
  })

  registerToolbarItem({
    id: 'pagebreak',
    type: 'button',
    kind: 'action',
    label: 'Page break',
    icon: 'pagebreak',
    command: insertPageBreak,
  })

  registerToolbarItem({
    id: 'nbsp',
    type: 'button',
    kind: 'action',
    label: 'Non-breaking space',
    icon: 'nbsp',
    command: insertNonBreakingSpace,
  })

  registerToolbarItem({
    id: 'snippet',
    type: 'button',
    kind: 'action',
    label: 'Insert snippet',
    icon: 'snippet',
    isEnabled: () => listedSnippets().length > 0,
    run: ({ view, host }) => {
      void promptInsertSnippet(view, host)
    },
  })
}

export { CHARACTERS, EMOJI, GLYPH_COLUMNS } from './glyphs.js'
export { listedSnippets, registerHtmlSnippets, type HtmlSnippet } from './snippets.js'
export { imageResizePlugin, mediaResizePlugin, RESIZABLE_MEDIA, type ResizableKind } from './resize.js'
