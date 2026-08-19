/**
 * Drag-resize for images, video and audio.
 *
 * A node view rather than decorations: the handle has to sit on the element's
 * own box, survive selection changes, and write width/height back onto the
 * node. Decorations cannot own pointer capture for a drag that starts on the
 * media and ends elsewhere in the document.
 *
 * Aspect ratio is kept from the element's current box, so a photograph does
 * not squash when the author drags one corner. Keyboard users set dimensions
 * in the properties dialog instead -- a 1px-keybind resize is not a substitute
 * for that.
 */

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'

/** `<source>` and `<track>`, the only children core models on a media node. */
const FURNITURE_TAGS = new Set(['source', 'track'])

/**
 * Put the node's stored `<source>`/`<track>` children back on the element.
 *
 * Core deliberately models and preserves them, so source-only media -- a
 * `<video>` with no `src` of its own and two `<source>` children -- has nothing
 * to play without this, and alternate formats cannot stand in when the browser
 * cannot decode the primary one.
 */
function appendFurniture(host: Element, html: string | null, doc: Document): void {
  if (!html) return
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  for (const child of Array.from(tpl.content.children)) {
    if (!FURNITURE_TAGS.has(child.nodeName.toLowerCase())) continue
    host.appendChild(child)
  }
}

function renderMedia(node: PMNode, wrap: HTMLElement): HTMLElement {
  const name = node.type.name
  const doc = wrap.ownerDocument
  const el = doc.createElement(name === 'audio' ? 'audio' : name === 'video' ? 'video' : 'img')
  const src = node.attrs['src'] as string | null
  if (src) el.setAttribute('src', src)
  // The node type is `image`; only the element it renders to is an `<img>`.
  // Testing the element's name here stripped every alt attribute from the live
  // editor DOM, losing both descriptions and a deliberate decorative `alt=""`.
  if (name === 'image') {
    const alt = node.attrs['alt']
    if (alt !== null && alt !== undefined) el.setAttribute('alt', String(alt))
  }
  if (name === 'video' || name === 'audio') {
    ;(el as HTMLMediaElement).controls = true
    appendFurniture(el, node.attrs['furniture'] as string | null, doc)
  }
  const poster = node.attrs['poster'] as string | null
  if (poster && name === 'video') el.setAttribute('poster', poster)
  const width = node.attrs['width'] as string | null
  const height = node.attrs['height'] as string | null
  if (width) (el as HTMLElement).style.width = /^\d+$/.test(width) ? `${width}px` : width
  if (height) (el as HTMLElement).style.height = /^\d+$/.test(height) ? `${height}px` : height
  return el
}

class MediaView implements NodeView {
  dom: HTMLElement
  readonly #handle: HTMLButtonElement
  #node: PMNode
  readonly #getPos: () => number | undefined
  readonly #view: EditorView

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.#node = node
    this.#view = view
    this.#getPos = getPos
    const wrap = view.dom.ownerDocument.createElement('span')
    wrap.className = 'ol-media'
    wrap.append(renderMedia(node, wrap))
    const handle = view.dom.ownerDocument.createElement('button')
    handle.type = 'button'
    handle.className = 'ol-media-handle'
    handle.setAttribute('aria-label', 'Resize')
    handle.addEventListener('pointerdown', this.#onPointerDown)
    wrap.append(handle)
    this.dom = wrap
    this.#handle = handle
  }

  update(node: PMNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    const next = renderMedia(node, this.dom)
    this.dom.replaceChild(next, this.dom.firstChild as Node)
    return true
  }

  destroy(): void {
    this.#handle.removeEventListener('pointerdown', this.#onPointerDown)
  }

  #onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const media = this.dom.firstElementChild as HTMLElement | null
    if (!media) return
    const startX = event.clientX
    const startW = media.getBoundingClientRect().width
    const ratio =
      media.getBoundingClientRect().height > 0
        ? media.getBoundingClientRect().width / media.getBoundingClientRect().height
        : 0
    const pointerId = event.pointerId
    this.#handle.setPointerCapture(pointerId)

    const onMove = (move: PointerEvent): void => {
      const width = Math.max(32, Math.round(startW + (move.clientX - startX)))
      const height = ratio > 0 ? Math.round(width / ratio) : null
      media.style.width = `${width}px`
      if (height) media.style.height = `${height}px`
    }
    const onUp = (up: PointerEvent): void => {
      this.#handle.removeEventListener('pointermove', onMove)
      this.#handle.removeEventListener('pointerup', onUp)
      if (this.#handle.hasPointerCapture(pointerId)) this.#handle.releasePointerCapture(pointerId)
      const width = Math.max(32, Math.round(startW + (up.clientX - startX)))
      const height = ratio > 0 ? Math.round(width / ratio) : null
      const pos = this.#getPos()
      if (pos === undefined) return
      const node = this.#view.state.doc.nodeAt(pos)
      if (!node) return
      this.#view.dispatch(
        this.#view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          width: String(width),
          height: height !== null ? String(height) : node.attrs['height'],
        }),
      )
    }
    this.#handle.addEventListener('pointermove', onMove)
    this.#handle.addEventListener('pointerup', onUp)
  }
}

export function mediaResizePlugin(): Plugin {
  return new Plugin({
    props: {
      nodeViews: {
        image: (node, view, getPos) => new MediaView(node, view, getPos),
        video: (node, view, getPos) => new MediaView(node, view, getPos),
        audio: (node, view, getPos) => new MediaView(node, view, getPos),
      },
    },
  })
}