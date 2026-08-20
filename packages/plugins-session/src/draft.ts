/**
 * Local draft storage for autosave and restore.
 *
 * Keys include the page path and the bound textarea id so two editors on one
 * page, or the same form on two routes, do not overwrite each other. The payload
 * is HTML plus a timestamp; quota failures are swallowed, because an autosave
 * that throws on a full disk would take the editor down on every keystroke.
 */

export const DRAFT_PREFIX = 'openleaf:draft:v1:'

export interface DraftRecord {
  html: string
  savedAt: number
}

export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function draftStorageKey(host: HTMLElement, location?: { pathname: string }): string {
  const id = host.getAttribute('for') || host.id || 'editor'
  const path = location?.pathname ?? host.ownerDocument.defaultView?.location.pathname ?? ''
  return `${DRAFT_PREFIX}${path}#${id}`
}

function memoryStorage(): DraftStorage {
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

export function defaultStorage(): DraftStorage {
  try {
    const storage = globalThis.localStorage
    if (!storage) return memoryStorage()
    const probe = `${DRAFT_PREFIX}probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return memoryStorage()
  }
}

export function readDraft(storage: DraftStorage, key: string): DraftRecord | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DraftRecord>
    if (typeof parsed.html !== 'string' || typeof parsed.savedAt !== 'number') return null
    return { html: parsed.html, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function writeDraft(storage: DraftStorage, key: string, html: string, at = Date.now()): void {
  try {
    storage.setItem(key, JSON.stringify({ html, savedAt: at }))
  } catch {
    /* quota -- losing a draft is better than crashing the editor */
  }
}

export function clearDraft(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    /* ignore */
  }
}
