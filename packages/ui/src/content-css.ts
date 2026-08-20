/**
 * Load content CSS so the canvas matches the published site.
 *
 * OpenLeaf has no iframe. Host typography already inherits into the document,
 * which is the point of skipping Shadow DOM. This helper is for an extra
 * stylesheet the published template uses -- a CMS "styles.css" -- that is not
 * on the admin page. Selectors are scoped under the editor canvas so a rule
 * written for `p.lead` cannot restyle the rest of the admin chrome.
 */

export function scopeContentCss(css: string): string {
  return css.replace(/(^|})(\s*)([^@{}][^{]*)\{/g, (full, brace: string, space: string, selector: string) => {
    if (selector.trim().startsWith('@')) return full
    const scoped = selector
      .split(',')
      .map((part) => {
        const trimmed = part.trim()
        if (!trimmed) return part
        if (trimmed.startsWith('.ol-editor') || trimmed.startsWith('.ol-content')) return trimmed
        return `.ol-editor .ol-content .ProseMirror ${trimmed}`
      })
      .join(', ')
    return `${brace}${space}${scoped}{`
  })
}

export async function loadContentCss(doc: Document, urls: readonly string[]): Promise<void> {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in Document.prototype)) {
    console.warn(
      '@openleaf-editor/ui: content CSS could not be adopted in this browser. ' +
        'Link the published stylesheet on the host page instead.',
    )
    return
  }
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const css = scopeContentCss(await response.text())
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    } catch (error) {
      console.warn(
        `@openleaf-editor/ui: content CSS at "${url}" could not be loaded.`,
        error,
      )
    }
  }
}

export function contentCssUrls(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[, ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}
