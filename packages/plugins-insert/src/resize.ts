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
function setDimension(img: HTMLImageElement, name: 'width' | 'height', raw: unknown): void {
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

function applyAttrs(img: HTMLImageElement, node: PMNode): void {
  img.src = node.attrs['src'] as string
  const alt = node.attrs['alt']
  if (alt !== null) img.alt = alt as string
  else img.removeAttribute('alt')
  const title = node.attrs['title']
  if (title) img.title = title as string
  else img.removeAttribute('title')
  setDimension(img, 'width', node.attrs['width'])
  setDimension(img, 'height', node.attrs['height'])
  const align = node.attrs['align'] as ImageAlign | null
  const classes = [align ? IMAGE_ALIGN_CLASS[align] : '', (node.attrs['className'] as string | null) ?? '']
    .filter((part) => part !== '')
    .join(' ')
  img.className = classes
}

/** One arrow press, and one Shift+arrow press, in CSS pixels. */
const STEP = 10
const BIG_STEP = 50
/** Below this an image is a dot, and the handle cannot be hit again by pointer. */
const MIN_WIDTH = 16

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
function imageView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const wrap = view.dom.ownerDocument.createElement('span')
  wrap.className = 'ol-img-resize'
  const img = view.dom.ownerDocument.createElement('img')
  applyAttrs(img, node)
  const handle = view.dom.ownerDocument.createElement('button')
  handle.type = 'button'
  handle.className = 'ol-img-handle'
  handle.setAttribute('role', 'slider')
  handle.setAttribute('aria-label', 'Image width')
  handle.setAttribute('aria-orientation', 'horizontal')
  handle.setAttribute('aria-valuemin', String(MIN_WIDTH))
  wrap.append(img, handle)

  /** How wide the author may go: the line the image sits on, or its natural size. */
  const maxWidth = (): number => {
    const box = Math.round(view.dom.getBoundingClientRect().width)
    if (box > MIN_WIDTH) return box
    return Math.max(img.naturalWidth || 0, currentWidth() * 2, 1000)
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
    // A percentage width is legal in the storage format, and "50%" is a truer
    // thing to say than the pixel count it happens to render at right now.
    handle.setAttribute('aria-valuetext', shown === '' ? 'Automatic' : numeric ? `${shown} pixels` : shown)
  }

  const resizeTo = (raw: number): void => {
    const pos = getPos()
    if (pos === undefined) return
    const next = Math.max(MIN_WIDTH, Math.round(raw))
    const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0
    const height = ratio ? String(Math.round(next * ratio)) : null
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

  /** Pixel height that keeps the image's aspect ratio, or null if it is unknown. */
  const heightFor = (width: number): string | null => {
    const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0
    return ratio ? String(Math.round(width * ratio)) : null
  }

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

  return {
    dom: wrap,
    update(updated) {
      if (updated.type.name !== 'image') return false
      applyAttrs(img, updated)
      sync(updated)
      return true
    },
    destroy() {
      // `stop`, not `onUp`: a node view torn down mid-drag must not dispatch
      // into a view that is being dismantled, and the size the author was
      // dragging towards is not one they ever committed to.
      stop()
    },
  }
}

export function imageResizePlugin(): Plugin {
  return new Plugin({
    props: {
      nodeViews: {
        image: (node, view, getPos) => imageView(node, view, getPos),
      },
    },
  })
}
