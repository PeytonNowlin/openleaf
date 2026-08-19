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
