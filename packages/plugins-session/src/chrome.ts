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

/**
 * Emitted by `<openleaf-editor>` when the HTML source box opens and closes.
 *
 * Named here rather than imported: this plugin does not depend on the element
 * package, and the element declares the same names for the same reason.
 */
const SOURCE_OPEN_EVENT = 'openleaf:source-open'
const SOURCE_CLOSE_EVENT = 'openleaf:source-close'

interface Baseline {
  /** The HTML as of the last save. */
  html: string
  /** Whether a stored draft has already been offered for this host. */
  offeredRestore: boolean
}

const handles = new WeakMap<HTMLElement, SessionHandle>()
/**
 * Held per host rather than in the plugin view's closure.
 *
 * Registering another opt-in plugin reconfigures the editor state, and
 * ProseMirror destroys and recreates every plugin view when it does. A baseline
 * that lived in the closure would be re-read from the current document on the
 * way back up, adopting the author's unsaved edits as though they had been
 * saved -- and the next update would then clear the recovery draft the departing
 * view had just written, taking the leave warning with it.
 */
const baselines = new WeakMap<HTMLElement, Baseline>()
const live = new Set<SessionHandle>()
const guardedWindows = new WeakSet<Window>()

function baselineFor(host: EditorHost, html: () => string): Baseline {
  const existing = baselines.get(host)
  if (existing) return existing
  const created: Baseline = { html: html(), offeredRestore: false }
  baselines.set(host, created)
  return created
}

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
  let timer: ReturnType<typeof setTimeout> | undefined

  /**
   * The HTML the editor is showing right now.
   *
   * `host.value` is the authority once the element has wired up its view: with
   * the HTML source box open the live document is the textarea's text, and
   * comparing the untouched `view.state.doc` would report a session that has
   * been edited in source mode as clean. During this plugin view's construction
   * the element has not assigned its `#view` yet, so its getter would hand back
   * the raw textarea string -- serialize the document instead.
   */
  const currentHtml = (): string => (host.view ? host.value : serializeHtml(view.state.doc))

  const baseline = baselineFor(host, currentHtml)

  const findBar = buildFindBar(host, view)
  const status = doc.createElement('div')
  status.className = 'ol-status'
  // Visual only. A live region here would announce on every keystroke.
  status.setAttribute('aria-hidden', 'true')
  const toolbar = host.querySelector('[role="toolbar"]')
  if (toolbar) toolbar.after(findBar.root)
  else host.prepend(findBar.root)
  host.appendChild(status)

  const isDirty = (): boolean => currentHtml() !== baseline.html

  const persist = (): void => {
    if (!options.autosave) return
    const html = currentHtml()
    if (html === baseline.html) {
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
    baseline.html = currentHtml()
    clearDraft(options.storage, key)
  }

  const form = boundForm(host)
  form?.addEventListener('submit', onSubmit)

  // While the source box is open the author's edits land in a textarea, which
  // dispatches no ProseMirror transactions -- so this plugin view's `update`
  // never runs and the debounce is never rearmed. Watching the textarea is what
  // keeps source-mode edits autosaved and keeps them counted as unsaved on the
  // way out of the tab.
  let sourceArea: HTMLTextAreaElement | null = null
  const onSourceInput = (): void => schedule()
  const onSourceOpen = (event: Event): void => {
    const area = (event as CustomEvent<{ textarea?: HTMLTextAreaElement }>).detail?.textarea
    if (!area) return
    sourceArea?.removeEventListener('input', onSourceInput)
    sourceArea = area
    area.addEventListener('input', onSourceInput)
  }
  const onSourceClose = (): void => {
    sourceArea?.removeEventListener('input', onSourceInput)
    sourceArea = null
    // Leaving source mode need not change the document -- the element compares
    // documents rather than strings, so merely looking at the source dispatches
    // nothing -- which leaves no update to settle the draft. Settle it here.
    schedule()
  }
  host.addEventListener(SOURCE_OPEN_EVENT, onSourceOpen)
  host.addEventListener(SOURCE_CLOSE_EVENT, onSourceClose)

  const handle: SessionHandle = {
    host,
    openFind: () => findBar.open(),
    closeFind: () => findBar.close(),
    markClean: () => {
      baseline.html = currentHtml()
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
      sourceArea?.removeEventListener('input', onSourceInput)
      host.removeEventListener(SOURCE_OPEN_EVENT, onSourceOpen)
      host.removeEventListener(SOURCE_CLOSE_EVENT, onSourceClose)
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

  if (options.restore && !baseline.offeredRestore) {
    const draft = readDraft(options.storage, key)
    // Not offered when the draft is what is already on screen. A plugin view
    // restart writes a draft of the unsaved document as it goes, and offering to
    // restore the document the author is looking at is noise. Asked at most once
    // per host, so declining survives a reconfiguration too.
    if (draft && draft.html !== baseline.html && draft.html !== currentHtml()) {
      baseline.offeredRestore = true
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
