import { afterEach, describe, expect, it } from 'vitest'
import { fill, registerTranslations, setUiLocale, t, uiLocale } from '../src/i18n.js'

describe('translations', () => {
  afterEach(() => {
    setUiLocale('en')
  })

  it('falls back to the source string, then overlays a locale', () => {
    const previous = uiLocale()
    setUiLocale('en')
    expect(t('Bold')).toBe('Bold')
    registerTranslations('fr', { Bold: 'Gras' })
    setUiLocale('fr')
    expect(t('Bold')).toBe('Gras')
    setUiLocale(previous)
  })

  // A Record catalog inherited Object.prototype, so `t('constructor')` returned
  // the Object constructor the moment any catalog existed for the locale.
  it('does not treat Object.prototype members as translations', () => {
    registerTranslations('xx-proto', { Bold: 'Gras' })
    setUiLocale('xx-proto')
    expect(t('constructor')).toBe('constructor')
    expect(t('toString')).toBe('toString')
    expect(t('__proto__')).toBe('__proto__')
    expect(t('hasOwnProperty')).toBe('hasOwnProperty')
    expect(typeof t('constructor')).toBe('string')
  })

  it('still translates those keys when they are actually in the catalog', () => {
    registerTranslations('xx-own', { constructor: 'Ctor', toString: 'Str' })
    setUiLocale('xx-own')
    expect(t('constructor')).toBe('Ctor')
    expect(t('toString')).toBe('Str')
  })

  it('does not substitute inherited members into {placeholders}', () => {
    expect(fill('see {constructor}', {})).toBe('see {constructor}')
    expect(fill('see {toString}', {})).toBe('see {toString}')
    expect(fill('{count} words', { count: '7' })).toBe('7 words')
    expect(fill('{constructor} ok', { constructor: 'own' })).toBe('own ok')
  })
})
