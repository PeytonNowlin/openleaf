import { IMAGE_ALIGN_CLASS, type ImageAlign } from '@openleaf-editor/core'
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'

/**
 * Put a stored dimension on the element without going through `img.width`.
 *
 * The schema preserves what the document said, and `width="50%"` is legal HTML.
 * `img.width` is an unsigned long, so `Number('50%')` is NaN and lands as 0 --
 * collapsing the image instead of rendering it at half the container. A
 * percentage is not a valid width attribute value either, so it goes on the
 * style, which is editor-only DOM and never serialized.
 */
function setDimension(img: MediaElement, name: 'width' | 'height', raw: unknown): void {
  const value = raw === null || raw === undefined ? '' : String(raw).trim()
  if (value === '') {
    img.removeAttribute(name)
    img.style.removeProperty(name)
    return
  }
  if (/^\d+$/.test(value)) {
    img.style.removeProperty(name)
    img.setAttribute(name, value)
    return
  }
  img.removeAttribute(name)
  img.style.setProperty(name, value)
}

/**
 * The node types this plugin gives a resize handle.
 *
 * Not `audio`: its spec declares no `width`/`height`, because an audio player
 * has no intrinsic box -- only the height of whatever controls the browser
 * draws. A handle there would write dimensions the schema drops on the next
 * parse, which is a control that appears to work and does not.
 */
export const RESIZABLE_MEDIA = ['image', 'video'] as const

export type ResizableKind = (typeof RESIZABLE_MEDIA)[number]

/** The element a node of this kind renders to in the live editor. */
type MediaElement = HTMLImageElement | HTMLVideoElement

function createElement(kind: ResizableKind, doc: Document): MediaElement {
  return kind === 'video' ? doc.createElement('video') : doc.createElement('img')
}

/**
 * The element's own idea of its size, for aspect ratio and for the drag ceiling.
 *
 * An image knows this as soon as it decodes; a video only once it has fetched
 * enough to have metadata, and reports 0 until then. Both are therefore treated
 * as "may not know yet" rather than "knows now", which is what the `|| 0` guards
 * at the call sites are for.
 */
function isVideo(el: MediaElement): el is HTMLVideoElement {
  // `localName`, not `instanceof`. An editor mounted in an iframe builds its
  // elements from that document, so they are instances of the iframe's
  // `HTMLVideoElement` and not the outer window's -- `instanceof` is false
  // across realms, and every video would have been treated as an image: no
  // poster, no `<source>` children, and source-only players rendering blank.
  return el.localName === 'video'
}

function intrinsic(el: MediaElement): { width: number; height: number } {
  if (isVideo(el)) return { width: el.videoWidth, height: el.videoHeight }
  return { width: el.naturalWidth, height: el.naturalHeight }
}

function applyImageAttrs(img: HTMLImageElement, node: PMNode): void {
  img.src = node.attrs['src'] as string
  const alt = node.attrs['alt']
  if (alt !== null) img.alt = alt as string
  else img.removeAttribute('alt')
  const align = node.attrs['align'] as ImageAlign | null
  const classes = [align ? IMAGE_ALIGN_CLASS[align] : '', (node.attrs['className'] as string | null) ?? '']
    .filter((part) => part !== '')
    .join(' ')
  img.className = classes
}

/**
 * The furniture markup each video's children were last built from.
 *
 * Weakly keyed, so an element that goes out of the document takes its entry with
 * it. This exists so `applyVideoAttrs` can tell a real furniture change from the
 * every-update churn it is otherwise called with -- see the note at the rebuild.
 */
const appliedFurniture = new WeakMap<HTMLVideoElement, string>()

/**
 * Put the player's addresses and poster on the element.
 *
 * The `<source>` and `<track>` children live in the node's `furniture` attribute
 * as a markup string -- the shape core stores them in -- so they are rebuilt here
 * rather than set as properties. Rebuilt whenever that string changes, because a
 * dialog that removes a source has to remove it from the live DOM too, and there
 * is no diffing worth doing on two or three elements. Not rebuilt when it has
 * not changed: that would discard live `TextTrack` state on every update.
 *
 * The player is rendered *without* controls, and made inert by CSS, so that in
 * the editor it is a preview rather than a working player. That is not a
 * limitation being accepted quietly -- it is the only arrangement in which the
 * author can select the thing at all.
 *
 * A `<video controls>` handles pointer events in its native control chrome, and
 * Firefox handles them for the whole element: no `pointerdown`, `mousedown` or
 * `click` listener anywhere in the editor's DOM ever fires, so ProseMirror never
 * sees the gesture and never makes a `NodeSelection`. Since selecting the player
 * is how the toolbar knows to edit rather than insert, a video in Firefox could
 * be inserted and then never edited again. Chromium and WebKit let a click on
 * the picture area through, which is exactly the sort of difference that ships.
 *
 * This is the *default* state, not the only one: `mediaView` adds a play button
 * of its own to a selected video, and activating it hands that one element its
 * controls and its pointer events back for as long as it stays selected. The
 * preview has to remain the default because it is what makes the node
 * selectable, and being selectable is what makes it editable.
 *
 * Neither `controls` nor the stored markup is affected: stored HTML is
 * serialized from the node, not from this DOM, so what the document says about
 * controls is untouched and the player is fully interactive on the page.
 */
function applyVideoAttrs(el: HTMLVideoElement, node: PMNode): void {
  // Written only when it changes. Setting the `src` attribute runs the media
  // load algorithm even for an identical value, which rewinds a clip the author
  // is watching in the activated state -- and this function runs on every node
  // update, so a resize would otherwise restart playback.
  const src = node.attrs['src'] as string | null
  if (src === null) el.removeAttribute('src')
  else if (el.getAttribute('src') !== src) el.setAttribute('src', src)
  const poster = node.attrs['poster'] as string | null
  if (poster === null) el.removeAttribute('poster')
  else if (el.getAttribute('poster') !== poster) el.setAttribute('poster', poster)
  // Not `controls = true`: see the note above. The element also must not
  // advertise a control bar it will not honour. `mediaView` puts them back when
  // the author activates the player, which is why this runs before that sync
  // rather than instead of it.
  el.controls = false
  // Enough to paint a first frame for a player with no poster, without
  // fetching the whole file into an editor nobody is watching it in.
  el.preload = 'metadata'
  // Rebuilt only when the markup changed, for the same reason `src` is written
  // only when it changes -- and it matters more here. A rebuild replaces every
  // `<track>` with a new element, and a new `<track>` means a new `TextTrack`,
  // whose `mode` starts out `disabled`. Since this runs on every node update, an
  // author who turned captions on and then resized the player they were watching
  // had them turned back off. An update that did not touch the furniture has no
  // business rebuilding it.
  const furniture = (node.attrs['furniture'] as string | null) ?? ''
  if (appliedFurniture.get(el) === furniture) return
  appliedFurniture.set(el, furniture)
  for (const child of Array.from(el.children)) child.remove()
  if (furniture) {
    const tpl = el.ownerDocument.createElement('template')
    tpl.innerHTML = furniture
    // Only the furniture tags, and only their addresses: this string has been
    // through core's `scrub` already, and re-adopting it wholesale into the live
    // document is the class of mistake #64 exists to prevent.
    for (const source of Array.from((tpl as HTMLTemplateElement).content.children)) {
      const name = source.nodeName.toLowerCase()
      if (name !== 'source' && name !== 'track') continue
      const copy = el.ownerDocument.createElement(name)
      for (const attr of ['src', 'type', 'kind', 'srclang', 'label']) {
        const value = source.getAttribute(attr)
        if (value !== null) copy.setAttribute(attr, value)
      }
      el.appendChild(copy)
    }
  }
}

function applyAttrs(el: MediaElement, node: PMNode): void {
  if (isVideo(el)) applyVideoAttrs(el, node)
  else applyImageAttrs(el as HTMLImageElement, node)
  const title = node.attrs['title']
  if (title) el.title = title as string
  else el.removeAttribute('title')
  setDimension(el, 'width', node.attrs['width'])
  setDimension(el, 'height', node.attrs['height'])
}

/** One arrow press, and one Shift+arrow press, in CSS pixels. */
const STEP = 10
const BIG_STEP = 50
/** Below this an image is a dot, and the handle cannot be hit again by pointer. */
const MIN_WIDTH = 16

/** On the wrapper while one video has been handed back its own pointer events. */
const LIVE_CLASS = 'ol-media-live'
/**
 * ProseMirror's own selection ring class.
 *
 * A node view that defines `selectNode` replaces the default implementation
 * rather than extending it, and adding this class is all the default did for an
 * atom with no `contentDOM`. So it is added here, or a selected video would lose
 * the outline every other selected node gets.
 */
const SELECTED_CLASS = 'ProseMirror-selectednode'

/**
 * The resize handle.
 *
 * It was a real `<button>` with an `aria-label` and a `pointerdown` listener and
 * nothing else -- announced as "Resize image, button", focusable, and inert to
 * every key. A dead tab stop advertising a capability it does not have is worse
 * than no control at all, because the author has to work out for themselves that
 * the thing they just tabbed to does nothing.
 *
 * It is `role="slider"` now rather than a button, because that is what it is: a
 * value the arrow keys move. The role brings the announcement with it -- a
 * screen reader speaks `aria-valuetext` on every change, so the new width is
 * read out without a live region racing it and saying the same thing twice.
 */
function mediaView(
  kind: ResizableKind,
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
  availability: Set<() => void>,
): NodeView {
  const wrap = view.dom.ownerDocument.createElement('span')
  wrap.className = 'ol-img-resize'
  const img = createElement(kind, view.dom.ownerDocument)
  applyAttrs(img, node)
  const handle = view.dom.ownerDocument.createElement('button')
  handle.type = 'button'
  handle.className = 'ol-img-handle'
  handle.setAttribute('role', 'slider')
  handle.setAttribute('aria-label', kind === 'video' ? 'Video width' : 'Image width')
  handle.setAttribute('aria-orientation', 'horizontal')
  handle.setAttribute('aria-valuemin', String(MIN_WIDTH))

  /**
   * Click-to-activate.
   *
   * The inert preview above is what makes a video selectable, and that must not
   * regress -- but it also means an author cannot play or scrub a clip without
   * leaving the editor. So one explicit gesture hands a single element its own
   * pointer events back, and only for as long as it stays selected.
   *
   * The gesture is *our* button rather than a listener on the element, because a
   * listener on the element cannot work: Firefox routes pointer events for the
   * whole of a `<video controls>` into its native chrome, and the `pointerdown`
   * never arrives. It was tried first.
   *
   * The button appears only once the node is selected, so the first click on a
   * video is still the one that selects it. That makes the activation gesture a
   * second click in practice, while being a real, labelled, focusable control
   * rather than a click count nobody can see.
   *
   * `null` for an image: it has nothing to play, and giving it a `selectNode` of
   * our own would mean reimplementing the selection ring for no reason.
   */
  const media = isVideo(img) ? img : null
  const play = media === null ? null : view.dom.ownerDocument.createElement('button')
  if (play !== null) {
    play.type = 'button'
    play.className = 'ol-media-play'
    play.setAttribute('aria-label', 'Play video')
    play.hidden = true
  }

  // The handle goes last so it paints over the play button, which is centred and
  // could otherwise cover a handle on a small video.
  wrap.append(img, ...(play === null ? [] : [play]), handle)

  let selected = false
  let live = false

  /** Put `live` and `selected` onto the DOM. The single place either is read. */
  const syncLive = (): void => {
    if (media === null || play === null) return
    media.controls = live
    wrap.classList.toggle(LIVE_CLASS, live)
    play.hidden = live || !selected
  }

  const activate = (): void => {
    if (media === null || live) return
    live = true
    syncLive()
    // The button that was just pressed is hidden now, so focus cannot stay on
    // it. It belongs on the player: the native control bar is reachable from
    // there with the keyboard, and the Escape handler below needs a focused
    // element inside the wrapper to hear the key at all. ProseMirror keeps the
    // node selection across a blur, so this does not deselect the node.
    media.focus()
    // Best effort. The click that got here is a user activation, so an engine
    // should allow it; if one does not, the author is left looking at working
    // controls and can press play themselves. jsdom has no playback at all.
    try {
      void media.play()?.catch(() => undefined)
    } catch {
      /* No playback here. Activation is the part that matters. */
    }
  }

  /**
   * Hand the element back to the preview state.
   *
   * The pause is not tidiness. Once the element is inert again there is no
   * control left to stop it with, so a clip left playing could not be silenced
   * without hunting it down and selecting it a second time.
   */
  const release = (): void => {
    if (media === null) return
    if (live) {
      live = false
      try {
        media.pause()
      } catch {
        /* No playback here either. */
      }
    }
    syncLive()
  }

  play?.addEventListener('click', (event) => {
    event.preventDefault()
    activate()
  })

  // Escape is the way out for a keyboard author: the native control bar is
  // focusable, and leaving focus inside one that is about to stop taking
  // pointer events is a dead end. The node stays selected, so the toolbar can
  // still edit it.
  wrap.addEventListener('keydown', (event) => {
    if (!live || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    release()
    view.focus()
  })

  /** How wide the author may go: the line the image sits on, or its natural size. */
  const maxWidth = (): number => {
    const box = Math.round(view.dom.getBoundingClientRect().width)
    if (box > MIN_WIDTH) return box
    return Math.max(intrinsic(img).width || 0, currentWidth() * 2, 1000)
  }

  /**
   * The width the next key press moves from.
   *
   * The stored attribute first, because it is what the document says and what a
   * repeated press has to accumulate on; the rendered box only as a fallback for
   * an image that has never been given one.
   */
  function currentWidth(): number {
    const pos = getPos()
    const stored = pos === undefined ? null : view.state.doc.nodeAt(pos)?.attrs['width']
    const value = Number(stored)
    if (Number.isFinite(value) && value > 0) return value
    return Math.round(img.getBoundingClientRect().width) || 0
  }

  const sync = (updated: PMNode): void => {
    const stored = updated.attrs['width']
    const value = Number(stored)
    const numeric = Number.isFinite(value) && value > 0
    const shown = numeric ? String(value) : (stored === null ? '' : String(stored))
    handle.setAttribute('aria-valuenow', String(numeric ? value : currentWidth()))
    handle.setAttribute('aria-valuemax', String(maxWidth()))
    syncAvailability()
    // A percentage width is legal in the storage format, and "50%" is a truer
    // thing to say than the pixel count it happens to render at right now.
    handle.setAttribute('aria-valuetext', shown === '' ? 'Automatic' : numeric ? `${shown} pixels` : shown)
  }

  /**
   * Whether the handle advertises that it can do anything.
   *
   * This handle is a real button inside a node view, so it sits outside
   * ProseMirror's `editable` gate the way the table context menu does -- and a
   * read-only document could be resized with the arrow keys. The guards are in
   * `resizeTo` and on `pointerdown`; this is the part that says so, because a
   * control that silently does nothing is worse than one that admits it.
   *
   * Unavailable rather than absent, matching the toolbar. `aria-disabled` rather
   * than `disabled` keeps a slider focusable, so an author can still read the
   * current width off it.
   *
   * Separate from `sync` and registered with the plugin, because read-only can
   * be toggled after mount and a node view's `update` only runs when its NODE
   * changes. It touches one attribute and reads no layout, so refreshing every
   * media view on the transition costs nothing -- which `sync` could not claim,
   * since `maxWidth()` measures.
   */
  const syncAvailability = (): void => {
    handle.setAttribute('aria-disabled', view.editable ? 'false' : 'true')
  }
  availability.add(syncAvailability)

  /**
   * Pixel height that keeps the element's aspect ratio, or null if it is
   * unknown -- a video that has not loaded metadata yet reports 0x0, and
   * guessing a height for it would squash the frame once it arrives.
   */
  const heightFor = (width: number): string | null => {
    const { width: nw, height: nh } = intrinsic(img)
    const ratio = nh && nw ? nh / nw : 0
    return ratio ? String(Math.round(width * ratio)) : null
  }

  const resizeTo = (raw: number): void => {
    // See `syncAvailability`: this path is not behind ProseMirror's own gate.
    if (!view.editable) return
    const pos = getPos()
    if (pos === undefined) return
    const next = Math.max(MIN_WIDTH, Math.round(raw))
    const height = heightFor(next)
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...view.state.doc.nodeAt(pos)?.attrs,
        width: String(next),
        height,
      }),
    )
  }

  /*
   * The drag is a CSS preview, and exactly one transaction at the end.
   *
   * Dispatching per `pointermove` was the obvious implementation and the wrong
   * one twice over. A pointer reports at 60-120 Hz, and every one of those was a
   * `docChanged` transaction: the full per-keystroke bill -- plugin
   * `appendTransaction`s, decoration rebuilds, the host's change listener --
   * ninety times a second, on a document the author was not editing. And each
   * one landed in the undo history, so a two-second drag cost the author a
   * hundred and eighty presses of Ctrl-Z to get back past it.
   *
   * So the drag paints `img.style` instead, coalesced to one write per animation
   * frame because paint is the only thing that consumes it and the browser only
   * paints once per frame anyway. The document learns the final size once, on
   * `pointerup`, which is also the only size the author ever meant.
   */
  let dragging = false
  let startX = 0
  let startWidth = 0
  let previewWidth = 0
  let moved = false
  let frame = 0

  const win = (): (Window & typeof globalThis) | null => wrap.ownerDocument.defaultView

  const paint = (): void => {
    frame = 0
    if (!dragging) return
    img.style.width = `${previewWidth}px`
    const height = heightFor(previewWidth)
    if (height !== null) img.style.height = `${height}px`
  }

  /** Drop the preview so the node's own attributes are what shows again. */
  const clearPreview = (): void => {
    if (frame !== 0) win()?.cancelAnimationFrame(frame)
    frame = 0
    img.style.removeProperty('width')
    img.style.removeProperty('height')
  }

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return
    previewWidth = Math.max(16, Math.round(startWidth + (event.clientX - startX)))
    moved = true
    const frames = win()
    if (!frames?.requestAnimationFrame) {
      paint()
      return
    }
    if (frame === 0) frame = frames.requestAnimationFrame(paint)
  }

  const stop = (): void => {
    if (!dragging) return
    dragging = false
    clearPreview()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  const onUp = (): void => {
    const commit = dragging && moved
    const width = previewWidth
    stop()
    if (!commit) return
    const pos = getPos()
    if (pos === undefined) return
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...view.state.doc.nodeAt(pos)?.attrs,
        width: String(width),
        height: heightFor(width),
      }),
    )
  }

  handle.addEventListener('pointerdown', (event) => {
    // Guarded at the start of the drag rather than at its commit, so a read-only
    // document does not even show a resize preview.
    if (!view.editable) return
    event.preventDefault()
    dragging = true
    moved = false
    startX = event.clientX
    startWidth = img.getBoundingClientRect().width
    previewWidth = startWidth
    // The pointer belongs to the handle until it is released, so a fast drag
    // that outruns the cursor -- or leaves the editor entirely -- still reports
    // to us instead of to whatever it happens to be over. Guarded because jsdom
    // has no pointer capture; the window listeners below are what makes the
    // fallback work, and capture retargets events without stopping them
    // reaching an ancestor, so both paths see the same stream.
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      /* No pointer capture here. The window listeners are the whole fallback. */
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  })

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const width = currentWidth()
    let next: number | null = null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = width + step
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = width - step
        break
      case 'PageUp':
        next = width + BIG_STEP
        break
      case 'PageDown':
        next = width - BIG_STEP
        break
      case 'Home':
        next = MIN_WIDTH
        break
      case 'End':
        next = maxWidth()
        break
      default:
        return
    }
    event.preventDefault()
    // The same arrow key moves the caret out of the image if the editor sees it.
    event.stopPropagation()
    resizeTo(next)
  })

  sync(node)

  const nodeView: NodeView = {
    dom: wrap,
    update(updated) {
      if (updated.type.name !== kind) return false
      applyAttrs(img, updated)
      sync(updated)
      // `applyAttrs` restores the preview -- controls off -- because that is the
      // default state. An activated player has to survive its own resize, so the
      // live state is reasserted here.
      syncLive()
      return true
    },
    destroy() {
      // `stop`, not `onUp`: a node view torn down mid-drag must not dispatch
      // into a view that is being dismantled, and the size the author was
      // dragging towards is not one they ever committed to.
      stop()
      // A detached media element keeps playing. Nothing would be able to stop it.
      release()
      availability.delete(syncAvailability)
    },
  }

  if (media !== null) {
    nodeView.selectNode = (): void => {
      wrap.classList.add(SELECTED_CLASS)
      selected = true
      syncLive()
    }
    nodeView.deselectNode = (): void => {
      wrap.classList.remove(SELECTED_CLASS)
      selected = false
      // At most one live player: the selection moving on is what ends this one.
      release()
    }
    /**
     * Keep ProseMirror out of the activated player's events.
     *
     * Not a nicety. ProseMirror's own `mousedown` handling calls
     * `preventDefault()` when the gesture lands on a selectable atom, which
     * stops a native control bar responding at all -- the seek bar would not
     * drag. While the element is inert this never comes up, because the CSS
     * means it receives no pointer events in the first place.
     */
    nodeView.stopEvent = (event: Event): boolean => {
      const target = event.target
      if (target === null || !(typeof target === 'object') || !('nodeType' in target)) return false
      const node = target as Node
      if (play !== null && (play === node || play.contains(node))) return true
      return live && (media === node || media.contains(node))
    }
  }

  return nodeView
}

/**
 * Drag-resize handles for the media that has a box to drag.
 *
 * One plugin for both kinds rather than one per kind: a `nodeViews` prop is a
 * map keyed by node name, so two plugins each claiming `image` would not
 * compose -- the later registration would simply win, and which one that is
 * depends on install order.
 */
export function mediaResizePlugin(): Plugin {
  /** Every live handle's availability refresher. See `syncAvailability`. */
  const availability = new Set<() => void>()
  return new Plugin({
    /*
     * Only to notice read-only being toggled after mount.
     *
     * A node view's `update` runs when its node changes, and a change of
     * editability is not that -- so without this a handle created while the
     * document was editable went on saying so after `readonly` arrived. Gated on
     * the transition rather than run every transaction: this fires on every
     * keystroke, and doing per-node work here is exactly the per-keystroke cost
     * that was removed from this editor once already.
     */
    view(editor) {
      let editable = editor.editable
      return {
        update(updated) {
          if (updated.editable === editable) return
          editable = updated.editable
          for (const refresh of availability) refresh()
        },
      }
    },
    props: {
      nodeViews: {
        image: (node, view, getPos) => mediaView('image', node, view, getPos, availability),
        video: (node, view, getPos) => mediaView('video', node, view, getPos, availability),
      },
    },
  })
}

/**
 * @deprecated Use `mediaResizePlugin`, which also handles video. Kept because
 * this name is in the published API of 0.1.0-beta.2.
 */
export function imageResizePlugin(): Plugin {
  return mediaResizePlugin()
}
