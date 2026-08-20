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
let scoped: string | null = null

/**
 * Run `render` with `forLocale` in force, then put the previous one back.
 *
 * Each editor carries its own `lang`, and the document-wide locale cannot serve
 * that: two editors with different languages on one page would both end up in
 * whichever built last. Threading a locale argument through every label in every
 * component would say the same thing far more loudly, so the scope is a
 * synchronous one instead -- labels produced while rendering see their own
 * editor's locale.
 *
 * Synchronous is the constraint worth knowing: a label built later, outside any
 * render, falls back to the document locale.
 */
export function withLocale<T>(forLocale: string | null | undefined, render: () => T): T {
  if (!forLocale) return render()
  const previous = scoped
  scoped = forLocale
  try {
    return render()
  } finally {
    scoped = previous
  }
}

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

/** The document-wide locale. Inside `withLocale` the scoped one wins. */
export function uiLocale(): string {
  return scoped ?? locale
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
  // Notified whatever locale this is for. Each editor now carries its own, so
  // "does this match the document locale" no longer answers "does anybody care":
  // a catalog registered after the editors were built -- the ordinary case for a
  // script tag -- would otherwise never reach the editor it was meant for.
  notify()
}

/** Translate a source string. Falls back to the string itself. */
export function t(source: string): string {
  const current = scoped ?? locale
  const exact = catalogs.get(current)?.[source]
  if (exact) return exact
  const language = current.split('-')[0]
  if (language && language !== current) {
    const regional = catalogs.get(language)?.[source]
    if (regional) return regional
  }
  return catalogs.get('en')?.[source] ?? source
}
