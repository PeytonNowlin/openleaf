/**
 * The media dialog's shape, not its behaviour in a real browser.
 *
 * jsdom has no `<dialog>` modality, so `showModal` and `close` are shimmed here.
 * That is enough to check which fields the form offers and what a submission
 * resolves to; focus handling, the backdrop and Escape belong in Playwright.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { promptForMedia } from '../src/dialog.js'

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

// A dialog left open by a test that never submits would still be in the document
// for the next one, which would then read the stale form.
afterEach(() => {
  for (const dialog of Array.from(document.querySelectorAll('dialog'))) dialog.remove()
})

function openForm(): HTMLFormElement {
  const form = document.querySelector('dialog form')
  if (!(form instanceof HTMLFormElement)) throw new Error('no dialog form was opened')
  return form
}

function field(form: HTMLFormElement, name: string): HTMLElement | null {
  return form.elements.namedItem(name) as HTMLElement | null
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('promptForMedia', () => {
  // Without a kind field the dialog could only ever produce video, which left
  // the audio node type unreachable from the toolbar.
  it('offers a choice between video and audio when the caller pins neither', () => {
    const pending = promptForMedia(document)
    const kind = field(openForm(), 'kind')
    expect(kind).toBeInstanceOf(HTMLSelectElement)
    expect(Array.from((kind as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      'video',
      'audio',
    ])
    void pending
  })

  it('resolves as audio when audio is chosen', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    ;(field(form, 'kind') as HTMLSelectElement).value = 'audio'
    ;(field(form, 'src') as HTMLInputElement).value = '/track.mp3'
    submit(form)
    const result = await pending
    expect(result?.kind).toBe('audio')
    expect(result?.src).toBe('/track.mp3')
  })

  it('defaults to video when the choice is left alone', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    ;(field(form, 'src') as HTMLInputElement).value = '/clip.mp4'
    submit(form)
    expect((await pending)?.kind).toBe('video')
  })

  // Audio elements have no poster frame. The field is on the form because the
  // kind is chosen there too, so the commit step has to drop it.
  it('drops a poster frame when audio is chosen', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    ;(field(form, 'kind') as HTMLSelectElement).value = 'audio'
    ;(field(form, 'src') as HTMLInputElement).value = '/track.mp3'
    ;(field(form, 'poster') as HTMLInputElement).value = '/still.jpg'
    submit(form)
    expect((await pending)?.poster).toBe(null)
  })

  it('omits the choice when the caller pins the kind', async () => {
    const pending = promptForMedia(document, { kind: 'audio' })
    const form = openForm()
    expect(field(form, 'kind')).toBe(null)
    expect(field(form, 'poster')).toBe(null)
    ;(field(form, 'src') as HTMLInputElement).value = '/track.mp3'
    submit(form)
    expect((await pending)?.kind).toBe('audio')
  })

  it('reports a missing address rather than resolving', () => {
    const pending = promptForMedia(document)
    const form = openForm()
    submit(form)
    expect(form.querySelector('.ol-error')?.textContent).toContain('Enter an address')
    void pending
  })
})
