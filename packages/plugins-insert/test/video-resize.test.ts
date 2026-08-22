/**
 * What the video node view puts in the live editor DOM.
 *
 * Video got a handle by generalising the image one rather than by adding a
 * second plugin: `nodeViews` is a map keyed by node name, so two plugins each
 * claiming `image` do not compose -- the later registration wins, and which one
 * that is depends on install order. These tests pin the parts of the shared
 * machinery that differ by kind, and the parts that must not.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { mediaResizePlugin } from '../src/resize.js'

let view: EditorView | undefined

function render(html: string): HTMLElement {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [mediaResizePlugin()],
    }),
  })
  return view.dom
}

function renderedVideo(html: string): HTMLVideoElement {
  const el = render(html).querySelector('.ol-img-resize > video')
  if (!(el instanceof HTMLVideoElement)) throw new Error(`no video rendered: ${view?.dom.innerHTML}`)
  return el
}

function handleFor(html: string): HTMLButtonElement {
  render(html)
  const handle = view?.dom.querySelector('.ol-img-handle')
  if (!(handle instanceof HTMLButtonElement)) throw new Error('no resize handle rendered')
  return handle
}

function press(target: Element, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/** What the document says, which is what gets saved. */
function storedAttr(kind: string, name: string): string | null {
  let found: string | null = null
  view?.state.doc.descendants((node) => {
    if (node.type.name === kind) found = (node.attrs[name] as string | null) ?? null
    return true
  })
  return found
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

describe('video resize node view', () => {
  it('renders a video with a handle beside it', () => {
    const el = renderedVideo('<video src="/v.mp4" controls></video>')
    expect(el.getAttribute('src')).toBe('/v.mp4')
    expect(el.parentElement?.querySelector('.ol-img-handle')).not.toBeNull()
  })

  it('labels the handle for video, not for image', () => {
    expect(handleFor('<video src="/v.mp4" controls></video>').getAttribute('aria-label')).toBe(
      'Video width',
    )
    expect(handleFor('<p><img src="/a.png" alt="x"></p>').getAttribute('aria-label')).toBe(
      'Image width',
    )
  })

  it('applies a pixel width as the width attribute', () => {
    const el = renderedVideo('<video src="/v.mp4" width="640" controls></video>')
    expect(el.getAttribute('width')).toBe('640')
    expect(el.style.width).toBe('')
  })

  it('keeps a percentage width on the style instead of collapsing', () => {
    const el = renderedVideo('<video src="/v.mp4" width="50%" controls></video>')
    expect(el.getAttribute('width')).not.toBe('0')
    expect(el.style.width).toBe('50%')
  })

  it('rebuilds the source children from the stored furniture', () => {
    const el = renderedVideo(
      '<video controls><source src="/a.webm" type="video/webm"><source src="/a.mp4"></video>',
    )
    const sources = Array.from(el.querySelectorAll('source'))
    expect(sources.map((s) => s.getAttribute('src'))).toEqual(['/a.webm', '/a.mp4'])
    expect(sources[0]!.getAttribute('type')).toBe('video/webm')
  })

  it('shows the poster frame', () => {
    const el = renderedVideo('<video src="/v.mp4" poster="/p.jpg" controls></video>')
    expect(el.getAttribute('poster')).toBe('/p.jpg')
  })

  it('renders a preview rather than a working player, so the node can be selected', () => {
    // A `<video controls>` handles pointer events in its native chrome, and
    // Firefox handles them for the whole element -- no listener in the editor
    // ever fires, so ProseMirror never makes a NodeSelection and the player
    // could be inserted and then never edited again.
    const el = renderedVideo('<video controls><source src="/a.mp4"></video>')
    expect(el.controls).toBe(false)
  })

  it('leaves what the document says about controls alone', () => {
    // Stored HTML is serialized from the node, not from this DOM.
    renderedVideo('<video controls><source src="/a.mp4"></video>')
    expect(view!.state.doc.firstChild?.attrs['controls']).toBe(true)
  })

  it('resizes the document on an arrow press', () => {
    const handle = handleFor('<video src="/v.mp4" width="640" controls></video>')
    const event = press(handle, 'ArrowRight')
    expect(event.defaultPrevented).toBe(true)
    expect(storedAttr('video', 'width')).toBe('650')
  })

  it('takes a bigger step with shift held', () => {
    const handle = handleFor('<video src="/v.mp4" width="640" controls></video>')
    press(handle, 'ArrowRight', true)
    expect(storedAttr('video', 'width')).toBe('690')
  })

  it('does not shrink below the minimum a pointer can hit again', () => {
    const handle = handleFor('<video src="/v.mp4" width="20" controls></video>')
    press(handle, 'Home')
    expect(Number(storedAttr('video', 'width'))).toBeGreaterThanOrEqual(16)
  })

  it('leaves height alone when the video has not reported its metadata', () => {
    // jsdom never loads media, so videoWidth/videoHeight are 0 and there is no
    // ratio to keep. Guessing one would squash the frame once it arrived.
    const handle = handleFor('<video src="/v.mp4" width="640" controls></video>')
    press(handle, 'ArrowRight')
    expect(storedAttr('video', 'height')).toBeNull()
  })

  it('stops the arrow key from also moving the caret out of the video', () => {
    // Asserted by watching an ancestor rather than by reading `cancelBubble`:
    // what matters is that the editor never sees the key, and not-arriving is
    // the thing to test.
    const handle = handleFor('<video src="/v.mp4" width="640" controls></video>')
    let reachedEditor = false
    view!.dom.addEventListener('keydown', () => {
      reachedEditor = true
    })
    press(handle, 'ArrowRight')
    expect(reachedEditor).toBe(false)
  })
})

describe('audio', () => {
  it('gets no resize handle, because its spec declares no box', () => {
    const dom = render('<audio src="/a.mp3" controls></audio>')
    expect(dom.querySelector('.ol-img-handle')).toBeNull()
  })
})

/**
 * The editor mounted in another document.
 *
 * `instanceof HTMLVideoElement` is false across realms: an editor inside an
 * iframe builds its elements from that document, so they are instances of the
 * iframe's constructor and not this window's. Every video was therefore taken
 * for an image -- no poster, no `<source>` children, and a source-only player
 * rendering blank.
 */
describe('a video built in another document', () => {
  it('is still recognised as a video', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const inner = frame.contentDocument
    if (!inner) throw new Error('the iframe has no document')
    const place = inner.createElement('div')
    inner.body.append(place)

    const view = new EditorView(place, {
      state: EditorState.create({
        doc: parseHtml('<video poster="/p.jpg" controls><source src="/a.webm"></video>', {
          schema: coreSchema(),
        }),
        plugins: [mediaResizePlugin()],
      }),
    })
    try {
      const el = view.dom.querySelector('video')
      expect(el).not.toBeNull()
      // The image branch would have set neither of these.
      expect(el!.getAttribute('poster')).toBe('/p.jpg')
      expect(el!.querySelectorAll('source')).toHaveLength(1)
      expect(view.dom.querySelector('.ol-img-handle')?.getAttribute('aria-label')).toBe('Video width')
    } finally {
      view.destroy()
      frame.remove()
    }
  })
})

/**
 * The resize handle under `readonly`.
 *
 * The handle is a real button inside a node view, so it is outside ProseMirror's
 * `editable` gate for the same reason the table context menu is -- and a
 * read-only document could be resized with the arrow keys. Confirmed before it
 * was fixed: an ArrowRight on a `width="640"` image stored 650.
 */
describe('readonly', () => {
  function renderReadonly(html: string): EditorView {
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, {
      editable: () => false,
      state: EditorState.create({
        doc: parseHtml(html, { schema: coreSchema() }),
        plugins: [mediaResizePlugin()],
      }),
    })
    return view
  }

  const IMAGE = '<p>a</p><img src="/a.png" alt="x" width="640">'

  it('refuses an arrow press', () => {
    const editor = renderReadonly(IMAGE)
    const handle = editor.dom.querySelector('.ol-img-handle')!
    press(handle, 'ArrowRight')
    expect(storedAttr('image', 'width')).toBe('640')
  })

  it('refuses to start a drag', () => {
    const editor = renderReadonly(IMAGE)
    const handle = editor.dom.querySelector('.ol-img-handle')!
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    handle.dispatchEvent(down)
    // Not even a preview: the drag never begins, so there is nothing to commit.
    expect(down.defaultPrevented).toBe(false)
    expect(storedAttr('image', 'width')).toBe('640')
  })

  it('says so, rather than being a control that silently does nothing', () => {
    const editor = renderReadonly(IMAGE)
    expect(editor.dom.querySelector('.ol-img-handle')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('is available again when readonly is lifted after mount', () => {
    // A node view's `update` runs when its NODE changes, and editability
    // changing is not that -- so the plugin watches for the transition.
    const editor = renderReadonly(IMAGE)
    const handle = editor.dom.querySelector('.ol-img-handle')!
    editor.setProps({ editable: () => true })
    expect(handle.getAttribute('aria-disabled')).toBe('false')
    press(handle, 'ArrowRight')
    expect(storedAttr('image', 'width')).toBe('650')
  })

  it('goes unavailable when readonly arrives after mount', () => {
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, {
      state: EditorState.create({
        doc: parseHtml(IMAGE, { schema: coreSchema() }),
        plugins: [mediaResizePlugin()],
      }),
    })
    const handle = view.dom.querySelector('.ol-img-handle')!
    expect(handle.getAttribute('aria-disabled')).toBe('false')
    view.setProps({ editable: () => false })
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    press(handle, 'ArrowRight')
    expect(storedAttr('image', 'width')).toBe('640')
  })
})
