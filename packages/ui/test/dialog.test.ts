/**
 * The link and image dialogs, where a chooser and a typed address meet.
 *
 * jsdom has no `<dialog>` modality, so `showModal` and `close` are shimmed. That
 * is enough to check which fields exist and what a submission resolves to;
 * focus, the backdrop and Escape belong in Playwright.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { promptForImage, promptForLink } from '../src/dialog.js'
import { registerImageList, registerLinkList } from '../src/pickers.js'

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
  registerLinkList(null)
  registerImageList(null)
  for (const dialog of Array.from(document.querySelectorAll('dialog'))) dialog.remove()
})

function openForm(): HTMLFormElement {
  const form = document.querySelector('dialog form')
  if (!(form instanceof HTMLFormElement)) throw new Error('no dialog form was opened')
  return form
}

function control<T extends HTMLElement>(form: HTMLFormElement, name: string): T {
  const el = form.elements.namedItem(name)
  if (!el) throw new Error(`no control named ${name}`)
  return el as unknown as T
}

/** Pick a value the way a person does: set it, then let the change event fly. */
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('promptForLink with a page list', () => {
  it('uses a chosen page for a new link', async () => {
    registerLinkList(() => [{ value: '/about', title: 'About us' }])
    const pending = promptForLink(document)
    const form = openForm()
    choose(control<HTMLSelectElement>(form, 'listed'), '/about')
    submit(form)
    expect((await pending)?.href).toBe('/about')
  })

  // The address is prefilled when editing, so a chooser that merely contributed
  // its value could never win against it -- the list worked only for new links.
  it('lets a chosen page replace the address of an existing link', async () => {
    registerLinkList(() => [{ value: '/about', title: 'About us' }])
    const pending = promptForLink(document, { href: '/old' })
    const form = openForm()
    choose(control<HTMLSelectElement>(form, 'listed'), '/about')
    expect(control<HTMLInputElement>(form, 'href').value).toBe('/about')
    submit(form)
    expect((await pending)?.href).toBe('/about')
  })

  it('keeps a typed address when no page is chosen', async () => {
    registerLinkList(() => [{ value: '/about', title: 'About us' }])
    const pending = promptForLink(document, { href: '/old' })
    const form = openForm()
    submit(form)
    expect((await pending)?.href).toBe('/old')
  })

  it('lets the author edit the address after choosing a page', async () => {
    registerLinkList(() => [{ value: '/about', title: 'About us' }])
    const pending = promptForLink(document)
    const form = openForm()
    choose(control<HTMLSelectElement>(form, 'listed'), '/about')
    control<HTMLInputElement>(form, 'href').value = '/about/team'
    submit(form)
    expect((await pending)?.href).toBe('/about/team')
  })
})

describe('promptForImage with an image list', () => {
  it('lets a chosen image replace the address of an existing image', async () => {
    registerImageList(() => [{ value: '/new.png', title: 'New' }])
    const pending = promptForImage(document, { existing: { src: '/old.png', alt: 'Old' } })
    const form = openForm()
    choose(control<HTMLSelectElement>(form, 'listed'), '/new.png')
    expect(control<HTMLInputElement>(form, 'src').value).toBe('/new.png')
    submit(form)
    expect((await pending)?.src).toBe('/new.png')
  })
})
