import { DROP_WITH_CONTENT } from '@openleaf-editor/content-policy/elements'

/** CSS is document metadata, never an active node in the editing DOM. */
export interface EmbeddedStyle {
  css: string
  media: string
}

/** Trusted CMS input only. The ordinary HTML parser still drops style blocks. */
export function extractEmbeddedStyles(root: DocumentFragment): EmbeddedStyle[] {
  const styles: EmbeddedStyle[] = []
  for (const element of Array.from(root.querySelectorAll('style'))) {
    // Do not resurrect content from a form, foreign namespace, or another
    // subtree the regular parser discards. A nested module wrapper is fine.
    let excluded = element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (DROP_WITH_CONTENT.includes(parent.localName)) excluded = true
    }
    const type = element.getAttribute('type')?.trim().toLowerCase()
    if (!excluded && (!type || type === 'text/css')) {
      styles.push({ css: element.textContent ?? '', media: element.getAttribute('media') ?? '' })
    }
    element.remove()
  }
  return styles
}

/** Serialize only the metadata fields we own, not arbitrary style attributes. */
export function serializeEmbeddedStyles(styles: readonly EmbeddedStyle[], doc: Document): string {
  return styles.map(({ css, media }) => {
    const element = doc.createElement('style')
    if (media) element.setAttribute('media', media)
    // Source parsed from HTML cannot contain its own closing tag, but a caller
    // can construct document attributes directly. Keep that path inside CSS.
    element.textContent = css.replace(/<\/style/gi, '<\\/style')
    return element.outerHTML
  }).join('')
}
