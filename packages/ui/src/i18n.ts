/**
 * UI strings.
 *
 * English source text is the lookup key, so a missing translation still shows
 * something an author can read, and a new button does not require a coordinated
 * catalog bump before it can ship. `registerTranslations` overlays a locale;
 * last registration for a key wins, which is how a host replaces one phrase
 * without forking the catalog.
 */

const catalogs = new Map<string, Record<string, string>>()
const listeners = new Set<() => void>()
let locale = 'en'

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('@openleaf-editor/ui: a locale listener threw', error)
    }
  }
}

export function uiLocale(): string {
  return locale
}

export function setUiLocale(next: string): void {
  const value = next.trim() || 'en'
  if (value === locale) return
  locale = value
  notify()
}

export function registerTranslations(forLocale: string, messages: Record<string, string>): void {
  const existing = catalogs.get(forLocale) ?? {}
  catalogs.set(forLocale, { ...existing, ...messages })
  if (forLocale === locale) notify()
}

/** Translate a source string. Falls back to the string itself. */
export function t(source: string): string {
  const exact = catalogs.get(locale)?.[source]
  if (exact) return exact
  const language = locale.split('-')[0]
  if (language && language !== locale) {
    const regional = catalogs.get(language)?.[source]
    if (regional) return regional
  }
  return catalogs.get('en')?.[source] ?? source
}
