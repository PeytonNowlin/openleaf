/**
 * Opt-in syntax highlighting and source formatting.
 *
 * Two features that share a tokenizer:
 *
 *   - **Code blocks** are highlighted with ProseMirror decorations, so the
 *     document is never touched and nothing here can alter what is stored.
 *   - **The source view** is reformatted -- only when the result provably parses
 *     to the same document -- and highlighted behind a transparent textarea.
 *
 * Loaded as a third script tag, after the editor:
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-highlight.min.js"></script>
 * ```
 */

import { registerEditorPlugin } from '@openleaf/core'
import { codeBlockHighlighting } from './codeblock.js'
import { HIGHLIGHT_CSS } from './theme.js'
import { watchSourceViews } from './source.js'

export { formatHtml, collapseWhitespaceBetweenTags, type FormatOptions } from './format.js'
export {
  canHighlight,
  highlight,
  setHighlighter,
  SUPPORTED_LANGUAGES,
  type Highlighter,
  type Token,
  type TokenType,
} from './highlighter.js'
export { resolveLanguage, tokenize, tokenizeCss, tokenizeHtml, tokenizeJs, type Language } from './tokenize.js'
export { codeBlockHighlighting, highlightPluginKey } from './codeblock.js'
export {
  enhanceSourceTextarea,
  formatIfLossless,
  watchSourceViews,
  SOURCE_CLOSE_EVENT,
  SOURCE_OPEN_EVENT,
  type SourceViewDetail,
} from './source.js'
export { HIGHLIGHT_CSS } from './theme.js'

let installed = false

/** Install code block highlighting and source view formatting. Idempotent. */
export function installSyntaxHighlighting(): void {
  if (installed) return
  installed = true

  // Styles go in through the same CSP-safe path the core bundle uses. A
  // constructable stylesheet is not an inline style, so `style-src 'self'`
  // does not block it.
  if (typeof document !== 'undefined') {
    try {
      if ('adoptedStyleSheets' in Document.prototype) {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(HIGHLIGHT_CSS)
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      } else {
        console.warn(
          '@openleaf/plugins-highlight: no adoptedStyleSheets support; ' +
            'link the stylesheet from the package instead.',
        )
      }
    } catch (error) {
      console.error('@openleaf/plugins-highlight: could not install styles', error)
    }
    watchSourceViews(document)
  }

  registerEditorPlugin(() => [codeBlockHighlighting()])
}
