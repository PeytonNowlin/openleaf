import { describe, expect, it } from 'vitest'
import { registerTranslations, setUiLocale, t, uiLocale } from '../src/i18n.js'

describe('translations', () => {
  it('falls back to the source string, then overlays a locale', () => {
    const previous = uiLocale()
    setUiLocale('en')
    expect(t('Bold')).toBe('Bold')
    registerTranslations('fr', { Bold: 'Gras' })
    setUiLocale('fr')
    expect(t('Bold')).toBe('Gras')
    setUiLocale(previous)
  })
})
