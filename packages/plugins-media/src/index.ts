/**
 * Opt-in media editing.
 *
 * The schema for figures, video and audio is not here -- it lives in
 * `@openleaf-editor/core`, so stored HTML with a caption or a poster frame
 * remains a real node rather than an opaque preserved atom. What is opt-in is
 * the weight: drag-resize, the insert-media dialog (poster frames, extra
 * `<source>` rows), and the toolbar control.
 *
 * ```ts
 * import { installMediaEditing } from '@openleaf-editor/plugins-media'
 * installMediaEditing()
 * ```
 */

import { canInsert, insertAudio, insertVideo, registerEditorPlugin } from '@openleaf-editor/core'
import { promptForMedia, registerIcons, registerToolbarItem } from '@openleaf-editor/ui'
import { mediaResizePlugin } from './resize.js'

export const MEDIA_ICON_PATHS: Record<string, string> = {
  media: 'M4 6h16v12H4zM10 9l6 3-6 3z',
}

export const MEDIA_TOOLBAR_ITEMS = ['insertMedia'] as const

let installed = false

export function installMediaEditing(): void {
  if (installed) return
  installed = true

  registerIcons(MEDIA_ICON_PATHS)
  registerEditorPlugin(() => [mediaResizePlugin()])

  registerToolbarItem({
    id: 'insertMedia',
    type: 'button',
    kind: 'action',
    label: 'Insert media',
    icon: 'media',
    isEnabled: (state) => canInsert(state, 'video') || canInsert(state, 'audio'),
    run: ({ view, host }) => {
      void promptForMedia(host.ownerDocument).then((result) => {
        if (!result) {
          view.focus()
          return
        }
        const command = result.kind === 'audio' ? insertAudio : insertVideo
        command({
          src: result.src,
          poster: result.poster,
          width: result.width,
          height: result.height,
          class: result.class,
          furniture: result.furniture,
          caption: result.caption,
        })(view.state, view.dispatch, view)
        view.focus()
      })
    },
  })
}

export { mediaResizePlugin }