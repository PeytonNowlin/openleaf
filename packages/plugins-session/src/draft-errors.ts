import type { DraftStorage } from './draft.js'

export const DRAFT_ERROR_EVENT = 'openleaf:draft-error'
export interface DraftErrorDetail {
  operation: 'read' | 'write' | 'clear' | 'unavailable'
}

/**
 * Storage can disappear after startup (quota, privacy settings, an embedding
 * application's adapter). Report each failing operation once until it recovers,
 * without throwing through editing or disclosing document contents or keys.
 */
export function observeDraftStorage(host: HTMLElement, storage: DraftStorage): DraftStorage {
  const failed = new Set<DraftErrorDetail['operation']>()
  const report = (operation: DraftErrorDetail['operation']): void => {
    if (failed.has(operation)) return
    failed.add(operation)
    queueMicrotask(() => host.dispatchEvent(new CustomEvent<DraftErrorDetail>(DRAFT_ERROR_EVENT, {
      bubbles: true,
      composed: true,
      detail: { operation },
    })))
  }
  if (storage.persistent === false) report('unavailable')
  return {
    getItem(key) {
      try {
        const value = storage.getItem(key)
        failed.delete('read')
        return value
      } catch {
        report('read')
        return null
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value)
        failed.delete('write')
      } catch {
        report('write')
      }
    },
    removeItem(key) {
      try {
        storage.removeItem(key)
        failed.delete('clear')
      } catch {
        report('clear')
      }
    },
  }
}
