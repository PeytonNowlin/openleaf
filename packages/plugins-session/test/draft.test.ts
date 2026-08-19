import { describe, expect, it } from 'vitest'
import { clearDraft, readDraft, writeDraft, type DraftStorage } from '../src/draft.js'

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

describe('draft storage', () => {
  it('round-trips html and a timestamp', () => {
    const storage = memory()
    writeDraft(storage, 'k', '<p>hi</p>', 1700000000000)
    expect(readDraft(storage, 'k')).toEqual({ html: '<p>hi</p>', savedAt: 1700000000000 })
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
})
