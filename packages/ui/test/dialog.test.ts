/**
 * The link and image dialogs, where a chooser and a typed address meet.
 *
 * jsdom has no `<dialog>` modality, so `showModal` and `close` are shimmed. That
 * is enough to check which fields exist and what a submission resolves to;
 * focus, the backdrop and Escape belong in Playwright.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { promptForImage, promptForLink } from '../src/dialog.js'
import { registerFilePicker, registerImageList, registerLinkList } from '../src/pickers.js'

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
  registerFilePicker(null)
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

describe('promptForImage when editing', () => {
  it('prefills the fields and keeps dimensions the dialog does not expose', async () => {
    const pending = promptForImage(document, {
      existing: {
        src: '/a.png',
        alt: 'A goat on a roof',
        title: 'Goat',
        className: 'rounded',
        align: 'left',
        caption: 'Fig 1',
        width: '640',
        height: '480',
      },
    })
    const form = openForm()
    expect(form.querySelector('h2')?.textContent).toBe('Edit image')
    expect(control<HTMLInputElement>(form, 'src').value).toBe('/a.png')
    expect(control<HTMLInputElement>(form, 'alt').value).toBe('A goat on a roof')
    expect(control<HTMLInputElement>(form, 'title').value).toBe('Goat')
    expect(control<HTMLInputElement>(form, 'className').value).toBe('rounded')
    expect(control<HTMLSelectElement>(form, 'align').value).toBe('left')
    expect(control<HTMLInputElement>(form, 'caption').value).toBe('Fig 1')
    submit(form)
    expect(await pending).toMatchObject({
      src: '/a.png',
      alt: 'A goat on a roof',
      title: 'Goat',
      className: 'rounded',
      align: 'left',
      caption: 'Fig 1',
      width: '640',
      height: '480',
    })
  })

  it('ticks decorative when the stored alt is empty', async () => {
    const pending = promptForImage(document, { existing: { src: '/a.png', alt: '' } })
    const form = openForm()
    const decorative = control<HTMLInputElement>(form, 'decorative')
    expect(decorative.checked).toBe(true)
    submit(form)
    expect((await pending)?.alt).toBe('')
  })
})

/**
 * Addresses the editor will not store.
 *
 * `setLink` and `insertImage` decline these too, but a ProseMirror command that
 * declines is silent by design -- it means "not applicable here", and the
 * toolbar has already closed the dialog by the time it returns. Checking in the
 * commit step is what turns a mysterious no-op into a sentence the author can
 * act on, with the offending address still in the field.
 */
describe('an address the editor cannot store', () => {
  const REFUSED = 'That address is not one the editor can store.'

  function errorText(form: HTMLFormElement): string {
    return form.querySelector('.ol-error')?.textContent ?? ''
  }

  function buttonLabelled(form: HTMLFormElement, label: string): HTMLButtonElement {
    const found = Array.from(form.querySelectorAll('button')).find((b) => b.textContent === label)
    if (!found) throw new Error(`no button labelled ${label}`)
    return found
  }

  /** Let the picker promise and both handlers attached to it settle. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('keeps the link dialog open and says why', async () => {
    const pending = promptForLink(document)
    const form = openForm()
    control<HTMLInputElement>(form, 'href').value = 'javascript:alert(document.cookie)'
    submit(form)

    expect(errorText(form)).toBe(REFUSED)
    // Still open, with the address still in view. Closing on refusal would
    // discard the author's typing along with the explanation.
    expect(form.closest('dialog')?.hasAttribute('open')).toBe(true)
    expect(control<HTMLInputElement>(form, 'href').value).toBe('javascript:alert(document.cookie)')

    buttonLabelled(form, 'Cancel').click()
    expect(await pending).toBeNull()
  })

  it('refuses every executable scheme, however it is spelled', async () => {
    const payloads = [
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      '   javascript:alert(1)',
    ]
    for (const href of payloads) {
      const pending = promptForLink(document)
      const form = openForm()
      control<HTMLInputElement>(form, 'href').value = href
      submit(form)
      expect(errorText(form)).toBe(REFUSED)
      buttonLabelled(form, 'Cancel').click()
      expect(await pending).toBeNull()
    }
  })

  it('still resolves for an ordinary address', async () => {
    const pending = promptForLink(document)
    const form = openForm()
    control<HTMLInputElement>(form, 'href').value = 'https://example.org'
    submit(form)
    expect(await pending).toMatchObject({ href: 'https://example.org' })
  })

  it('keeps the image dialog open and says why', async () => {
    const pending = promptForImage(document)
    const form = openForm()
    control<HTMLInputElement>(form, 'src').value = 'javascript:alert(1)'
    control<HTMLInputElement>(form, 'alt').value = 'A chart'
    submit(form)

    expect(errorText(form)).toBe(REFUSED)
    buttonLabelled(form, 'Cancel').click()
    expect(await pending).toBeNull()
  })

  it('still resolves for an ordinary image address', async () => {
    const pending = promptForImage(document)
    const form = openForm()
    control<HTMLInputElement>(form, 'src').value = '/a.png'
    control<HTMLInputElement>(form, 'alt').value = 'A chart'
    submit(form)
    expect(await pending).toMatchObject({ src: '/a.png' })
  })

  // An integrator's file picker was trusted where an integrator's uploader was
  // not -- `runUploader` has refused an unsafe address since it was written.
  it('refuses a link picker that hands back an unstorable address', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerFilePicker(() => Promise.resolve({ url: 'javascript:alert(1)', title: 'Report' }))

    const pending = promptForLink(document, undefined, host)
    const form = openForm()
    buttonLabelled(form, 'Browse files').click()
    await settle()

    expect(errorText(form)).toBe('The file picker returned an address the editor will not store.')
    // The address never reaches the field, so it cannot be submitted by an
    // author who assumes the picker gave them something valid.
    expect(control<HTMLInputElement>(form, 'href').value).toBe('')

    buttonLabelled(form, 'Cancel').click()
    expect(await pending).toBeNull()
    host.remove()
  })

  it('refuses an image picker that hands back an unstorable address', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerFilePicker(() => Promise.resolve({ url: 'javascript:alert(1)', alt: 'x' }))

    const pending = promptForImage(document, { host })
    const form = openForm()
    buttonLabelled(form, 'Browse files').click()
    await settle()

    expect(errorText(form)).toBe('The image picker returned an address the editor will not store.')
    expect(control<HTMLInputElement>(form, 'src').value).toBe('')

    buttonLabelled(form, 'Cancel').click()
    expect(await pending).toBeNull()
    host.remove()
  })

  it('accepts a picker that hands back an ordinary address', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerFilePicker(() => Promise.resolve({ url: '/docs/report.pdf', title: 'Report' }))

    const pending = promptForLink(document, undefined, host)
    const form = openForm()
    buttonLabelled(form, 'Browse files').click()
    await settle()

    expect(errorText(form)).toBe('')
    expect(control<HTMLInputElement>(form, 'href').value).toBe('/docs/report.pdf')

    submit(form)
    expect(await pending).toMatchObject({ href: '/docs/report.pdf' })
    host.remove()
  })
})
