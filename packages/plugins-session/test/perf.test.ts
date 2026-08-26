/**
 * What the session chrome is allowed to do per view update.
 *
 * ProseMirror calls a plugin view's `update` for every state change, which
 * includes arrow keys, clicks and drag-selection. The chrome used to answer each
 * one by walking the whole document to recount words and, when autosave was on,
 * by rearming a timer that serialized the whole document -- so moving the caret
 * in a hundred-page document cost a recount, and pausing after moving it cost a
 * full serialization of a document nobody had edited.
 *
 * These are counting tests, not timing tests. A wall-clock assertion on a shared
 * CI runner either fails for reasons that have nothing to do with the code or is
 * set so loose it can never fail at all; "how many times was the expensive
 * function called" is the same number on every machine. Each test below was
 * confirmed to go red against the unfixed code.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorHost } from '../src/actions.js'
import { sessionChrome, sessionFor, type SessionOptions } from '../src/chrome.js'
import { draftStorageKey, readDraft, type DraftStorage } from '../src/draft.js'

/**
 * The call counters. Hoisted because `vi.mock` factories run before the file
 * body does, and the factories are what increment them.
 */
const calls = vi.hoisted(() => ({ stats: 0, serialize: 0 }))

vi.mock('../src/count.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/count.js')>()
  return {
    ...actual,
    documentStats: (doc: PMNode) => {
      calls.stats += 1
      return actual.documentStats(doc)
    },
  }
})

vi.mock('@openleaf-editor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openleaf-editor/core')>()
  return {
    ...actual,
    serializeHtml: (doc: PMNode) => {
      calls.serialize += 1
      return actual.serializeHtml(doc)
    },
  }
})

function memory(): DraftStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

const HTML = '<p>one two three four five</p><p>six seven eight nine ten</p>'

let view: EditorView | undefined

interface Harness {
  host: EditorHost
  view: EditorView
  storage: DraftStorage
  status: () => string
}

function mount(options: SessionOptions = {}): Harness {
  const storage = options.storage ?? memory()
  const host = document.createElement('openleaf-editor') as EditorHost
  Object.defineProperty(host, 'view', { value: null, writable: true })
  Object.defineProperty(host, 'value', { value: '', writable: true })
  document.body.append(host)
  const place = document.createElement('div')
  host.append(place)
  const mounted = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(HTML, { schema: coreSchema() }),
      plugins: [sessionChrome({ restore: false, ...options, storage })],
    }),
  })
  view = mounted
  return {
    host,
    view: mounted,
    storage,
    status: () => host.querySelector('.ol-status')?.textContent ?? '',
  }
}

/** A caret move: a transaction that changes the selection and nothing else. */
function moveCaret(target: EditorView, pos: number): void {
  target.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, pos)))
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
  calls.stats = 0
  calls.serialize = 0
})

describe('word count cost', () => {
  it('constructs at most one Intl.Segmenter however many strings it counts', async () => {
    const original = Intl.Segmenter
    let constructions = 0
    class Counting extends original {
      constructor(...args: ConstructorParameters<typeof original>) {
        super(...args)
        constructions += 1
      }
    }
    ;(Intl as { Segmenter: typeof original }).Segmenter = Counting as unknown as typeof original
    try {
      // A cold copy of the module, so the count is the constructions this test
      // caused rather than whatever an earlier test left cached.
      vi.resetModules()
      const fresh = await vi.importActual<typeof import('../src/count.js')>('../src/count.js')
      for (let i = 0; i < 50; i += 1) expect(fresh.countWords('one two three')).toBe(3)
    } finally {
      ;(Intl as { Segmenter: typeof original }).Segmenter = original
    }
    expect(constructions).toBeLessThanOrEqual(1)
  })

  // The in-place count replaced `text.replace(/\s+/g, '').length`, which
  // allocated a second copy of the document. It has to agree with it exactly,
  // including on the spaces a pasted Word document is full of.
  it('counts non-space characters exactly as a whitespace strip would', async () => {
    const actual = await vi.importActual<typeof import('../src/count.js')>('../src/count.js')
    const samples = [
      '',
      'plain words here',
      // What Word pastes: a non-breaking space in place of most spaces.
      'nbsp\u00a0separated\u00a0words',
      'tabs\tand\nnewlines\r\nandvertical\u000b',
      'ideographic\u3000thin\u2009narrow\u202fem\u2003spaces',
      '   leading and trailing  ',
      // Format characters are not content. This fixture used to require ZWSP
      // to count because it is not `\s` -- that was the in-place walk agreeing
      // with `replace(/\s+/g, '')`, not a product rule that authors should see
      // extra characters. The walk still has to agree with a whitespace strip
      // of what remains after they are removed.
      'zero\u200bwidth\u200bspace',
      '\ufeff byte order mark is whitespace to the regex',
      'soft\u00adhyphenated',
    ]
    for (const sample of samples) {
      const doc = parseHtml(`<p>${sample}</p>`, { schema: coreSchema() })
      const text = actual.documentText(doc).replace(/[\u200b\u00ad\ufeff]/g, '')
      const stats = actual.documentStats(doc)
      expect(stats.characters).toBe(text.length)
      expect(stats.charactersExcludingSpaces).toBe(text.replace(/\s+/g, '').length)
    }
  })

  it('does not recount when only the selection moved', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = mount({ autosave: false })
    expect(harness.status()).toBe('10 words')
    const before = calls.stats

    for (let i = 1; i <= 10; i += 1) moveCaret(harness.view, 1 + (i % 5))
    vi.advanceTimersByTime(5000)

    expect(calls.stats - before).toBe(0)
    expect(harness.status()).toBe('10 words')
  })

  it('coalesces a burst of typing into a single recount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = mount({ autosave: false })
    const before = calls.stats

    for (let i = 0; i < 10; i += 1) harness.view.dispatch(harness.view.state.tr.insertText('a ', 1))
    // Still mid-burst: nothing has been counted yet.
    expect(calls.stats - before).toBe(0)

    vi.advanceTimersByTime(500)
    expect(calls.stats - before).toBe(1)
    // And the number it settled on is the right one: ten inserted "a"s.
    expect(harness.status()).toBe('20 words')
  })
})

describe('autosave cost', () => {
  it('does not serialize the document when only the selection moved', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = mount({ debounceMs: 100 })
    // Let the mount-time schedule settle, then measure from a quiet editor.
    vi.advanceTimersByTime(1000)
    const before = calls.serialize

    // Five separate pauses, each long enough to fire a debounce that a caret
    // move should never have armed.
    for (let round = 0; round < 5; round += 1) {
      moveCaret(harness.view, 1 + round)
      vi.advanceTimersByTime(1000)
    }

    expect(calls.serialize - before).toBe(0)
  })

  it('still writes a draft after a real edit', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = mount({ debounceMs: 100 })
    vi.advanceTimersByTime(1000)
    expect(readDraft(harness.storage, draftStorageKey(harness.host))).toBeNull()

    harness.view.dispatch(harness.view.state.tr.insertText('edited ', 1))
    vi.advanceTimersByTime(1000)

    const draft = readDraft(harness.storage, draftStorageKey(harness.host))
    expect(draft?.html).toContain('edited')
  })
})

describe('leave-warning cost', () => {
  it('answers the dirty check on an unchanged document without serializing', () => {
    const harness = mount({ autosave: false })
    const session = sessionFor(harness.host)
    const before = calls.serialize

    // What `beforeunload` does, once per editor on the page, on every link
    // click and every tab close.
    for (let i = 0; i < 20; i += 1) expect(session?.isDirty()).toBe(false)

    expect(calls.serialize - before).toBe(0)
  })

  it('still reports a dirty document after an edit', () => {
    const harness = mount({ autosave: false })
    const session = sessionFor(harness.host)
    expect(session?.isDirty()).toBe(false)

    harness.view.dispatch(harness.view.state.tr.insertText('x', 1))
    expect(session?.isDirty()).toBe(true)

    session?.markClean()
    expect(session?.isDirty()).toBe(false)
  })
})
