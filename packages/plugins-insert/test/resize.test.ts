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
function storedAttr(name: string): string | null {
  let value: string | null = null
  view?.state.doc.descendants((node) => {
    if (node.type.name === 'image') value = (node.attrs[name] as string | null) ?? null
    return true
  })
  return value
}

function storedWidth(): string | null {
  return storedAttr('width')
}

function storedHeight(): string | null {
  return storedAttr('height')
}

/** A PointerEvent jsdom will accept, carrying the properties the drag reads. */
function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  })
  return event
}

function giveImageSize(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => height })
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

/**
 * Do not commit a dimension taken from the broken-image box.
 *
 * jsdom never decodes, so `naturalWidth` stays 0 until a test sets it. That is
 * the loading window: the handle is positioned from `getBoundingClientRect()`
 * of a 0×0 (or ~16–40px broken-icon) box, and the first drag used to store that
 * placeholder width, which then survived once the real bitmap arrived.
 */
describe('resizing before the image has decoded', () => {
  it('withholds the handle while naturalWidth is still 0', () => {
    const handle = renderedHandle('<p><img src="/slow.png" alt="x"></p>')
    expect(handle.hidden).toBe(true)
  })

  it('does not commit a placeholder width from an arrow press', () => {
    const handle = renderedHandle('<p><img src="/slow.png" alt="x"></p>')
    press(handle, 'ArrowRight')
    expect(storedWidth()).toBeNull()
    expect(storedHeight()).toBeNull()
  })

  it('does not commit a placeholder width from a drag', () => {
    const handle = renderedHandle('<p><img src="/slow.png" alt="x"></p>')
    handle.dispatchEvent(pointer('pointerdown', 0))
    window.dispatchEvent(pointer('pointermove', 40))
    window.dispatchEvent(pointer('pointerup', 40))
    expect(storedWidth()).toBeNull()
    expect(storedHeight()).toBeNull()
  })

  it('offers the handle once load reports an intrinsic size, and then writes height', () => {
    const img = renderedImage('<p><img src="/slow.png" alt="x"></p>')
    const handle = view!.dom.querySelector('.ol-img-handle')
    if (!(handle instanceof HTMLButtonElement)) throw new Error('no resize handle rendered')
    expect(handle.hidden).toBe(true)

    giveImageSize(img, 800, 400)
    img.dispatchEvent(new Event('load'))

    expect(handle.hidden).toBe(false)
    press(handle, 'ArrowRight')
    // jsdom has no layout, so the first press starts from 0 and clamps to 16.
    expect(storedWidth()).toBe('16')
    expect(storedHeight()).toBe('8')
  })

  it('swallows a rejected decode and leaves the handle off', async () => {
    const img = renderedImage('<p><img src="/broken.png" alt="x"></p>')
    const handle = view!.dom.querySelector('.ol-img-handle')
    if (!(handle instanceof HTMLButtonElement)) throw new Error('no resize handle rendered')
    let decodeCalled = false
    img.decode = () => {
      decodeCalled = true
      return Promise.reject(new Error('EncodingError'))
    }
    img.dispatchEvent(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()
    expect(decodeCalled).toBe(true)
    expect(handle.hidden).toBe(true)
    press(handle, 'ArrowRight')
    expect(storedWidth()).toBeNull()
  })

  it('does not write through a node view destroyed while the image was loading', () => {
    const img = renderedImage('<p><img src="/slow.png" alt="x"></p>')
    view!.destroy()
    giveImageSize(img, 800, 400)
    expect(() => img.dispatchEvent(new Event('load'))).not.toThrow()
  })
})

/**
 * A cached bitmap can be complete before the node view attaches a listener.
 * Checking `complete` synchronously is what makes the handle appear at all.
 */
describe('a cached image that is already complete', () => {
  const proto = HTMLImageElement.prototype
  const previous = {
    complete: Object.getOwnPropertyDescriptor(proto, 'complete'),
    naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth'),
    naturalHeight: Object.getOwnPropertyDescriptor(proto, 'naturalHeight'),
  }

  afterEach(() => {
    for (const name of ['complete', 'naturalWidth', 'naturalHeight'] as const) {
      const desc = previous[name]
      if (desc) Object.defineProperty(proto, name, desc)
    }
  })

  it('offers the handle without waiting for a load event', () => {
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(proto, 'naturalHeight', { configurable: true, get: () => 400 })
    const handle = renderedHandle('<p><img src="/cached.png" alt="x"></p>')
    expect(handle.hidden).toBe(false)
    press(handle, 'ArrowRight')
    expect(storedWidth()).toBe('16')
    expect(storedHeight()).toBe('8')
  })
})
