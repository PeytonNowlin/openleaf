/**
 * Opt-in finding, counting, and recovery for OpenLeaf.
 *
 * None of this belongs in the core bundle: it is authoring chrome, not document
 * structure, and the core budget has no room for a find bar. Installing the
 * plugin registers capability; naming the items in `toolbar` is the integrator's
 * decision. Autosave, restore, the leave warning, and the word-count status
 * attach to every editor on the page once the bundle is loaded -- they are not
 * toolbar items, and hiding them would mean not loading the plugin.
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-session.min.js"></script>
 * ```
 */

import { registerEditorPlugin } from '@openleaf-editor/core'
import { registerIcons, registerStyles, registerToolbarItem } from '@openleaf-editor/ui'
import { keymap } from 'prosemirror-keymap'
import {
  runFind,
  runNewDocument,
  runPreview,
  runPrint,
  runSave,
  runWordCount,
  sessionChrome,
  type SessionOptions,
} from './chrome.js'
import { SESSION_ICONS } from './icons.js'
import { findNext, findPrev, searchPlugin } from './search.js'
import { SESSION_CSS } from './styles.js'

export const SESSION_TOOLBAR_ITEMS = [
  'find',
  'wordCount',
  'save',
  'preview',
  'print',
  'newDocument',
] as const

/** Layout fragment an integrator can append to a custom toolbar string. */
export const SESSION_LAYOUT_SUFFIX = ` | ${SESSION_TOOLBAR_ITEMS.join(' ')}`

let installed = false
let options: SessionOptions = {}

/**
 * Install session tools. Idempotent.
 *
 * Options are taken from the first call. A bundle loaded twice -- common in CMS
 * templates -- must not produce two find bars.
 */
export function installSessionTools(next: SessionOptions = {}): void {
  if (installed) return
  installed = true
  options = next

  registerIcons(SESSION_ICONS)
  registerStyles(SESSION_CSS)

  registerEditorPlugin(() => [
    searchPlugin(),
    sessionChrome(options),
    keymap({
      'Mod-f': (_state, _dispatch, view) => (view ? runFind(view) : false),
      'Mod-g': (state, dispatch) => findNext(state, dispatch),
      'Shift-Mod-g': (state, dispatch) => findPrev(state, dispatch),
      'Mod-s': (_state, _dispatch, view) => (view ? runSave(view) : false),
    }),
  ])

  registerToolbarItem({
    id: 'find',
    type: 'button',
    kind: 'action',
    label: 'Find and replace',
    icon: 'find',
    run: ({ view }) => {
      runFind(view)
    },
  })

  registerToolbarItem({
    id: 'wordCount',
    type: 'button',
    kind: 'action',
    label: 'Word count',
    icon: 'wordCount',
    run: ({ view }) => {
      runWordCount(view)
    },
  })

  registerToolbarItem({
    id: 'save',
    type: 'button',
    kind: 'action',
    label: 'Save',
    icon: 'save',
    run: ({ view }) => {
      runSave(view)
    },
  })

  registerToolbarItem({
    id: 'preview',
    type: 'button',
    kind: 'action',
    label: 'Preview',
    icon: 'preview',
    run: ({ view }) => {
      runPreview(view)
    },
  })

  registerToolbarItem({
    id: 'print',
    type: 'button',
    kind: 'action',
    label: 'Print',
    icon: 'print',
    run: ({ view }) => {
      runPrint(view)
    },
  })

  registerToolbarItem({
    id: 'newDocument',
    type: 'button',
    kind: 'action',
    label: 'New document',
    icon: 'newDocument',
    run: ({ view }) => {
      runNewDocument(view)
    },
  })
}

export { registerSaveHandler, SAVE_EVENT, type SaveHandler } from './actions.js'
export { documentStats, countWords, formatWordCount, type DocumentStats } from './count.js'
export {
  clearDraft,
  defaultStorage,
  draftStorageKey,
  readDraft,
  writeDraft,
  type DraftRecord,
  type DraftStorage,
} from './draft.js'
export {
  clearSearch,
  findMatches,
  findNext,
  findPrev,
  replaceAll,
  replaceCurrent,
  searchKey,
  searchPlugin,
  setSearch,
  type SearchMatch,
  type SearchState,
} from './search.js'
export { sessionFor, type SessionOptions } from './chrome.js'
export { SESSION_CSS } from './styles.js'
