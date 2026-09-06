/**
 * What find and replace says out loud.
 *
 * Two defects, both about a region nobody can hear. The count lived inside the
 * find bar, which is `hidden` until the moment it has something to say -- so
 * `open()` unhid the subtree and populated it in one task, and the first result
 * count was very likely swallowed. And jumping to a match announced "2 of 7"
 * but never the match: DOM focus stays in the input, the reading cursor never
 * moves, and the author is then asked to Replace text they cannot read.
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSave, sessionChrome, sessionFor, type SessionOptions } from '../src/chrome.js'
import { draftStorageKey, readDraft, type DraftStorage } from '../src/draft.js'
import { registerSaveHandler } from '../src/actions.js'
import { findNext, searchPlugin } from '../src/search.js'

const HAY = '<p>the quick brown fox jumps over the lazy dog and the fox runs on</p>'

let view: EditorView | null = null

function editor(html = HAY, options: SessionOptions = {}, parent: HTMLElement = document.body): { host: HTMLElement; view: EditorView } {
  const host = document.createElement('openleaf-editor')
  host.className = 'ol-editor'
  parent.appendChild(host)

  const mount = document.createElement('div')
  host.appendChild(mount)

  let current: EditorView | null = null
  Object.defineProperty(host, 'view', { get: () => current, configurable: true })
  Object.defineProperty(host, 'value', {
    get: () => (current ? serializeHtml(current.state.doc) : ''),
    set: () => undefined,
    configurable: true,
  })

  const created = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [
        searchPlugin(),
        sessionChrome({ autosave: false, warnBeforeLeave: false, restore: false, ...options }),
      ],
    }),
  })
  current = created
  view = created
  return { host, view: created }
}

function findBar(host: HTMLElement): HTMLElement {
  const bar = host.querySelector<HTMLElement>('.ol-find')
  if (!bar) throw new Error('no find bar')
  return bar
}

function spoken(host: HTMLElement): string {
  return host.querySelector('.ol-live-region')?.textContent ?? ''
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  view?.destroy()
  view = null
  vi.useRealTimers()
  registerSaveHandler(null)
})

describe('the find bar live region', () => {
  it('is mounted outside the subtree that is hidden until it speaks', () => {
    const { host } = editor()
    const region = host.querySelector('.ol-live-region')
    expect(region).not.toBeNull()
    // The whole point: not inside `.ol-find`, which carries `hidden` right up
    // to the moment the first count has to be read.
    expect(findBar(host).contains(region)).toBe(false)
    expect(region?.closest('[hidden]')).toBeNull()
  })

  it('announces the result count when a query is entered', () => {
    vi.useFakeTimers()
    const { host } = editor()
    sessionFor(host)?.openFind()

    const input = findBar(host).querySelector<HTMLInputElement>('input[name="find"]')
    input!.value = 'fox'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(200)

    expect(spoken(host)).toBe('2 matches')
  })

  it('says there are none rather than staying silent', () => {
    vi.useFakeTimers()
    const { host } = editor()
    sessionFor(host)?.openFind()
    const input = findBar(host).querySelector<HTMLInputElement>('input[name="find"]')
    input!.value = 'zzz'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(200)
    expect(spoken(host)).toBe('No matches')
  })
})

describe('jumping to a match', () => {
  it('reads the match in its context, not just a position', () => {
    vi.useFakeTimers()
    const { host, view: v } = editor()
    sessionFor(host)?.openFind()
    const input = findBar(host).querySelector<HTMLInputElement>('input[name="find"]')
    input!.value = 'fox'
    input!.dispatchEvent(new Event('input', { bubbles: true }))

    findNext(v.state, v.dispatch)
    vi.advanceTimersByTime(200)

    const message = spoken(host)
    // The position, so the author knows where they are in the set...
    expect(message).toContain('1 of 2')
    // ...and the text itself, because focus never left the input and the
    // reading cursor never moved to the highlight.
    expect(message).toContain('quick brown fox jumps')
  })
})

describe('Replace all focus', () => {
  function replaceAllButton(host: HTMLElement): HTMLButtonElement {
    const found = [...findBar(host).querySelectorAll('button')].find(
      (button) => button.textContent === 'Replace all',
    )
    if (!found) throw new Error('no Replace all button')
    return found
  }

  it('returns focus to the find field and still announces the replacement', () => {
    vi.useFakeTimers()
    const { host } = editor('<p>alpha beta alpha</p>')
    sessionFor(host)?.openFind()
    const bar = findBar(host)
    const findInput = bar.querySelector<HTMLInputElement>('input[name="find"]')
    const replaceInput = bar.querySelector<HTMLInputElement>('input[name="replace"]')
    findInput!.value = 'alpha'
    findInput!.dispatchEvent(new Event('input', { bubbles: true }))

    const button = replaceAllButton(host)
    // The author who invoked Replace all is on the button. Without moving
    // focus first, `sync` disables it (`hits === 0`) and every engine dumps
    // focus to `<body>`. Focusing the button here is what makes this test
    // fail against the unfixed handler, which never called `focusFind()`.
    button.focus()
    expect(document.activeElement).toBe(button)
    button.click()
    vi.advanceTimersByTime(200)

    expect(document.activeElement).toBe(findInput)
    expect(document.activeElement).not.toBe(replaceInput)
    expect(findInput!.value).toBe('alpha')
    expect(spoken(host)).toBe('2 replaced')
  })
})


describe('draft recovery under failure', () => {
  function storage(): DraftStorage {
    const data = new Map<string, string>()
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value) },
      removeItem: (key) => { data.delete(key) },
    }
  }

  it('keeps the editor usable when restoring a draft cannot read storage', () => {
    const broken = storage()
    broken.getItem = () => { throw new Error('storage denied') }
    expect(() => editor(HAY, { restore: true, storage: broken })).not.toThrow()
  })

  it('reports a failed autosave without losing the current document', async () => {
    vi.useFakeTimers()
    const broken = storage()
    broken.setItem = () => { throw new Error('quota exceeded') }
    const { host, view: v } = editor(HAY, { autosave: true, debounceMs: 10, storage: broken })
    const failures: unknown[] = []
    host.addEventListener('openleaf:draft-error', (event) => {
      failures.push((event as CustomEvent).detail)
    })
    v.dispatch(v.state.tr.insertText('still here ', 1))
    await vi.advanceTimersByTimeAsync(10)
    expect(failures).toEqual([{ operation: 'write' }])
    expect(serializeHtml(v.state.doc)).toContain('still here')
    expect(sessionFor(host)?.isDirty()).toBe(true)
    // Continuing to type must not flood a host's alert or live region.
    v.dispatch(v.state.tr.insertText('more ', 1))
    await vi.advanceTimersByTimeAsync(10)
    expect(failures).toHaveLength(1)
  })

  it('does not discard recovery when a form submission is canceled', () => {
    vi.useFakeTimers()
    const local = storage()
    const form = document.createElement('form')
    document.body.appendChild(form)
    const { host, view: v } = editor(HAY, { autosave: true, debounceMs: 10, storage: local }, form)
    v.dispatch(v.state.tr.insertText('unsaved ', 1))
    vi.advanceTimersByTime(10)
    form.addEventListener('submit', (event) => event.preventDefault())
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(sessionFor(host)?.isDirty()).toBe(true)
    expect(readDraft(local, draftStorageKey(host))?.html).toContain('unsaved')
  })
})


it('keeps edits made while a server save is in flight dirty and recoverable', async () => {
  const { host, view: v } = editor()
  v.dispatch(v.state.tr.insertText('first ', 1))
  let complete: (() => void) | undefined
  registerSaveHandler(() => new Promise<void>((resolve) => { complete = resolve }))
  runSave(v)
  v.dispatch(v.state.tr.insertText('second ', 1))
  complete?.()
  await Promise.resolve()
  await Promise.resolve()
  expect(sessionFor(host)?.isDirty()).toBe(true)
})


it('announces a rejected server save and retains unsaved work', async () => {
  const { host, view: v } = editor()
  v.dispatch(v.state.tr.insertText('keep me ', 1))
  registerSaveHandler(async () => { throw new Error('network down') })
  const failure = new Promise<void>((resolve) => {
    host.addEventListener('openleaf:save-error', () => resolve(), { once: true })
  })
  runSave(v)
  await failure
  expect(sessionFor(host)?.isDirty()).toBe(true)
  expect(serializeHtml(v.state.doc)).toContain('keep me')
})

it('clears the saved snapshot only after an acknowledged server save', async () => {
  const { host, view: v } = editor()
  v.dispatch(v.state.tr.insertText('confirmed ', 1))
  registerSaveHandler(async () => {})
  runSave(v)
  await Promise.resolve()
  await Promise.resolve()
  expect(sessionFor(host)?.isDirty()).toBe(false)
})
