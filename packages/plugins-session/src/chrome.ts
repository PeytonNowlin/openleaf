/**
 * Per-editor chrome: find bar, word-count status, autosave, restore, leave warning.
 *
 * A ProseMirror plugin `view` rather than a toolbar custom control, because the
 * find bar and the status line are not toolbar buttons. Putting them in the bar
 * would add tab stops to a control that is deliberately one stop.
 */

import { serializeHtml } from '@openleaf-editor/core'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
  editorHost,
  newDocument,
  previewDocument,
  printDocument,
  saveDocument,
  showWordCount,
  type EditorHost,
} from './actions.js'
import { documentStats, formatWordCount } from './count.js'
import { confirmAction } from './dialogs.js'
import {
  clearDraft,
  defaultStorage,
  draftStorageKey,
  readDraft,
  writeDraft,
  type DraftStorage,
} from './draft.js'
import {
  clearSearch,
  findNext,
  findPrev,
  replaceAll,
  replaceCurrent,
  searchKey,
  setSearch,
} from './search.js'

export interface SessionOptions {
  /** Persist drafts to storage. Default true. */
  autosave?: boolean
  /** Milliseconds to wait after a change before writing a draft. Default 800. */
  debounceMs?: number
  /** `beforeunload` when the document differs from the last save. Default true. */
  warnBeforeLeave?: boolean
  /** Offer to restore a stored draft that differs from the loaded HTML. Default true. */
  restore?: boolean
  /** Storage backend. Tests inject a fake; production uses localStorage. */
  storage?: DraftStorage
}

interface SessionHandle {
  host: EditorHost
  openFind: () => void
  closeFind: () => void
  markClean: () => void
  isDirty: () => boolean
  update: () => void
  destroy: () => void
}

const handles = new WeakMap<HTMLElement, SessionHandle>()
const live = new Set<SessionHandle>()
const guardedWindows = new WeakSet<Window>()

export function sessionFor(host: HTMLElement): SessionHandle | undefined {
  return handles.get(host)
}

function ensureLeaveGuard(win: Window): void {
  if (guardedWindows.has(win)) return
  guardedWindows.add(win)
  win.addEventListener('beforeunload', (event) => {
    for (const session of live) {
      if (session.isDirty()) {
        event.preventDefault()
        event.returnValue = ''
        return
      }
    }
  })
}

function button(doc: Document, label: string): HTMLButtonElement {
  const el = doc.createElement('button')
  el.type = 'button'
  el.textContent = label
  return el
}

export function sessionChrome(options: SessionOptions = {}): Plugin {
  const autosave = options.autosave !== false
  const warn = options.warnBeforeLeave !== false
  const restore = options.restore !== false
  const debounceMs = options.debounceMs ?? 800
  const storage = options.storage ?? defaultStorage()

  return new Plugin({
    view(view) {
      const host = editorHost(view.dom)
      if (!host) return {}
      const handle = attachSession(host, view, {
        autosave,
        warn,
        restore,
        debounceMs,
        storage,
      })
      return {
        update: () => handle.update(),
        destroy: () => handle.destroy(),
      }
    },
  })
}

function attachSession(
  host: EditorHost,
  view: EditorView,
  options: {
    autosave: boolean
    warn: boolean
    restore: boolean
    debounceMs: number
    storage: DraftStorage
  },
): SessionHandle {
  const doc = host.ownerDocument
  const win = doc.defaultView
  const key = draftStorageKey(host)
  // Taken from the live document, not `host.value`: this plugin view runs
  // inside the EditorView constructor, before `<openleaf-editor>` has assigned
  // `#view`, so the element's getter still returns the raw textarea string.
  let lastSaved = serializeHtml(view.state.doc)
  let timer: ReturnType<typeof setTimeout> | undefined

  const findBar = buildFindBar(host, view)
  const status = doc.createElement('div')
  status.className = 'ol-status'
  // Visual only. A live region here would announce on every keystroke.
  status.setAttribute('aria-hidden', 'true')
  const toolbar = host.querySelector('[role="toolbar"]')
  if (toolbar) toolbar.after(findBar.root)
  else host.prepend(findBar.root)
  host.appendChild(status)

  const isDirty = (): boolean => serializeHtml(view.state.doc) !== lastSaved

  const persist = (): void => {
    if (!options.autosave) return
    const html = host.value
    if (html === lastSaved) {
      clearDraft(options.storage, key)
      return
    }
    writeDraft(options.storage, key, html)
  }

  const schedule = (): void => {
    if (!options.autosave) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(persist, options.debounceMs)
  }

  const onSubmit = (): void => {
    lastSaved = serializeHtml(view.state.doc)
    clearDraft(options.storage, key)
  }

  const form = boundForm(host)
  form?.addEventListener('submit', onSubmit)

  const handle: SessionHandle = {
    host,
    openFind: () => findBar.open(),
    closeFind: () => findBar.close(),
    markClean: () => {
      lastSaved = serializeHtml(view.state.doc)
      clearDraft(options.storage, key)
    },
    isDirty,
    update: () => {
      status.textContent = formatWordCount(documentStats(view.state.doc))
      findBar.sync()
      if (options.autosave) schedule()
    },
    destroy: () => {
      if (timer !== undefined) clearTimeout(timer)
      persist()
      form?.removeEventListener('submit', onSubmit)
      findBar.root.remove()
      status.remove()
      live.delete(handle)
      handles.delete(host)
    },
  }

  handles.set(host, handle)
  live.add(handle)
  handle.update()

  if (options.warn && win) ensureLeaveGuard(win)

  if (options.restore) {
    const draft = readDraft(options.storage, key)
    if (draft && draft.html !== lastSaved) {
      queueMicrotask(() => {
        void offerRestore(host, draft.html, draft.savedAt, handle)
      })
    }
  }

  return handle
}

function boundForm(host: EditorHost): HTMLFormElement | null {
  const id = host.getAttribute('for')
  if (id) {
    const textarea = host.ownerDocument.getElementById(id)
    if (textarea instanceof HTMLTextAreaElement) return textarea.form
  }
  return host.closest('form')
}

async function offerRestore(
  host: EditorHost,
  html: string,
  savedAt: number,
  handle: SessionHandle,
): Promise<void> {
  const when = new Date(savedAt).toLocaleString()
  const ok = await confirmAction(host.ownerDocument, {
    title: 'Restore unsaved draft',
    message: `A draft from ${when} is saved in this browser. Restore it?`,
    confirmLabel: 'Restore draft',
  })
  if (!ok) return
  host.value = html
  handle.update()
}

function buildFindBar(host: EditorHost, view: EditorView): { root: HTMLElement; open: () => void; close: () => void; sync: () => void } {
  const doc = host.ownerDocument
  const root = doc.createElement('div')
  root.className = 'ol-find'
  root.hidden = true
  root.setAttribute('role', 'search')
  root.setAttribute('aria-label', 'Find and replace')

  const findLabel = doc.createElement('label')
  const findText = doc.createElement('span')
  findText.textContent = 'Find'
  const findInput = doc.createElement('input')
  findInput.type = 'search'
  findInput.name = 'find'
  findLabel.append(findText, findInput)

  const replaceLabel = doc.createElement('label')
  const replaceText = doc.createElement('span')
  replaceText.textContent = 'Replace'
  const replaceInput = doc.createElement('input')
  replaceInput.type = 'text'
  replaceInput.name = 'replace'
  replaceLabel.append(replaceText, replaceInput)

  const caseLabel = doc.createElement('label')
  caseLabel.className = 'ol-check'
  const caseBox = doc.createElement('input')
  caseBox.type = 'checkbox'
  caseBox.name = 'matchCase'
  const caseSpan = doc.createElement('span')
  caseSpan.textContent = 'Match case'
  caseLabel.append(caseBox, caseSpan)

  const count = doc.createElement('span')
  count.className = 'ol-find-count'
  count.setAttribute('role', 'status')
  count.setAttribute('aria-live', 'polite')

  const prev = button(doc, 'Previous')
  const next = button(doc, 'Next')
  const replace = button(doc, 'Replace')
  const replaceAllBtn = button(doc, 'Replace all')
  const closeBtn = button(doc, 'Close')

  root.append(findLabel, replaceLabel, caseLabel, count, prev, next, replace, replaceAllBtn, closeBtn)

  const applyQuery = (): void => {
    setSearch(findInput.value, caseBox.checked)(view.state, view.dispatch)
  }

  const open = (): void => {
    root.hidden = false
    const selected = view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' ')
    if (selected && selected !== findInput.value) findInput.value = selected
    applyQuery()
    findInput.focus()
    findInput.select()
  }

  const close = (): void => {
    root.hidden = true
    clearSearch(view.state, view.dispatch)
    view.focus()
  }

  const sync = (): void => {
    const search = searchKey.getState(view.state)
    if (!search || search.query.length === 0) {
      count.textContent = ''
      return
    }
    if (search.matches.length === 0) {
      count.textContent = 'No matches'
      return
    }
    const current = search.index >= 0 ? search.index + 1 : 0
    count.textContent =
      current > 0 ? `${current} of ${search.matches.length}` : `${search.matches.length} matches`
  }

  findInput.addEventListener('input', applyQuery)
  caseBox.addEventListener('change', applyQuery)
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) findPrev(view.state, view.dispatch)
      else findNext(view.state, view.dispatch)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      replaceCurrent(replaceInput.value)(view.state, view.dispatch)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })
  prev.addEventListener('click', () => findPrev(view.state, view.dispatch))
  next.addEventListener('click', () => findNext(view.state, view.dispatch))
  replace.addEventListener('click', () => replaceCurrent(replaceInput.value)(view.state, view.dispatch))
  replaceAllBtn.addEventListener('click', () => replaceAll(replaceInput.value)(view.state, view.dispatch))
  closeBtn.addEventListener('click', close)

  return { root, open, close, sync }
}

export function runFind(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  sessionFor(host)?.openFind()
  return true
}

export function runSave(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  const handle = sessionFor(host)
  void saveDocument(host).then((saved) => {
    if (saved) handle?.markClean()
  })
  return true
}

export function runPreview(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  previewDocument(host)
  return true
}

export function runPrint(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  printDocument(host)
  return true
}

export function runWordCount(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  showWordCount(host)
  return true
}

export function runNewDocument(view: EditorView): boolean {
  const host = editorHost(view.dom)
  if (!host) return false
  const handle = sessionFor(host)
  void newDocument(host, () => handle?.isDirty() === true).then((cleared) => {
    if (cleared) handle?.markClean()
  })
  return true
}
