/**
 * The insert-media dialog.
 *
 * The old prompt offered an address and a title, so the multi-source and
 * source-only shapes core round-trips were unreachable from the UI. These tests
 * pin what the form offers and what a submission resolves to; as with the other
 * dialog tests, jsdom has no `<dialog>` modality, so focus, the backdrop and
 * Escape belong in Playwright.
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

afterEach(() => {
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

function type(form: HTMLFormElement, name: string, value: string): void {
  control<HTMLInputElement>(form, name).value = value
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** The message the dialog is currently showing, if any. */
function errorText(form: HTMLFormElement): string {
  return form.closest('dialog')?.querySelector('[role="alert"]')?.textContent ?? ''
}

describe('promptForMedia', () => {
  it('offers the fields the format actually needs', () => {
    void promptForMedia(document)
    const form = openForm()
    for (const name of ['src', 'title', 'poster', 'width', 'height', 'alt0', 'altType0', 'alt1', 'altType1']) {
      expect(control(form, name)).toBeDefined()
    }
  })

  it('resolves a plain address', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    submit(form)
    const result = await pending
    expect(result?.src).toBe('/v.mp4')
    expect(result?.sources).toEqual([])
  })

  it('collects the alternative sources and their types', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    type(form, 'alt0', '/v.webm')
    type(form, 'altType0', 'video/webm')
    type(form, 'alt1', '/v.ogv')
    submit(form)
    expect((await pending)?.sources).toEqual([
      { src: '/v.webm', type: 'video/webm' },
      { src: '/v.ogv', type: null },
    ])
  })

  it('accepts alternatives with no main address, which is the source-only shape', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'alt0', '/only.webm')
    submit(form)
    const result = await pending
    expect(result?.src).toBe('')
    expect(result?.sources).toEqual([{ src: '/only.webm', type: null }])
  })

  it('refuses a player with nothing to play, and says so', async () => {
    void promptForMedia(document)
    const form = openForm()
    submit(form)
    expect(errorText(form)).toContain('address')
    expect(form.closest('dialog')?.hasAttribute('open')).toBe(true)
  })

  it('refuses an unsafe address', async () => {
    void promptForMedia(document)
    const form = openForm()
    type(form, 'src', 'javascript:alert(1)')
    submit(form)
    expect(errorText(form)).not.toBe('')
    expect(form.closest('dialog')?.hasAttribute('open')).toBe(true)
  })

  it('refuses an unsafe alternative rather than dropping it silently', async () => {
    void promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    type(form, 'alt0', 'javascript:alert(1)')
    submit(form)
    expect(errorText(form)).not.toBe('')
  })

  it('refuses an unsafe poster', async () => {
    void promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    type(form, 'poster', 'javascript:alert(1)')
    submit(form)
    expect(errorText(form)).not.toBe('')
  })

  it('skips a blank alternative row instead of storing an empty source', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    type(form, 'alt1', '/second.webm')
    submit(form)
    expect((await pending)?.sources).toEqual([{ src: '/second.webm', type: null }])
  })

  it('trims what the author typed', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'src', '  /v.mp4  ')
    type(form, 'alt0', '  /v.webm  ')
    submit(form)
    const result = await pending
    expect(result?.src).toBe('/v.mp4')
    expect(result?.sources).toEqual([{ src: '/v.webm', type: null }])
  })

  it('returns the dimensions and title, and null for what was left blank', async () => {
    const pending = promptForMedia(document)
    const form = openForm()
    type(form, 'src', '/v.mp4')
    type(form, 'width', '640')
    submit(form)
    const result = await pending
    expect(result?.width).toBe('640')
    expect(result?.height).toBeNull()
    expect(result?.title).toBeNull()
    expect(result?.poster).toBeNull()
  })
})

describe('promptForMedia when editing', () => {
  it('prefills every field from the existing player', () => {
    void promptForMedia(document, {
      existing: {
        src: '/v.mp4',
        title: 'Clip',
        poster: '/p.jpg',
        width: '640',
        height: '360',
        sources: [{ src: '/v.webm', type: 'video/webm' }],
      },
    })
    const form = openForm()
    expect(control<HTMLInputElement>(form, 'src').value).toBe('/v.mp4')
    expect(control<HTMLInputElement>(form, 'title').value).toBe('Clip')
    expect(control<HTMLInputElement>(form, 'poster').value).toBe('/p.jpg')
    expect(control<HTMLInputElement>(form, 'width').value).toBe('640')
    expect(control<HTMLInputElement>(form, 'height').value).toBe('360')
    expect(control<HTMLInputElement>(form, 'alt0').value).toBe('/v.webm')
    expect(control<HTMLInputElement>(form, 'altType0').value).toBe('video/webm')
  })

  it('says it is editing rather than inserting', () => {
    void promptForMedia(document, { existing: { src: '/v.mp4' } })
    expect(document.querySelector('dialog h2')?.textContent).toBe('Edit media')
    document.querySelector('dialog')?.remove()
    void promptForMedia(document)
    expect(document.querySelector('dialog h2')?.textContent).toBe('Insert media')
  })

  it('lets the author clear an alternative source', async () => {
    const pending = promptForMedia(document, {
      existing: { src: '/v.mp4', sources: [{ src: '/v.webm', type: null }] },
    })
    const form = openForm()
    type(form, 'alt0', '')
    submit(form)
    expect((await pending)?.sources).toEqual([])
  })
})

/**
 * A player with more encodings than the form has spare rows.
 *
 * What this form returns is what replaces the stored sources, so a fixed row
 * count was a cap on the document rather than on the form: the third and later
 * encodings of an existing player were deleted by a save made to change its
 * title.
 */
describe('promptForMedia with more sources than spare rows', () => {
  const three = [
    { src: '/a.webm', type: 'video/webm' },
    { src: '/b.mp4', type: 'video/mp4' },
    { src: '/c.ogv', type: null },
  ]

  it('gives every existing source a row', () => {
    void promptForMedia(document, { existing: { src: '/v.mp4', sources: three } })
    const form = openForm()
    expect(control<HTMLInputElement>(form, 'alt0').value).toBe('/a.webm')
    expect(control<HTMLInputElement>(form, 'alt1').value).toBe('/b.mp4')
    expect(control<HTMLInputElement>(form, 'alt2').value).toBe('/c.ogv')
  })

  it('still offers spare rows beyond what is there', () => {
    void promptForMedia(document, { existing: { src: '/v.mp4', sources: three } })
    const form = openForm()
    expect(control<HTMLInputElement>(form, 'alt3').value).toBe('')
    expect(control<HTMLInputElement>(form, 'alt4').value).toBe('')
  })

  it('returns all of them unchanged when the author edits something else', () => {
    const pending = promptForMedia(document, { existing: { src: '/v.mp4', sources: three } })
    const form = openForm()
    type(form, 'title', 'A new title')
    submit(form)
    return pending.then((result) => {
      expect(result?.sources).toEqual(three)
      expect(result?.title).toBe('A new title')
    })
  })

  it('lets the author add a fourth in a spare row', async () => {
    const pending = promptForMedia(document, { existing: { src: '/v.mp4', sources: three } })
    const form = openForm()
    type(form, 'alt3', '/d.mov')
    submit(form)
    expect((await pending)?.sources).toHaveLength(4)
  })
})

describe('promptForMedia when editing an embed', () => {
  it('accepts a watch page and hands back the converted address', async () => {
    const pending = promptForMedia(document, {
      existing: { kind: 'iframe', src: 'https://www.youtube.com/embed/aaa' },
    })
    const form = openForm()
    type(form, 'src', 'https://www.youtube.com/watch?v=bbb')
    submit(form)
    expect((await pending)?.src).toBe('https://www.youtube.com/watch?v=bbb')
  })

  it('refuses an address that cannot be embedded, and stays open to say so', () => {
    void promptForMedia(document, {
      existing: { kind: 'iframe', src: 'https://www.youtube.com/embed/aaa' },
    })
    const form = openForm()
    type(form, 'src', 'https://evil.example/video')
    submit(form)
    // Previously this passed the generic URL check, closed, and then the update
    // command declined -- a save that silently did nothing.
    expect(errorText(form)).toContain('embed')
    expect(form.closest('dialog')?.hasAttribute('open')).toBe(true)
  })

  it('does not hold a video to the embed allowlist', async () => {
    const pending = promptForMedia(document, { existing: { kind: 'video', src: '/v.mp4' } })
    const form = openForm()
    type(form, 'src', '/other.mp4')
    submit(form)
    expect((await pending)?.src).toBe('/other.mp4')
  })
})
