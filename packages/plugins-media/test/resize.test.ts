/**
 * What the media node view puts in the live editor DOM.
 *
 * The node view replaces the schema's own rendering, so anything it forgets to
 * copy across is simply absent while the author is editing -- invisible in a
 * round-trip test, because stored HTML is serialized from the node, not the DOM.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { mediaResizePlugin } from '../src/resize.js'

let view: EditorView | undefined

function render(html: string): string {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [mediaResizePlugin()],
    }),
  })
  return view.dom.innerHTML
}

/**
 * The media element the node view built, not the whole editor DOM.
 *
 * ProseMirror inserts its own `<img class="ProseMirror-separator" alt="">` next
 * to an inline atom, so asserting on the editor's HTML would find that `alt=""`
 * and pass whether or not the node view wrote one.
 */
function mediaIn(html: string): string {
  const dom = render(html)
  const holder = document.createElement('div')
  holder.innerHTML = dom
  const el = holder.querySelector('.ol-media > :first-child')
  if (!el) throw new Error(`no media element rendered in: ${dom}`)
  return el.outerHTML
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

describe('media node views', () => {
  // The node type is `image`, not `img`. Testing the element name stripped every
  // alt attribute, so screen readers lost both descriptions and the deliberate
  // `alt=""` that marks an image decorative.
  it('keeps alt text on an image', () => {
    expect(mediaIn('<p><img src="/a.png" alt="A diagram"></p>')).toContain('alt="A diagram"')
  })

  it('keeps an explicitly decorative empty alt', () => {
    expect(mediaIn('<p><img src="/a.png" alt=""></p>')).toBe('<img src="/a.png" alt="">')
  })

  // Core models <source>/<track> as furniture, so source-only media has no src
  // of its own: without them the player has nothing to play.
  it('renders the stored sources of source-only video', () => {
    const dom = render('<p><video controls><source src="/a.webm" type="video/webm"></video></p>')
    expect(dom).toContain('<source src="/a.webm" type="video/webm">')
  })

  it('renders stored sources alongside a primary src', () => {
    const dom = render('<p><video src="/a.mp4" controls><source src="/a.webm"></video></p>')
    expect(dom).toContain('src="/a.mp4"')
    expect(dom).toContain('<source src="/a.webm">')
  })

  it('renders stored tracks on audio', () => {
    const dom = render('<p><audio controls><source src="/a.ogg"></audio></p>')
    expect(dom).toContain('<source src="/a.ogg">')
  })
})
