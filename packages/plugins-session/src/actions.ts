/**
 * Save, print, preview, and new-document actions.
 *
 * Save prefers an integrator callback, then a form submission, then a cancelable
 * `openleaf:save` event. The plugin never invents a server: it hands HTML to
 * whoever already owns persistence.
 */

import type { EditorView } from 'prosemirror-view'
import { confirmAction, printHtml, showPreview, showStats } from './dialogs.js'
import { documentStats } from './count.js'

export const SAVE_EVENT = 'openleaf:save'

export interface EditorHost extends HTMLElement {
  value: string
  view: EditorView | null
}

export type SaveHandler = (html: string, host: EditorHost) => void | Promise<void>

let saveHandler: SaveHandler | null = null

export function registerSaveHandler(handler: SaveHandler | null): void {
  saveHandler = handler
}

export function editorHost(from: HTMLElement): EditorHost | null {
  const el = from.closest('openleaf-editor')
  return el as EditorHost | null
}

function boundForm(host: EditorHost): HTMLFormElement | null {
  const id = host.getAttribute('for')
  if (id) {
    const textarea = host.ownerDocument.getElementById(id)
    if (textarea instanceof HTMLTextAreaElement) return textarea.form
  }
  return host.closest('form')
}

/**
 * Persist the document. Resolves true when a save actually happened.
 *
 * The caller uses the answer to decide whether to drop the recovery draft and
 * stop warning about unsaved changes, so "nothing was persisted" and "somebody
 * else persisted it" have to be told apart.
 */
export async function saveDocument(host: EditorHost): Promise<boolean> {
  const html = host.value
  const event = new CustomEvent(SAVE_EVENT, {
    bubbles: true,
    cancelable: true,
    // Without `composed`, a host that puts the editor inside its own shadow
    // root never sees this and every save silently falls back to the default.
    composed: true,
    detail: { html },
  })
  host.dispatchEvent(event)
  // Canceling is the documented way to own saving, not a failure: a listener
  // that calls preventDefault has taken the HTML and is persisting it itself.
  // Reporting that as unsaved would keep the draft and the leave warning alive
  // after every successful save on the event path.
  if (event.defaultPrevented) return true

  if (saveHandler) {
    await saveHandler(html, host)
    return true
  }

  const form = boundForm(host)
  if (form) return submitForm(form)

  return false
}

/**
 * Submit a form, reporting whether the submission actually went out.
 *
 * `requestSubmit()` runs constraint validation first and returns quietly when a
 * required control is invalid, so its return value says nothing. Watching for
 * the `submit` event it fires is the only way to tell a real submission from one
 * the browser refused -- and treating a refusal as success would clear the draft
 * and the leave warning while the edits were still unsaved.
 */
function submitForm(form: HTMLFormElement): boolean {
  let submitted = false
  const onSubmit = (): void => {
    submitted = true
  }
  form.addEventListener('submit', onSubmit, { capture: true })
  try {
    form.requestSubmit()
  } finally {
    form.removeEventListener('submit', onSubmit, { capture: true })
  }
  return submitted
}

export function previewDocument(host: EditorHost): void {
  showPreview(host.ownerDocument, host.value)
}

export function printDocument(host: EditorHost): void {
  const title = host.getAttribute('aria-label') ?? host.ownerDocument.title ?? 'Document'
  printHtml(host.ownerDocument, host.value, title)
}

export function showWordCount(host: EditorHost): void {
  const view = host.view
  if (!view) return
  showStats(host.ownerDocument, documentStats(view.state.doc))
}

export async function newDocument(host: EditorHost, isDirty: () => boolean): Promise<boolean> {
  if (isDirty()) {
    const ok = await confirmAction(host.ownerDocument, {
      title: 'New document',
      message: 'This will clear the editor. Unsaved changes will be lost.',
      confirmLabel: 'Clear editor',
      danger: true,
    })
    if (!ok) return false
  }
  host.value = ''
  return true
}
