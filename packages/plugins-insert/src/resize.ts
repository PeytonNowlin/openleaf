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

function imageView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const wrap = view.dom.ownerDocument.createElement('span')
  wrap.className = 'ol-img-resize'
  const img = view.dom.ownerDocument.createElement('img')
  applyAttrs(img, node)
  const handle = view.dom.ownerDocument.createElement('button')
  handle.type = 'button'
  handle.className = 'ol-img-handle'
  handle.setAttribute('aria-label', 'Resize image')
  wrap.append(img, handle)

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

  return {
    dom: wrap,
    update(updated) {
      if (updated.type.name !== 'image') return false
      applyAttrs(img, updated)
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
