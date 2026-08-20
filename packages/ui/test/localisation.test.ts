/**
 * What a screen reader hears in a language that is not English.
 *
 * `t()` existed and was exported, but was called only inside the toolbar's own
 * label rendering. Everything an assistive technology consumes downstream of
 * that -- the announcement of a formatting change, and every string in the link
 * and image dialogs -- was a hardcoded English literal. A `lang="fr"` editor
 * showed "Gras" on the button and said "Bold on" when it was pressed.
 *
 * So each test here sets a locale, drives real behaviour, and asserts on the
 * French. Asserting that `t` was called would not have caught any of it.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { promptForImage, promptForLink } from '../src/dialog.js'
import { promptHelp } from '../src/help.js'
import { registerTranslations, setUiLocale } from '../src/i18n.js'
import { registerDefaultItems } from '../src/items.js'
import { Toolbar } from '../src/toolbar.js'

registerDefaultItems()

registerTranslations('fr', {
  Bold: 'Gras',
  '{label} on': '{label} activé',
  '{label} off': '{label} désactivé',
  'Insert link': 'Insérer un lien',
  Address: 'Adresse',
  Title: 'Titre',
  Cancel: 'Annuler',
  Save: 'Enregistrer',
  'Enter an address for the link.': 'Saisissez une adresse pour le lien.',
  'Open in a new window': 'Ouvrir dans une nouvelle fenêtre',
  'Insert image': 'Insérer une image',
  'Alternative text': 'Texte alternatif',
  'Keyboard shortcuts': 'Raccourcis clavier',
  Close: 'Fermer',
})

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

afterEach(() => {
  for (const dialog of Array.from(document.querySelectorAll('dialog'))) dialog.remove()
  document.body.replaceChildren()
  setUiLocale('en')
  vi.useRealTimers()
})

function frenchHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'ol-editor'
  host.setAttribute('lang', 'fr')
  document.body.appendChild(host)
  return host
}

function openForm(): HTMLFormElement {
  const form = document.querySelector('dialog form')
  if (!(form instanceof HTMLFormElement)) throw new Error('no dialog form was opened')
  return form
}

function labels(form: HTMLFormElement): string[] {
  return [...form.querySelectorAll('.ol-field > label')].map((label) => label.textContent ?? '')
}

function buttonText(form: HTMLFormElement): string[] {
  return [...form.querySelectorAll('button')].map((b) => b.textContent ?? '')
}

describe('announcing a formatting change', () => {
  it('says it in the editor own language, label and state alike', () => {
    vi.useFakeTimers()
    const host = frenchHost()

    let state = EditorState.create({ doc: parseHtml('<p>bonjour</p>', { schema: coreSchema() }) })
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    )
    const view = {
      get state() {
        return state
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr)
      },
      focus: () => undefined,
    } as unknown as EditorView

    const toolbar = new Toolbar(host, document, { layout: 'bold', locale: 'fr' })
    host.appendChild(toolbar.el)
    toolbar.mount(view)

    const strong = state.schema.marks['strong']
    if (!strong) throw new Error('no strong mark')
    const tr = state.tr.addMark(1, state.doc.content.size - 1, strong.create())
    state = state.apply(tr)
    toolbar.update(state, tr)
    vi.advanceTimersByTime(100)

    // The button already said "Gras". The announcement said "Bold on": it was
    // built from the raw lookup key, and 'on'/'off' had no translation path.
    expect(host.querySelector('.ol-live-region')?.textContent).toBe('Gras activé')
    toolbar.destroy()
  })
})

describe('the link dialog', () => {
  it('is built in the editor own language', () => {
    void promptForLink(document, undefined, frenchHost())
    const form = openForm()
    expect(form.querySelector('h2')?.textContent).toBe('Insérer un lien')
    expect(labels(form)).toContain('Adresse')
    expect(buttonText(form)).toEqual(expect.arrayContaining(['Annuler', 'Enregistrer']))
  })

  it('reports a validation failure in that language too', () => {
    void promptForLink(document, undefined, frenchHost())
    const form = openForm()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(form.querySelector('.ol-error')?.textContent).toBe(
      'Saisissez une adresse pour le lien.',
    )
  })

  it('stays English for an editor that asked for no language', () => {
    void promptForLink(document)
    const form = openForm()
    expect(form.querySelector('h2')?.textContent).toBe('Insert link')
  })
})

describe('a dialog field', () => {
  it('carries its hint as a description, not as part of its name', () => {
    void promptForLink(document)
    const form = openForm()
    const href = form.elements.namedItem('href') as HTMLInputElement
    const describedBy = href.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const hint = form.querySelector(`#${describedBy}`)
    expect(hint?.textContent).toMatch(/For example https:\/\/example.org/)
    // The hint used to be a <span> inside the <label>, which folds into the
    // accessible NAME: the field was called "Address For example
    // https://example.org, /about, or mailto:someone@example.org".
    const label = form.querySelector('.ol-field > label')
    expect(label?.textContent).toBe('Address')
  })

  it('says it is required, even though the element deliberately is not', () => {
    void promptForLink(document)
    const form = openForm()
    const href = form.elements.namedItem('href') as HTMLInputElement
    expect(href.getAttribute('aria-required')).toBe('true')
    expect(href.hasAttribute('required')).toBe(false)
  })

  it('is marked invalid and described by the error it caused', () => {
    void promptForLink(document)
    const form = openForm()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    const href = form.elements.namedItem('href') as HTMLInputElement
    expect(href.getAttribute('aria-invalid')).toBe('true')
    const errorId = form.querySelector('.ol-error')?.id
    expect(errorId).toBeTruthy()
    expect(href.getAttribute('aria-describedby')?.split(' ')).toContain(errorId)

    // The title field is fine, and must not be reported as invalid.
    const title = form.elements.namedItem('title') as HTMLInputElement
    expect(title.getAttribute('aria-invalid')).toBe('false')
  })
})

describe('the image dialog', () => {
  it('is built in the editor own language', () => {
    void promptForImage(document, { host: frenchHost() })
    const form = openForm()
    expect(form.querySelector('h2')?.textContent).toBe('Insérer une image')
    expect(labels(form)).toContain('Texte alternatif')
  })
})

describe('the help dialog', () => {
  it('is built in the editor own language', () => {
    promptHelp(document, 'fr')
    const form = openForm()
    expect(form.querySelector('h2')?.textContent).toBe('Raccourcis clavier')
    expect(buttonText(form)).toContain('Fermer')
  })

  it('gives each dialog its own heading id, so two editors cannot collide', () => {
    promptHelp(document, null)
    const first = document.querySelector('dialog')
    const firstId = first?.getAttribute('aria-labelledby')
    first?.remove()
    promptHelp(document, null)
    const secondId = document.querySelector('dialog')?.getAttribute('aria-labelledby')
    expect(firstId).toBeTruthy()
    expect(secondId).not.toBe(firstId)
  })
})
