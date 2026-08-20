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

  let dragging = false
  let startX = 0
  let startWidth = 0

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return
    const next = Math.max(16, Math.round(startWidth + (event.clientX - startX)))
    const pos = getPos()
    if (pos === undefined) return
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

  const onUp = (): void => {
    dragging = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    dragging = true
    startX = event.clientX
    startWidth = img.getBoundingClientRect().width
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })

  return {
    dom: wrap,
    update(updated) {
      if (updated.type.name !== 'image') return false
      applyAttrs(img, updated)
      return true
    },
    destroy() {
      onUp()
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
