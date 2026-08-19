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
 * Larger than the entire editor. So it is not in `@openleaf/plugins-import`,
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
 */

import mammoth from 'mammoth/mammoth.browser.js'
import { addAcceptedExtensions, registerFileConverter, removeAcceptedExtensions } from '@openleaf/plugins-import'

export interface DocxOptions {
  /**
   * Handle an embedded image, returning attributes for an `<img>`.
   *
   * Left unset, images are dropped and counted. Set it to upload each image and
   * return the stored URL.
   */
  convertImage?: (image: {
    contentType: string
    read: (encoding?: string) => Promise<string | Buffer>
  }) => Promise<{ src: string; alt?: string }>
  /** Extra mammoth style mappings, appended to the defaults. */
  styleMap?: string[]
}

/**
 * Style mappings beyond mammoth's defaults.
 *
 * Word's built-in Title and Subtitle styles map to nothing useful otherwise, and
 * a document whose title arrives as an unstyled paragraph reads as though the
 * import lost something -- which, in the way that matters to an author, it did.
 */
const DEFAULT_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "r[style-name='Code'] => code",
]

let installed = false

const DOCX_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Register the `.docx` converter. Idempotent while installed; the disposer fully uninstalls. */
export function installDocxImport(options: DocxOptions = {}): () => void {
  if (installed) return () => undefined
  installed = true

  addAcceptedExtensions(DOCX_ACCEPT)

  const unregister = registerFileConverter(async (file) => {
    if (!/\.docx$/i.test(file.name)) return null

    let droppedImages = 0

    const convertImage = options.convertImage
      ? mammoth.images.imgElement(options.convertImage)
      : mammoth.images.imgElement(async () => {
          // Counted, not silently discarded. See the note on data: URIs above.
          droppedImages += 1
          return { src: '' }
        })

    const { value, messages } = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        styleMap: [...DEFAULT_STYLE_MAP, ...(options.styleMap ?? [])],
        // Spread conditionally: with exactOptionalPropertyTypes, passing an
        // explicit undefined is not the same as omitting the key.
        ...(convertImage ? { convertImage } : {}),
      },
    )

    const warnings = messages
      .filter((message: { type: string }) => message.type === 'warning')
      .map((message: { message: string }) => message.message)

    if (droppedImages > 0) {
      warnings.push(
        `${droppedImages} image${droppedImages === 1 ? '' : 's'} could not be imported. ` +
          'Word embeds images in the file; add them to the page separately, or ' +
          'configure an image handler on this site.',
      )
    }

    return { html: value, warnings }
  })

  return () => {
    unregister()
    removeAcceptedExtensions(DOCX_ACCEPT)
    installed = false
  }
}

export { mammoth }
