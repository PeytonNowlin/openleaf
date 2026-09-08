/** Find the owning custom element, including an opt-in iframe canvas. */
export function findEditorHost(from: Element): HTMLElement | null {
  const local = from.closest<HTMLElement>('openleaf-editor')
  if (local) return local
  const frame = from.ownerDocument.defaultView?.frameElement
  return frame?.closest<HTMLElement>('openleaf-editor') ?? null
}

/** Translate canvas viewport coordinates into the document containing its chrome. */
export function canvasPoint(from: Document, to: Document, x: number, y: number): { x: number; y: number } {
  let doc = from
  while (doc !== to) {
    const frame = doc.defaultView?.frameElement
    if (!frame) break
    const box = frame.getBoundingClientRect()
    x += box.left + frame.clientLeft
    y += box.top + frame.clientTop
    doc = frame.ownerDocument
  }
  return { x, y }
}
