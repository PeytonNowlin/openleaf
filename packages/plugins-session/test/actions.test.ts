/**
 * What Save reports back.
 *
 * The answer is not cosmetic: the caller drops the recovery draft and stops
 * warning about unsaved changes when Save reports success, so claiming success
 * for a submission the browser refused loses the author's work.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { registerSaveHandler, saveDocument, type EditorHost } from '../src/actions.js'

function harness(options: { required?: boolean } = {}): EditorHost {
  document.body.innerHTML = `
    <form id="f" method="post" action="/save">
      <input name="title" ${options.required === true ? 'required' : ''} value="">
      <textarea id="body" name="body"></textarea>
      <button type="submit">Save</button>
    </form>`
  const host = document.createElement('openleaf-editor') as EditorHost
  host.setAttribute('for', 'body')
  Object.defineProperty(host, 'value', { value: '<p>edited</p>', writable: true })
  Object.defineProperty(host, 'view', { value: null, writable: true })
  document.getElementById('f')?.prepend(host)
  return host
}

afterEach(() => {
  registerSaveHandler(null)
  document.body.innerHTML = ''
})

describe('saveDocument', () => {
  it('keeps recovery when the bound form submission is intercepted', async () => {
    const host = harness()
    let submitted = false
    document.getElementById('f')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })
    expect(await saveDocument(host)).toBe(false)
    expect(submitted).toBe(true)
  })

  // requestSubmit() runs constraint validation and returns quietly, so the only
  // signal that nothing went out is the submit event never firing.
  it('reports failure when the form fails validation', async () => {
    const host = harness({ required: true })
    let submitted = false
    document.getElementById('f')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })
    expect(await saveDocument(host)).toBe(false)
    expect(submitted).toBe(false)
  })

  it('keeps recovery after a valid submission is intercepted', async () => {
    const host = harness({ required: true })
    document.getElementById('f')?.addEventListener('submit', (event) => event.preventDefault())
    const title = document.querySelector('input[name="title"]') as HTMLInputElement
    title.value = 'a title'
    expect(await saveDocument(host)).toBe(false)
  })

  // Taking ownership of persistence is not evidence that persistence succeeded.
  it('keeps recovery when a listener cancels without acknowledging persistence', async () => {
    const host = harness()
    let seen = ''
    host.addEventListener('openleaf:save', (event) => {
      event.preventDefault()
      seen = (event as CustomEvent<{ html: string }>).detail.html
    })
    expect(await saveDocument(host)).toBe(false)
    expect(seen).toBe('<p>edited</p>')
  })

  it('awaits a registered save handler', async () => {
    const host = harness()
    let got = ''
    registerSaveHandler(async (html) => {
      await Promise.resolve()
      got = html
    })
    expect(await saveDocument(host)).toBe(true)
    expect(got).toBe('<p>edited</p>')
  })

  it('reports failure with nothing to save to', async () => {
    document.body.innerHTML = ''
    const host = document.createElement('openleaf-editor') as EditorHost
    Object.defineProperty(host, 'value', { value: '<p>edited</p>', writable: true })
    Object.defineProperty(host, 'view', { value: null, writable: true })
    document.body.append(host)
    expect(await saveDocument(host)).toBe(false)
  })
})


it('waits for the event listener to acknowledge persistence', async () => {
  const host = harness()
  let complete: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { complete = resolve })
  host.addEventListener('openleaf:save', (event) => {
    const detail = (event as CustomEvent<{ waitUntil: (save: Promise<void>) => void }>).detail
    detail.waitUntil(pending)
  })
  let finished = false
  const saved = saveDocument(host).then((result) => { finished = true; return result })
  await Promise.resolve()
  expect(finished).toBe(false)
  complete?.()
  expect(await saved).toBe(true)
})
