/**
 * Local draft storage for autosave and restore.
 *
 * A key is the page path, the query string, and a suffix naming the editor
 * within the page: `prefix + pathname + search + '#' + suffix`. The query string
 * is part of it because a record editor addresses its row there -- without it
 * `/admin/edit?id=1` and `?id=2` are one key, and opening record 2 is offered
 * record 1's unsaved text. The suffix is a `draft-key` attribute if the page
 * sets one, otherwise the bound textarea id, otherwise the host's position among
 * the same-tag editors in the document. That position is used rather than a
 * random id because a draft nobody can find on the next page load is no draft at
 * all, and the first such editor keeps the bare `editor` suffix so records
 * written by earlier versions are still picked up.
 *
 * The payload is HTML plus a timestamp; quota failures are swallowed, because an
 * autosave that throws on a full disk would take the editor down on every
 * keystroke.
 *
 * Privacy: a draft is the whole document, held in plaintext in `localStorage`,
 * readable by any script on the origin and by anyone with the machine. Nothing
 * here encrypts it. Records expire after `DRAFT_TTL_MS` -- `readDraft` refuses
 * and deletes an expired one, and `purgeDrafts` sweeps the rest -- so an
 * abandoned draft stops sitting on disk indefinitely.
 */

export const DRAFT_PREFIX = 'openleaf:draft:v1:'

/** How long a draft stays offerable. Past it the record is deleted on sight. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface DraftRecord {
  html: string
  savedAt: number
}

export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /**
   * Enumeration, as `localStorage` exposes it. Optional so a caller can pass a
   * bare three-method shim; `purgeDrafts` does nothing when it is missing rather
   * than demanding every embedder grow a key listing.
   */
  readonly length?: number
  key?(index: number): string | null
}

/**
 * Names an editor the page gave no id to.
 *
 * Two anonymous editors on one page both answered to the literal `editor` and
 * so shared a draft. Counting position among the same-tag editors separates them
 * and still survives a reload, which a generated id would not. A host that is
 * not in the document yet reports no position and keeps the bare name.
 */
function ordinalId(host: HTMLElement): string {
  const peers = Array.from(host.ownerDocument.querySelectorAll(host.tagName))
  const index = peers.indexOf(host)
  return index > 0 ? `editor-${index}` : 'editor'
}

export function draftStorageKey(
  host: HTMLElement,
  location?: { pathname: string; search?: string },
): string {
  const here = host.ownerDocument.defaultView?.location
  const id = host.getAttribute('draft-key') || host.getAttribute('for') || host.id || ordinalId(host)
  const path = location?.pathname ?? here?.pathname ?? ''
  const query = location?.search ?? here?.search ?? ''
  return `${DRAFT_PREFIX}${path}${query}#${id}`
}

function memoryStorage(): DraftStorage {
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

/** A clock skewed forward leaves `savedAt` in the future; that is not stale. */
function isExpired(savedAt: number, now: number): boolean {
  return now - savedAt > DRAFT_TTL_MS
}

export function readDraft(storage: DraftStorage, key: string, now = Date.now()): DraftRecord | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DraftRecord>
    if (typeof parsed.html !== 'string' || typeof parsed.savedAt !== 'number') return null
    if (isExpired(parsed.savedAt, now)) {
      clearDraft(storage, key)
      return null
    }
    return { html: parsed.html, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

/**
 * Deletes every expired draft on the origin.
 *
 * `readDraft` only ever reaches the key the current page asks for, so drafts for
 * pages nobody reopens would sit there for good. Keys are collected before any
 * removal because removing during the walk renumbers the indices and would skip
 * entries. Nothing here throws: a sweep is housekeeping, and a storage that
 * denies access mid-walk must not take the editor's startup with it.
 */
export function purgeDrafts(storage: DraftStorage, now = Date.now()): void {
  const total = storage.length
  const keyAt = storage.key
  if (typeof total !== 'number' || typeof keyAt !== 'function') return

  const expired: string[] = []
  for (let index = 0; index < total; index += 1) {
    try {
      const key = keyAt.call(storage, index)
      if (key === null || !key.startsWith(DRAFT_PREFIX)) continue
      const raw = storage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as Partial<DraftRecord>
      if (typeof parsed.savedAt === 'number' && isExpired(parsed.savedAt, now)) expired.push(key)
    } catch {
      /* one corrupt or unreadable entry must not stop the rest of the sweep */
    }
  }

  for (const key of expired) clearDraft(storage, key)
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
