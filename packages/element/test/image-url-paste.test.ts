/**
 * Pasting a bare image URL (#168).
 *
 * File pastes stay on the uploader path. This is the image dialog's
 * address field, for a clipboard that has no file. Non-image URLs must
 * not be claimed, so today's link/plain paste remains exactly today's.
 */

import { Slice } from 'prosemirror-model'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

const live: OpenLeafEditor[] = []

afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

function mount(): OpenLeafEditor {
  const el = document.createElement('openleaf-editor') as OpenLeafEditor
  el.setAttribute('toolbar', 'none')
  document.body.append(el)
  live.push(el)
  el.value = '<p></p>'
  return el
}

function pasteText(el: OpenLeafEditor, text: string): boolean {
  const view = el.view
  if (!view) throw new Error('no view')
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const transfer = {
    files: [],
    types: ['text/plain'],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  }
  Object.defineProperty(event, 'clipboardData', { value: transfer })
  return (
    view.someProp('handlePaste', (fn) => fn(view, event as ClipboardEvent, Slice.empty)) === true
  )
}

describe('pasting a bare image URL', () => {
  it('inserts an image with that src, without an uploader', () => {
    const el = mount()
    const claimed = pasteText(el, 'https://cdn.example/hero.png')
    expect(claimed).toBe(true)
    expect(el.value).toContain('<img')
    expect(el.value).toContain('src="https://cdn.example/hero.png"')
    expect(el.value).not.toContain('alt=')
  })

  it('keeps a query string on a URL whose path looks like an image', () => {
    const el = mount()
    const src = 'https://cdn.example/hero.png?w=800'
    expect(pasteText(el, src)).toBe(true)
    expect(el.value).toContain(`src="${src}"`)
  })

  it('still inserts when an uploader is registered: there is nothing to upload', () => {
    const el = mount()
    let called = 0
    el.imageUploader = async () => {
      called += 1
      return { src: 'https://example.com/uploaded.png' }
    }
    expect(pasteText(el, 'https://cdn.example/hero.jpg')).toBe(true)
    expect(called).toBe(0)
    expect(el.value).toContain('src="https://cdn.example/hero.jpg"')
  })

  it('does not claim a non-image URL, so today\'s paste remains today\'s', () => {
    const el = mount()
    const before = el.value
    expect(pasteText(el, 'https://example.org/a')).toBe(false)
    expect(el.value).toBe(before)
    expect(el.value).not.toContain('<img')
  })

  it('does not treat an extensionless CDN URL as an image', () => {
    const el = mount()
    expect(pasteText(el, 'https://cdn.example/hero')).toBe(false)
    expect(el.value).not.toContain('<img')
  })

  it('does not treat an SVG URL as an image', () => {
    const el = mount()
    expect(pasteText(el, 'https://cdn.example/hero.svg')).toBe(false)
    expect(el.value).not.toContain('<img')
  })

  it('declines a javascript: URL even if the path looks like an image', () => {
    const el = mount()
    expect(pasteText(el, 'javascript:alert(1)//.png')).toBe(false)
    expect(el.value).not.toContain('<img')
  })

  it('does not claim a sentence that happens to contain an image URL', () => {
    const el = mount()
    expect(pasteText(el, 'see https://cdn.example/hero.png please')).toBe(false)
    expect(el.value).not.toContain('<img')
  })
})
