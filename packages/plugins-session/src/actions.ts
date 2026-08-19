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

export async function saveDocument(host: EditorHost): Promise<boolean> {
  const html = host.value
  const event = new CustomEvent(SAVE_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: { html },
  })
  host.dispatchEvent(event)
  if (event.defaultPrevented) return false

  if (saveHandler) {
    await saveHandler(html, host)
    return true
  }

  const form = boundForm(host)
  if (form) {
    form.requestSubmit()
    return true
  }

  return false
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
