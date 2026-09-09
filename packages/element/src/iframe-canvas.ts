import { ensureStyles, registerStyles, mirrorRegisteredStyles } from '@openleaf-editor/ui'

const FRAME_CSS = `
html, body { margin: 0; padding: 0; }
body.ol-editor { display: block; border: 0; border-radius: 0; }
body.ol-editor > .ol-content { border: 0; }
body.ol-editor > .ol-content > .ProseMirror { min-height: 100vh; box-sizing: border-box; }
`

/** A real browsing context: viewport units, media queries and rem need no CSS rewriting. */
export class IframeCanvas {
  readonly #descriptions = new Map<string, HTMLElement>()
  readonly destroy: () => void
  readonly frame: HTMLIFrameElement
  readonly document: Document
  readonly mount: HTMLDivElement

  constructor(host: HTMLElement, container: HTMLElement) {
    const frame = host.ownerDocument.createElement('iframe')
    frame.className = 'ol-canvas-frame'
    frame.title = host.getAttribute('aria-label') || 'Rich text editor'
    // WebKit suppresses parent-installed keyboard and selection callbacks in
    // a script-disabled frame. The parent runs the editor; authored HTML is
    // parsed through the normal schema, never assigned to srcdoc or written
    // into this document. This is layout isolation, not a security boundary.
    // Forms, popups and top-level navigation remain disallowed.
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    container.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) throw new Error('OpenLeaf: iframe canvas document is unavailable')
    const base = doc.createElement('base')
    base.href = host.ownerDocument.baseURI
    doc.head.appendChild(base)
    doc.body.className = 'ol-editor'
    this.destroy = mirrorRegisteredStyles(host.ownerDocument, doc)
    ensureStyles(doc)
    registerStyles(FRAME_CSS, doc)
    this.mount = doc.createElement('div')
    this.mount.className = 'ol-content'
    doc.body.appendChild(this.mount)
    this.frame = frame
    this.document = doc
  }

  copyDescriptions(attributes: Record<string, string>): void {
    // ID references cannot cross a browsing-context boundary. Mirror only
    // descriptive text; labels and input semantics remain owned by the host.
    for (const name of ['aria-describedby', 'aria-errormessage', 'aria-labelledby']) {
      const references: string[] = []
      for (const id of (attributes[name] ?? '').split(/\s+/).filter(Boolean)) {
        const source = this.frame.ownerDocument.getElementById(id)
        if (!source) continue
        let copy = this.#descriptions.get(id)
        if (!copy) {
          copy = this.document.createElement('span')
          copy.id = `ol-frame-description-${this.#descriptions.size}`
          copy.hidden = true
          this.document.body.appendChild(copy)
          this.#descriptions.set(id, copy)
        }
        copy.textContent = source.textContent
        references.push(copy.id)
      }
      if (references.length) attributes[name] = references.join(' ')
      else delete attributes[name]
    }
  }

  setStylesheets(urls: readonly string[]): void {
    this.document.head.querySelectorAll('link[data-ol-content-css]').forEach(link => link.remove())
    for (const url of urls) {
      const link = this.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.setAttribute('data-ol-content-css', '')
      this.document.head.appendChild(link)
    }
  }
}
