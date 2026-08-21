/**
 * What the image node view puts in the live editor DOM.
 *
 * Stored HTML is serialized from the node, not from this DOM, so anything the
 * node view gets wrong here is invisible to a round-trip test and visible to
 * every author.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { imageResizePlugin } from '../src/resize.js'

let view: EditorView | undefined

function renderedHandle(html: string): HTMLButtonElement {
  renderedImage(html)
  const handle = view?.dom.querySelector('.ol-img-handle')
  if (!(handle instanceof HTMLButtonElement)) throw new Error('no resize handle rendered')
  return handle
}

function press(target: Element, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/** What the document says the image is, which is what gets saved. */
function storedWidth(): string | null {
  let width: string | null = null
  view?.state.doc.descendants((node) => {
    if (node.type.name === 'image') width = (node.attrs['width'] as string | null) ?? null
    return true
  })
  return width
}

function renderedImage(html: string): HTMLImageElement {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [imageResizePlugin()],
    }),
  })
  const img = view.dom.querySelector('.ol-img-resize > img')
  if (!(img instanceof HTMLImageElement)) throw new Error(`no image rendered: ${view.dom.innerHTML}`)
  return img
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

describe('image resize node view', () => {
  it('applies a pixel width as the width attribute', () => {
    const img = renderedImage('<p><img src="/a.png" alt="x" width="240"></p>')
    expect(img.getAttribute('width')).toBe('240')
    expect(img.style.width).toBe('')
  })

  // `img.width` is an unsigned long, so Number('50%') is NaN and lands as 0 --
  // collapsing the image instead of rendering it at half the container.
  it('keeps a percentage width instead of collapsing the image', () => {
    const img = renderedImage('<p><img src="/a.png" alt="x" width="50%"></p>')
    // `img.width = NaN` reflects back as width="0", which is the collapse.
    expect(img.getAttribute('width')).not.toBe('0')
    expect(img.style.width).toBe('50%')
  })

  it('keeps a percentage height the same way', () => {
    const img = renderedImage('<p><img src="/a.png" alt="x" height="25%"></p>')
    expect(img.getAttribute('height')).not.toBe('0')
    expect(img.style.height).toBe('25%')
  })

  it('sets no dimension when the node carries none', () => {
    const img = renderedImage('<p><img src="/a.png" alt="x"></p>')
    expect(img.hasAttribute('width')).toBe(false)
    expect(img.style.width).toBe('')
  })
})

/*
 * The handle was a real <button> with an aria-label and a single `pointerdown`
 * listener: focusable, announced as a control, and inert to every key. Image
 * resizing was mouse-only while advertising otherwise, which is worse than not
 * offering it -- a keyboard author has no way to find out that the thing they
 * just tabbed to does nothing.
 */
describe('resizing by keyboard', () => {
  it('is a slider, not a button that lies about being one', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="240"></p>')
    expect(handle.getAttribute('role')).toBe('slider')
    expect(handle.getAttribute('aria-valuenow')).toBe('240')
    expect(handle.getAttribute('aria-valuemin')).toBe('16')
    // The width is announced on every change by the role itself, so no live
    // region races it saying the same thing a beat later.
    expect(handle.getAttribute('aria-valuetext')).toBe('240 pixels')
  })

  it('grows and shrinks on the arrow keys', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="240"></p>')
    press(handle, 'ArrowRight')
    expect(storedWidth()).toBe('250')
    press(handle, 'ArrowLeft')
    press(handle, 'ArrowLeft')
    expect(storedWidth()).toBe('230')
    // Up and Down do the same job, because "bigger" has no agreed axis.
    press(handle, 'ArrowUp')
    expect(storedWidth()).toBe('240')
  })

  it('takes a bigger step with Shift, and clamps at the bottom with Home', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="240"></p>')
    press(handle, 'ArrowRight', true)
    expect(storedWidth()).toBe('290')
    press(handle, 'Home')
    // Never to zero: an image narrower than this is a dot the pointer cannot
    // grab again.
    expect(storedWidth()).toBe('16')
  })

  it('keeps the announced value in step with the document', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="240"></p>')
    press(handle, 'ArrowRight')
    expect(handle.getAttribute('aria-valuenow')).toBe('250')
    expect(handle.getAttribute('aria-valuetext')).toBe('250 pixels')
  })

  it('announces a percentage width as a percentage', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="50%"></p>')
    expect(handle.getAttribute('aria-valuetext')).toBe('50%')
  })

  it('keeps the arrow key from also moving the caret out of the image', () => {
    const handle = renderedHandle('<p><img src="/a.png" alt="x" width="240"></p>')
    const event = press(handle, 'ArrowRight')
    expect(event.defaultPrevented).toBe(true)
  })
})
