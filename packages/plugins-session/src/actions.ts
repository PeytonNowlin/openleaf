/**
 * Save, print, preview, and new-document actions.
 *
 * Save offers a cancelable `openleaf:save` event, then an integrator callback,
 * then a form submission. The plugin never invents a server: it hands HTML to
 * whoever already owns persistence.
 */

import { findEditorHost } from '@openleaf-editor/ui'
import type { EditorView } from 'prosemirror-view'
import { confirmAction, printHtml, showPreview, showStats } from './dialogs.js'
import { documentStats } from './count.js'

export const SAVE_EVENT = 'openleaf:save'

export interface SaveEventDetail {
  html: string
  /** Call during event dispatch to own persistence and acknowledge its result. */
  waitUntil(save: PromiseLike<void>): void
}

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
  const el = findEditorHost(from)
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
  const pending: Promise<void>[] = []
  let dispatching = true
  const event = new CustomEvent<SaveEventDetail>(SAVE_EVENT, {
    bubbles: true,
    cancelable: true,
    // Without `composed`, a host that puts the editor inside its own shadow
    // root never sees this and every save silently falls back to the default.
    composed: true,
    detail: {
      html,
      waitUntil(save) {
        if (!dispatching) throw new Error('waitUntil must be called during openleaf:save dispatch')
        event.preventDefault()
        pending.push(Promise.resolve(save))
      },
    },
  })
  host.dispatchEvent(event)
  dispatching = false
  // Canceling claims the request, not a successful server write. Keep recovery
  // unless the owner explicitly supplies a promise and it resolves.
  if (event.defaultPrevented) {
    if (pending.length === 0) return false
    await Promise.all(pending)
    return true
  }

  if (saveHandler) {
    await saveHandler(html, host)
    return true
  }

  const form = boundForm(host)
  // A navigation is not a server acknowledgment. Preserve the draft until a
  // returned page loads the saved HTML or an application confirms its own save.
  if (form) form.requestSubmit()

  return false
}

export function previewDocument(host: EditorHost): void {
  showPreview(host.ownerDocument, host.value, host)
}

export function printDocument(host: EditorHost): void {
  const title = host.getAttribute('aria-label') ?? host.ownerDocument.title ?? 'Document'
  printHtml(host.ownerDocument, host.value, title, host)
}

export function showWordCount(host: EditorHost): void {
  const view = host.view
  if (!view) return
  showStats(host.ownerDocument, documentStats(view.state.doc), host)
}

export async function newDocument(host: EditorHost, isDirty: () => boolean): Promise<boolean> {
  if (isDirty()) {
    const ok = await confirmAction(host.ownerDocument, {
      title: 'New document',
      message: 'This will clear the editor. Unsaved changes will be lost.',
      confirmLabel: 'Clear editor',
      danger: true,
    }, host)
    if (!ok) return false
  }
  host.value = ''
  return true
}
