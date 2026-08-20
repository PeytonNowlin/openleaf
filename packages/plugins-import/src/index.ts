/**
 * Opt-in file import.
 *
 * Adds a toolbar button and drag-and-drop for importing documents into the
 * editor. HTML and plain text work with no dependency; other formats arrive
 * through `registerFileConverter`.
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-import.min.js"></script>
 * ```
 */

import { canInsert, registerEditorPlugin } from '@openleaf-editor/core'
import { registerIcons, registerToolbarItem } from '@openleaf-editor/ui'
import { importBookmarkPlugin } from './bookmark.js'
import { BUILT_IN_ACCEPT } from './converters.js'
import { importFilesIntoView } from './import.js'
import { announce, describeOutcome } from './report.js'

export { importBookmarkPlugin } from './bookmark.js'
export {
  DEFAULT_IMPORT_LIMITS,
  importLimits,
  setImportLimits,
  type ImportLimits,
} from './limits.js'
export { isUploadableImageType } from '@openleaf-editor/ui'

export {
  BUILT_IN_ACCEPT,
  clearFileConverters,
  convertFile,
  extractBody,
  registerFileConverter,
  textToHtml,
  type ConversionResult,
  type FileConverter,
} from './converters.js'
export { importFileIntoView, importFilesIntoView, type ImportOutcome } from './import.js'

const ICONS = {
  importFile: 'M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
}

/** Extensions offered in the picker; grows as converters register. */
let accept = BUILT_IN_ACCEPT

function tokens(list: string): string[] {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Widen the file picker for a format a converter handles. */
export function addAcceptedExtensions(extensions: string): void {
  const next = new Set(tokens(accept))
  for (const part of tokens(extensions)) next.add(part)
  accept = [...next].join(',')
}

/** Undo a previous `addAcceptedExtensions` call. */
export function removeAcceptedExtensions(extensions: string): void {
  const drop = new Set(tokens(extensions))
  accept = tokens(accept)
    .filter((part) => !drop.has(part))
    .join(',')
}

/** Current picker accept list. Testing seam. */
export function acceptedExtensions(): string {
  return accept
}

async function pickAndImport(view: import('prosemirror-view').EditorView, host: HTMLElement): Promise<void> {
  const doc = host.ownerDocument
  const input = doc.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true
  // Kept out of the layout but still focusable by the click below; `display:none`
  // makes some browsers refuse to open the picker.
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  doc.body.appendChild(input)

  const files = await new Promise<File[]>((resolve) => {
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true })
    // No 'cancel' event in older browsers; the input is cleaned up either way.
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
  input.remove()

  if (files.length === 0) {
    view.focus()
    return
  }

  const outcome = await importFilesIntoView(view, files)
  announce(host, describeOutcome(files.length, outcome.warnings, outcome.error))
}

/**
 * Report a failed import instead of dropping it on the floor.
 *
 * `importFilesIntoView` returns its failures rather than throwing, so reaching
 * here means something unforeseen went wrong. Both call sites used to discard
 * the rejection entirely -- `void pickAndImport(...)`, and a `.then` with no
 * `.catch` -- which made a teardown mid-import an unhandled rejection in the
 * console and nothing at all for the author.
 */
function reportFailure(host: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error('@openleaf-editor/plugins-import: the import failed', error)
  announce(host, `The import did not finish: ${message}`)
}

let installed = false

/** Install the import button and drag-and-drop. Idempotent. */
export function installImport(): void {
  if (installed) return
  installed = true

  registerIcons(ICONS)

  // One plugin, installed with the editor and idle until an import is pending.
  // The alternative -- adding and removing a plugin around each import through
  // `state.reconfigure` -- destroyed and rebuilt every plugin view in the
  // editor twice per file. See bookmark.ts.
  registerEditorPlugin(() => [importBookmarkPlugin()])

  registerToolbarItem({
    id: 'importFile',
    type: 'button',
    kind: 'action',
    label: 'Import a file',
    icon: 'importFile',
    // Importing inserts a block, so it needs somewhere a block can go.
    isEnabled: (state) => canInsert(state, 'paragraph'),
    run: ({ view, host }) => {
      void pickAndImport(view, host).catch((error: unknown) => reportFailure(host, error))
    },
  })

  if (typeof document === 'undefined') return

  /*
   * Drag-and-drop, added at the document level and filtered to editors.
   *
   * Only files are intercepted. Dragging text or an image within the document is
   * ProseMirror's business, and taking those over would break moving a paragraph
   * by dragging it -- a regression an author would notice long before they
   * noticed the import feature.
   */
  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const editorFor = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null
    return target.closest('openleaf-editor')
  }

  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || !editorFor(event.target)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  })

  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return
    const host = editorFor(event.target)
    if (!host) return
    const view = (host as HTMLElement & { view?: import('prosemirror-view').EditorView }).view
    if (!view) return

    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length === 0) return

    void importFilesIntoView(view, files)
      .then((outcome) => {
        announce(host, describeOutcome(files.length, outcome.warnings, outcome.error))
      })
      .catch((error: unknown) => reportFailure(host, error))
  })
}
