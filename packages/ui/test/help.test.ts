/**
 * The F1 help dialog has to tell the truth about Tab.
 *
 * Tab is unbound on purpose (WCAG 2.1.2). Help used to list only Alt+F10 as
 * the toolbar move, so an author looking for "indent in a code block" found
 * neither the key that leaves the editor nor the fact that indentation in
 * `<pre>` is typed spaces. These tests read the dialog DOM, not the source
 * array, because that is what the author sees.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { promptHelp } from '../src/help.js'

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
})

function openHelp(): HTMLFormElement {
  promptHelp(document)
  const form = document.querySelector('dialog form')
  if (!(form instanceof HTMLFormElement)) throw new Error('no help dialog was opened')
  return form
}

function rows(form: HTMLFormElement): Array<{ keys: string; label: string }> {
  return [...form.querySelectorAll('tr')].map((row) => ({
    keys: row.querySelector('th')?.textContent ?? '',
    label: row.querySelector('td')?.textContent ?? '',
  }))
}

describe('the help dialog', () => {
  it('lists Tab as leaving the editor, not as moving to the toolbar', () => {
    const listed = rows(openHelp())
    const tab = listed.find((row) => row.keys === 'Tab')
    expect(tab).toBeDefined()
    expect(tab?.label.toLowerCase()).toMatch(/leave the editor/)
    expect(tab?.label.toLowerCase()).toMatch(/code block/)
    const toolbar = listed.find((row) => row.keys === 'Alt+F10')
    expect(toolbar?.label.toLowerCase()).toMatch(/toolbar/)
    expect(toolbar?.label.toLowerCase()).not.toMatch(/^tab\b/)
  })

  it('says code-block indentation is typed spaces, without claiming Indent is a no-op', () => {
    const form = openHelp()
    const hint = form.querySelector('.ol-hint')?.textContent ?? ''
    expect(hint.toLowerCase()).toMatch(/spaces/)
    expect(hint.toLowerCase()).toMatch(/code/)
    // indent asks enclosingList first, so Mod-] in a listed code block still
    // nests the item. Help must not call that a no-op, and must not spend a
    // subordinate clause explaining it — Indent is already in the table.
    expect(hint.toLowerCase()).not.toMatch(/not code/)
    expect(hint).not.toMatch(/Ctrl\+\]|⌘\]/)
    const indent = rows(form).find((row) => row.label === 'Indent')
    expect(indent).toBeDefined()
  })
})
