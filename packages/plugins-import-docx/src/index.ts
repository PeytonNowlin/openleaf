/**
 * Word `.docx` import.
 *
 * ## Why this is its own bundle
 *
 * A `.docx` is a ZIP of OOXML, not HTML, and converting it properly is somebody
 * else's solved problem -- mammoth has years of work in it and a hand-rolled
 * OOXML converter would be visibly worse. But it is big:
 *
 *     mammoth (browser build)   492 KB min   122.3 KB gzip
 *
 * Larger than the entire editor. So it is not in `@openleaf-editor/plugins-import`,
 * which stays 2.2 KB and handles HTML and text with no dependency at all. Sites
 * that need Word documents load one more script; sites that do not, do not pay
 * for it.
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-import.min.js"></script>
 * <script src="/js/openleaf-import-docx.min.js"></script>
 * ```
 *
 * ## Images
 *
 * mammoth inlines images as `data:` URIs by default, and OpenLeaf blocks `data:`
 * URLs on purpose -- `data:text/html` is a full XSS vector and separating safe
 * data URLs from dangerous ones by sniffing the media type is exactly the
 * parsing that gets defeated. So an image would be silently stripped downstream,
 * which is the failure this project exists to avoid.
 *
 * Instead images are dropped deliberately and **counted**, and the count is
 * reported to the author. Someone importing a report needs to know its charts
 * did not come with it while they still have the original open. An integrator
 * who wants real image import supplies `convertImage` and uploads them.
 *
 * ## Where the code is
 *
 * The conversion lives in `converter.ts`, with mammoth passed to it rather than
 * imported. Only this file names the browser build, which is what keeps the
 * converter reachable from a test -- see the note there.
 */

import mammoth from 'mammoth/mammoth.browser.js'
import { addAcceptedExtensions, registerFileConverter, removeAcceptedExtensions } from '@openleaf-editor/plugins-import'
import { createDocxConverter, type DocxOptions } from './converter.js'

export { createDocxConverter, DEFAULT_STYLE_MAP, type DocxMammoth, type DocxOptions } from './converter.js'
export { DEFAULT_DOCX_LIMITS, type DocxLimits } from './guards.js'

let installed = false

const DOCX_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Register the `.docx` converter. Idempotent while installed; the disposer fully uninstalls. */
export function installDocxImport(options: DocxOptions = {}): () => void {
  if (installed) return () => undefined
  installed = true

  addAcceptedExtensions(DOCX_ACCEPT)
  const unregister = registerFileConverter(createDocxConverter(mammoth, options))

  return () => {
    unregister()
    removeAcceptedExtensions(DOCX_ACCEPT)
    installed = false
  }
}

export { mammoth }
