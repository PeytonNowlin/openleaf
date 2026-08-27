/**
 * Session chrome in a language that is not English.
 *
 * The word count baked in English's plural rule (`n === 1`), which is only
 * English's: Russian needs three forms and Japanese one. And the generated
 * preview and print documents declared no `lang` at all, so a screen reader read
 * them in whatever voice it was already using -- with the preview additionally
 * having no `<title>`, which makes it an untitled page.
 */

import { registerTranslations, setUiLocale } from '@openleaf-editor/ui'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { formatWordCount } from '../src/count.js'
import { showPreview } from '../src/dialogs.js'

beforeAll(() => {
  const proto = Object.getPrototypeOf(document.createElement('dialog')) as {
    showModal?: () => void
    close?: () => void
  }
  proto.showModal = function (this: HTMLElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  setUiLocale('en')
  document.documentElement.removeAttribute('lang')
})

function stats(words: number) {
  return { words, characters: 0, charactersExcludingSpaces: 0, paragraphs: 0 }
}

describe('the word count', () => {
  it('keeps English reading naturally', () => {
    expect(formatWordCount(stats(1), 'en')).toBe('1 word')
    expect(formatWordCount(stats(7), 'en')).toBe('7 words')
    expect(formatWordCount(stats(0), 'en')).toBe('0 words')
  })

  it('uses the locale plural category, not English one', () => {
    // Russian: 1 is `one`, 3 is `few`, 7 is `many`. English's `n === 1` cannot
    // express that, and no catalog can fix a rule baked into the code.
    registerTranslations('ru', {
      '{count} words#one': '{count} слово',
      '{count} words#few': '{count} слова',
      '{count} words#many': '{count} слов',
    })
    expect(formatWordCount(stats(1), 'ru')).toBe('1 слово')
    expect(formatWordCount(stats(3), 'ru')).toBe('3 слова')
    expect(formatWordCount(stats(7), 'ru')).toBe('7 слов')
  })

  it('falls back to the two-form keys for a locale with no category catalog', () => {
    registerTranslations('fr', { '{count} word': '{count} mot', '{count} words': '{count} mots' })
    expect(formatWordCount(stats(1), 'fr')).toBe('1 mot')
    expect(formatWordCount(stats(9), 'fr')).toBe('9 mots')
  })

  it('survives a lang attribute that is not a locale', () => {
    expect(formatWordCount(stats(4), 'not a locale!!')).toBe('4 words')
  })
})

describe('the preview document', () => {
  it('declares the page language and gives itself a title', () => {
    document.documentElement.setAttribute('lang', 'fr')
    showPreview(document, '<p>bonjour</p>')
    const srcdoc = document.querySelector('iframe.ol-preview-frame')?.getAttribute('srcdoc') ?? ''
    const parsed = new DOMParser().parseFromString(srcdoc, 'text/html')
    expect(parsed.documentElement.getAttribute('lang')).toBe('fr')
    expect(parsed.title).toBe('Preview')
  })

  it('gives each dialog its own heading id, so two editors cannot collide', () => {
    showPreview(document, '<p>one</p>')
    const first = document.querySelector('dialog')
    const firstId = first?.getAttribute('aria-labelledby')
    first?.remove()
    showPreview(document, '<p>two</p>')
    const secondId = document.querySelector('dialog')?.getAttribute('aria-labelledby')
    expect(firstId).toBeTruthy()
    expect(secondId).not.toBe(firstId)
  })
})
