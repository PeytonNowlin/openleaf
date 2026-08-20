import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDraft,
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  draftStorageKey,
  purgeDrafts,
  readDraft,
  writeDraft,
  type DraftStorage,
} from '../src/draft.js'

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

/** A storage that can be walked, the way a real `localStorage` can. */
function listableMemory(): DraftStorage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function editor(): HTMLElement {
  const host = document.createElement('openleaf-editor')
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('draft storage', () => {
  it('round-trips html and a timestamp', () => {
    const storage = memory()
    writeDraft(storage, 'k', '<p>hi</p>', 1700000000000)
    expect(readDraft(storage, 'k', 1700000000000)).toEqual({ html: '<p>hi</p>', savedAt: 1700000000000 })
  })

  it('returns null for missing or corrupt records', () => {
    const storage = memory()
    expect(readDraft(storage, 'missing')).toBeNull()
    storage.setItem('bad', '{')
    expect(readDraft(storage, 'bad')).toBeNull()
  })

  it('clears a stored draft', () => {
    const storage = memory()
    writeDraft(storage, 'k', '<p>hi</p>')
    clearDraft(storage, 'k')
    expect(readDraft(storage, 'k')).toBeNull()
  })

  it('keeps a draft that is still inside the ttl', () => {
    const storage = memory()
    writeDraft(storage, 'k', '<p>hi</p>', 1000)
    expect(readDraft(storage, 'k', 1000 + DRAFT_TTL_MS)).toEqual({ html: '<p>hi</p>', savedAt: 1000 })
  })

  it('treats an expired draft as absent and deletes it', () => {
    const storage = memory()
    writeDraft(storage, 'k', '<p>hi</p>', 1000)
    expect(readDraft(storage, 'k', 1000 + DRAFT_TTL_MS + 1)).toBeNull()
    expect(storage.getItem('k')).toBeNull()
  })
})

describe('draftStorageKey', () => {
  it('separates two records on one path by their query string', () => {
    const host = editor()
    host.id = 'body'
    const one = draftStorageKey(host, { pathname: '/admin/edit', search: '?id=1' })
    const two = draftStorageKey(host, { pathname: '/admin/edit', search: '?id=2' })
    expect(one).not.toBe(two)
  })

  it('gives two anonymous editors on one page distinct keys', () => {
    const first = editor()
    const second = editor()
    const one = draftStorageKey(first, { pathname: '/p', search: '' })
    const two = draftStorageKey(second, { pathname: '/p', search: '' })
    expect(one).not.toBe(two)
    // Drafts written by the released version live under the bare suffix.
    expect(one).toBe(`${DRAFT_PREFIX}/p#editor`)
  })

  it('lets a draft-key attribute override the derived suffix', () => {
    const host = editor()
    host.id = 'body'
    host.setAttribute('draft-key', 'record-7')
    expect(draftStorageKey(host, { pathname: '/p', search: '?id=1' })).toBe(`${DRAFT_PREFIX}/p?id=1#record-7`)
  })
})

describe('purgeDrafts', () => {
  it('removes expired records and leaves everything else', () => {
    const storage = listableMemory()
    const now = 1000 + DRAFT_TTL_MS + 1
    writeDraft(storage, `${DRAFT_PREFIX}stale`, '<p>old</p>', 1000)
    writeDraft(storage, `${DRAFT_PREFIX}fresh`, '<p>new</p>', now - 1)
    // Not ours to sweep, however old it looks.
    storage.setItem('other:key', JSON.stringify({ html: '<p>x</p>', savedAt: 1000 }))
    storage.setItem(`${DRAFT_PREFIX}corrupt`, '{')

    purgeDrafts(storage, now)

    expect(storage.getItem(`${DRAFT_PREFIX}stale`)).toBeNull()
    expect(storage.getItem(`${DRAFT_PREFIX}fresh`)).not.toBeNull()
    expect(storage.getItem('other:key')).not.toBeNull()
    // A record it cannot parse has no timestamp to judge, so it is left alone
    // rather than guessed at.
    expect(storage.getItem(`${DRAFT_PREFIX}corrupt`)).not.toBeNull()
  })

  it('does nothing when the storage cannot be walked', () => {
    const storage = memory()
    writeDraft(storage, `${DRAFT_PREFIX}stale`, '<p>old</p>', 1000)
    expect(() => {
      purgeDrafts(storage, 1000 + DRAFT_TTL_MS + 1)
    }).not.toThrow()
    expect(storage.getItem(`${DRAFT_PREFIX}stale`)).not.toBeNull()
  })
})
