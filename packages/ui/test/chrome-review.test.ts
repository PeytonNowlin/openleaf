/**
 * Unit coverage for the review fixes that do not need a browser.
 *
 * The menubar list and the locale scope are both pure logic. Fullscreen, the
 * overflow menu and the formats dropdown need layout or real UA behaviour and
 * live in `packages/element/test/e2e/chrome.spec.ts` instead.
 */

import { formatParts } from '@openleaf-editor/core'
import { afterEach, describe, expect, it } from 'vitest'
import { registerTranslations, setUiLocale, t, uiLocale, withLocale } from '../src/i18n.js'
import { DEFAULT_MENUBAR, selectMenus } from '../src/menu.js'

describe('selectMenus', () => {
  // `menubar` with no value means "give me the menubar".
  it('returns every menu for an empty attribute', () => {
    expect(selectMenus('')).toEqual(DEFAULT_MENUBAR)
    expect(selectMenus(null)).toEqual(DEFAULT_MENUBAR)
  })

  // The attribute was read as a boolean and the list discarded, so
  // menubar="edit help" rendered Insert, Format and View as well.
  it('honours a named list, in the order given', () => {
    expect(selectMenus('help edit').map((menu) => menu.id)).toEqual(['help', 'edit'])
  })

  it('accepts commas as well as spaces', () => {
    expect(selectMenus('edit, insert').map((menu) => menu.id)).toEqual(['edit', 'insert'])
  })

  it('skips an id it does not recognise rather than throwing', () => {
    expect(selectMenus('edit nonsense').map((menu) => menu.id)).toEqual(['edit'])
  })

  it('returns nothing when no id matches, so no empty menubar is built', () => {
    expect(selectMenus('nonsense')).toEqual([])
  })

  it('does not repeat a menu named twice', () => {
    expect(selectMenus('edit edit').map((menu) => menu.id)).toEqual(['edit'])
  })
})

describe('withLocale', () => {
  afterEach(() => {
    setUiLocale('en')
  })

  // Two editors with different `lang` values on one page both ended up in
  // whichever built last, because the locale was process-wide.
  it('translates inside the scope without moving the document locale', () => {
    registerTranslations('fr', { Bold: 'Gras' })
    setUiLocale('en')
    expect(withLocale('fr', () => t('Bold'))).toBe('Gras')
    expect(t('Bold')).toBe('Bold')
    expect(uiLocale()).toBe('en')
  })

  it('restores the previous scope even when the render throws', () => {
    registerTranslations('fr', { Bold: 'Gras' })
    expect(() =>
      withLocale('fr', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(t('Bold')).toBe('Bold')
  })

  it('nests', () => {
    registerTranslations('fr', { Bold: 'Gras' })
    registerTranslations('de', { Bold: 'Fett' })
    withLocale('fr', () => {
      expect(t('Bold')).toBe('Gras')
      withLocale('de', () => expect(t('Bold')).toBe('Fett'))
      expect(t('Bold')).toBe('Gras')
    })
    expect(t('Bold')).toBe('Bold')
  })

  it('falls through to the document locale when given none', () => {
    registerTranslations('fr', { Bold: 'Gras' })
    setUiLocale('fr')
    expect(withLocale(null, () => t('Bold'))).toBe('Gras')
  })
})

describe('formatParts', () => {
  // The element half was parsed and then thrown away, so `h2=Section` set
  // class="h2" on the current block instead of making it a heading.
  it('splits an element and a class', () => {
    expect(formatParts('p.lead')).toEqual({ element: 'p', className: 'lead' })
  })

  it('reads an element on its own', () => {
    expect(formatParts('h2')).toEqual({ element: 'h2', className: null })
  })

  it('reads a class on its own', () => {
    expect(formatParts('.note')).toEqual({ element: null, className: 'note' })
  })

  it('reads every class a selector names', () => {
    expect(formatParts('p.lead.wide')).toEqual({ element: 'p', className: 'lead wide' })
  })

  it('treats an empty token as naming nothing', () => {
    expect(formatParts('   ')).toEqual({ element: null, className: null })
  })
})
