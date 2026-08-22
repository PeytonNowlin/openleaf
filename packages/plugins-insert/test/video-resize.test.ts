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
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
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

/** Where the video sits, rather than a hand-counted offset that a fixture edit breaks. */
function videoPos(): number {
  let found: number | null = null
  view!.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === 'video') found = pos
    return true
  })
  if (found === null) throw new Error('no video in the document')
  return found
}

/** Select the video as a node, the way a click on it would. */
function selectTheVideo(): void {
  view!.dispatch(view!.state.tr.setSelection(NodeSelection.create(view!.state.doc, videoPos())))
}

/** Move the selection off the media node, the way a click elsewhere would. */
function selectTextAt(pos: number): void {
  view!.dispatch(view!.state.tr.setSelection(TextSelection.create(view!.state.doc, pos)))
}

function playButton(): HTMLButtonElement {
  const el = view?.dom.querySelector('.ol-media-play')
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no play control: ${view?.dom.innerHTML}`)
  return el
}

/**
 * Stand in for playback, which jsdom does not have.
 *
 * Calling play() or pause() on a jsdom media element logs a "not implemented"
 * error through the virtual console, so stubbing keeps the output honest -- and
 * it makes the calls assertable, which is the part that matters: releasing a
 * live player has to pause it, because once the element is inert again there is
 * no control left to stop it with.
 */
function stubPlayback(el: HTMLVideoElement): { play: Mock; pause: Mock } {
  const play = vi.fn(() => Promise.resolve())
  const pause = vi.fn()
  Object.assign(el, { play, pause })
  return { play, pause }
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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

/**
 * Click-to-activate.
 *
 * The inert preview is what makes a video selectable, so it has to stay the
 * default -- but an author still has to be able to play a clip without leaving
 * the editor. One explicit gesture hands a single element its own pointer events
 * back, for as long as it stays selected.
 *
 * jsdom has no playback, which is exactly why these tests are about the DOM
 * state rather than about whether anything plays: what the engines disagree
 * about is pointer routing, and `media.spec.ts` covers that in real browsers.
 */
describe('activating the player', () => {
  /*
   * A paragraph in front of the player, deliberately.
   *
   * ProseMirror calls `selectNode` when the selection *changes* to the node, and
   * `Selection.atStart` of a document whose first block is an atom is already a
   * `NodeSelection` on it -- so in that shape nothing ever changes, and
   * ProseMirror draws no selection ring of its own either. Following its
   * contract rather than second-guessing it keeps the two consistent.
   */
  const CLIP = '<p>Alpha.</p><video src="/v.mp4" width="640" controls></video>'

  it('offers no play control until the node is selected', () => {
    render(CLIP)
    expect(playButton().hidden).toBe(true)
  })

  it('offers one once the node is selected, and still shows a preview', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    expect(playButton().hidden).toBe(false)
    // Selecting is not activating: the first click has to be able to select.
    expect(el.controls).toBe(false)
    expect(el.parentElement?.classList.contains('ol-media-live')).toBe(false)
  })

  it('hands the element its controls and its pointer events on the gesture', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    expect(el.controls).toBe(true)
    expect(playback.play).toHaveBeenCalled()
    // The CSS that lifts `pointer-events: none` keys off this class.
    expect(el.parentElement?.classList.contains('ol-media-live')).toBe(true)
    // Nothing left to click: the native control bar is the interface now.
    expect(playButton().hidden).toBe(true)
  })

  it('takes them back when the selection moves away', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    expect(el.controls).toBe(true)
    selectTextAt(1)
    expect(el.controls).toBe(false)
    expect(playback.pause).toHaveBeenCalled()
    expect(el.parentElement?.classList.contains('ol-media-live')).toBe(false)
    expect(playButton().hidden).toBe(true)
  })

  it('takes them back on Escape, and keeps the node selected', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    press(el, 'Escape')
    expect(el.controls).toBe(false)
    // Still selected, so the toolbar can still edit it -- and the gesture is
    // there to be repeated.
    expect(view!.state.selection).toBeInstanceOf(NodeSelection)
    expect(playButton().hidden).toBe(false)
  })

  it('can be activated again after being released', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    press(el, 'Escape')
    click(playButton())
    expect(el.controls).toBe(true)
  })

  it('keeps the resize handle working while the player is live', () => {
    // The handle is a sibling of the element rather than a child, which is what
    // lets it keep working in both states.
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    const handle = view!.dom.querySelector('.ol-img-handle')!
    press(handle, 'ArrowRight')
    expect(storedAttr('video', 'width')).toBe('650')
    // And the resize did not quietly put the preview back.
    expect(el.controls).toBe(true)
  })

  it('does not rewrite the address on an unrelated update, which would rewind it', () => {
    const el = renderedVideo(CLIP)
    const playback = stubPlayback(el)
    selectTheVideo()
    click(playButton())
    // Setting `src` runs the media load algorithm even for the same value, so a
    // resize would restart the clip the author is watching.
    const setAttribute = vi.spyOn(el, 'setAttribute')
    press(view!.dom.querySelector('.ol-img-handle')!, 'ArrowRight')
    expect(setAttribute.mock.calls.map(([name]) => name)).not.toContain('src')
  })

  /*
   * Captions, and the same argument as `src` one test up.
   *
   * The `<source>` and `<track>` children are rebuilt from the node's
   * `furniture` string, and that rebuild used to run on every node update. A new
   * `<track>` element means a new `TextTrack`, whose `mode` starts `disabled` --
   * so an author who turned captions on and then resized the player they were
   * watching had them silently turned back off. jsdom builds no `TextTrack` from
   * a `<track>` at all, so what is asserted here is the element identity that
   * the track's state hangs off, which is the mechanism rather than a proxy for
   * it.
   */
  const CAPTIONED =
    '<p>Alpha.</p><video src="/v.mp4" width="640" controls>' +
    '<track kind="captions" src="/c.vtt" srclang="en" label="English"></video>'

  it('keeps the caption tracks it already built when an update leaves them alone', () => {
    const el = renderedVideo(CAPTIONED)
    stubPlayback(el)
    const before = el.querySelector('track')
    expect(before).not.toBeNull()
    selectTheVideo()
    click(playButton())
    press(view!.dom.querySelector('.ol-img-handle')!, 'ArrowRight')
    expect(el.querySelector('track')).toBe(before)
  })

  it('still rebuilds them when the furniture really changes', () => {
    // The reason the rebuild exists: a dialog that removes a source has to
    // remove it from the live DOM too. Skipping the no-op rebuild must not cost
    // that.
    const el = renderedVideo(CAPTIONED)
    stubPlayback(el)
    const pos = videoPos()
    const node = view!.state.doc.nodeAt(pos)!
    view!.dispatch(
      view!.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        furniture: '<track kind="captions" src="/de.vtt" srclang="de" label="Deutsch">',
      }),
    )
    expect(el.querySelector('track')?.getAttribute('srclang')).toBe('de')
  })

  it('keeps ProseMirror out of the live player events, and only then', () => {
    // ProseMirror's own mousedown handling calls preventDefault() on a selectable
    // atom, which stops a native control bar responding at all -- the seek bar
    // would not drag. Built from the plugin's factory directly, because a node
    // view object is not reachable through the view it belongs to.
    render(CLIP)
    const factory = view!.someProp('nodeViews')!['video'] as unknown as (
      node: PMNode,
      editor: EditorView,
      getPos: () => number,
    ) => NodeView
    const nodeView = factory(view!.state.doc.child(1), view!, () => videoPos())
    const dom = nodeView.dom as HTMLElement
    const el = dom.querySelector('video')!
    stubPlayback(el)
    const at = (target: Element): Event => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      // `target` is only set by dispatch, and stopEvent is called by the view
      // rather than by an event path we can produce here.
      Object.defineProperty(event, 'target', { value: target })
      return event
    }

    // Inert: ProseMirror must see the gesture, or the node is never selected.
    expect(nodeView.stopEvent!(at(el))).toBe(false)
    nodeView.selectNode!()
    const play = dom.querySelector('.ol-media-play')!
    // Ours either way -- a click on it is an activation, not a selection change.
    expect(nodeView.stopEvent!(at(play))).toBe(true)
    play.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(nodeView.stopEvent!(at(el))).toBe(true)
    nodeView.deselectNode!()
    expect(nodeView.stopEvent!(at(el))).toBe(false)
    nodeView.destroy?.()
  })

  it('gives an image no play control at all', () => {
    const dom = render('<p><img src="/a.png" alt="x"></p>')
    expect(dom.querySelector('.ol-media-play')).toBeNull()
  })

  it('keeps the selection ring an image would have got', () => {
    // A node view that defines selectNode replaces ProseMirror's default rather
    // than extending it, and adding that class is all the default did.
    render(CLIP)
    selectTheVideo()
    expect(view!.dom.querySelector('.ol-img-resize')?.classList.contains('ProseMirror-selectednode')).toBe(
      true,
    )
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

  /*
   * The commit, not just the start.
   *
   * `pointerdown` refuses a drag on a read-only document, but that guard has
   * already passed by the time `pointerup` arrives -- and `readonly` can turn up
   * mid-gesture, from a permission change or a host toggling the attribute. The
   * width was then written anyway, which is the same defect the start guard was
   * added for, one event later.
   */
  it('refuses to commit a drag that readonly interrupted', () => {
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, {
      state: EditorState.create({
        doc: parseHtml(IMAGE, { schema: coreSchema() }),
        plugins: [mediaResizePlugin()],
      }),
    })
    const handle = view.dom.querySelector('.ol-img-handle')!
    handle.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100 }),
    )
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 40 }))
    // Mid-drag, before the pointer comes up.
    view.setProps({ editable: () => false })
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    expect(storedAttr('image', 'width')).toBe('640')
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
