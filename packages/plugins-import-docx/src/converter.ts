/**
 * The `.docx` converter itself, with mammoth passed in rather than imported.
 *
 * `index.ts` hands it `mammoth/mammoth.browser.js`, which is the build that
 * ships. That file cannot run under Node -- it expects a DOM and a browser
 * unzip -- so a test importing this package could never reach the converter,
 * and the suite grew a hand-written copy of it instead. A copy of the code
 * under test tests nothing: the copy kept converting happily while the real one
 * emitted a broken-image placeholder for every chart in the document.
 *
 * So the dependency is a parameter. The test supplies mammoth's Node build and
 * exercises this file; the bundle supplies the browser build and ships it.
 */

import { isUploadableImageType, type FileConverter } from '@openleaf-editor/plugins-import'
import type MammothDefault from 'mammoth'
import { assertImportableDocx, DEFAULT_DOCX_LIMITS, type DocxLimits } from './guards.js'

/** One embedded image, as mammoth hands it over. */
export interface DocxImage {
  contentType: string
  read: (encoding?: string) => Promise<string | Buffer>
}

/** mammoth's opaque brand for an image converter. */
type ImageConverterOption = NonNullable<
  NonNullable<Parameters<(typeof MammothDefault)['convertToHtml']>[1]>['convertImage']
>

/**
 * As much of mammoth as this file uses.
 *
 * Written out rather than `Pick`ed whole: the browser build's declaration covers
 * only what that build exposes, and naming the two members this file calls is
 * the honest statement of what a substitute has to provide.
 */
export interface DocxMammoth {
  convertToHtml: (typeof MammothDefault)['convertToHtml']
  images: {
    imgElement: (
      convert: (image: DocxImage) => Promise<{ src: string; alt?: string }>,
    ) => ImageConverterOption
  }
}

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
  /**
   * Size ceilings for a single `.docx`. Merged over `DEFAULT_DOCX_LIMITS`.
   *
   * A ZIP expands, and this one arrives from whoever sent the document. See
   * `guards.ts` for the measurement that put these here.
   */
  limits?: Partial<DocxLimits>
}

/**
 * Style mappings beyond mammoth's defaults.
 *
 * Word's built-in Title and Subtitle styles map to nothing useful otherwise, and
 * a document whose title arrives as an unstyled paragraph reads as though the
 * import lost something -- which, in the way that matters to an author, it did.
 */
export const DEFAULT_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "r[style-name='Code'] => code",
]

type RawImageConverter = (image: DocxImage, messages: unknown[]) => Promise<unknown[]>

/*
 * mammoth types an image converter as an opaque brand, but at runtime it is
 * simply a function from an image to the HTML nodes to emit -- and returning
 * *none* drops the image, which is exactly what mammoth itself does when a
 * converter throws. `mammoth.images.imgElement` cannot express that: it always
 * builds an `<img>`, so "images are dropped and counted" shipped as a polite
 * warning *plus* a row of broken-image placeholders, one per chart. These two
 * casts are the whole of the workaround; the brand carries no runtime meaning.
 */
const asOption = (fn: RawImageConverter): ImageConverterOption =>
  fn as unknown as ImageConverterOption
const asRaw = (option: ImageConverterOption): RawImageConverter =>
  option as unknown as RawImageConverter

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Build the converter `installDocxImport` registers. */
export function createDocxConverter(
  mammoth: DocxMammoth,
  options: DocxOptions = {},
): FileConverter {
  const limits: DocxLimits = { ...DEFAULT_DOCX_LIMITS, ...options.limits }
  const embed = options.convertImage ? asRaw(mammoth.images.imgElement(options.convertImage)) : null

  return async (file) => {
    if (!/\.docx$/i.test(file.name)) return null

    // Throws a sentence the author can read; `importFileIntoView` turns it into
    // "<name> could not be read: ...". Returns the bytes so the file is read
    // once rather than twice -- and so what was checked is what is converted.
    const arrayBuffer = await assertImportableDocx(file, limits)

    let droppedImages = 0
    let refusedImages = 0

    const convertImage = asOption(async (image, messages) => {
      /*
       * The same rule the image drop handler applies to a dropped file. An SVG
       * is a document, not a bitmap: it can carry script, and the same file
       * served back or opened directly is stored XSS. This content type comes
       * out of the .docx -- which is to say from whoever sent it -- so it is
       * exactly as trustworthy as a dropped file's type, and gets exactly the
       * same treatment.
       */
      if (!isUploadableImageType(image.contentType)) {
        refusedImages += 1
        return []
      }
      if (!embed) {
        // Counted, and actually dropped. See the note on data: URIs in index.ts.
        droppedImages += 1
        return []
      }
      return embed(image, messages)
    })

    const { value, messages } = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap: [...DEFAULT_STYLE_MAP, ...(options.styleMap ?? [])],
        convertImage,
      },
    )

    const warnings = messages
      .filter((message: { type: string }) => message.type === 'warning')
      .map((message: { message: string }) => message.message)

    if (droppedImages > 0) {
      warnings.push(
        `${droppedImages} ${plural(droppedImages, 'image', 'images')} could not be imported. ` +
          'Word embeds images in the file; add them to the page separately, or ' +
          'configure an image handler on this site.',
      )
    }

    if (refusedImages > 0) {
      warnings.push(
        `${refusedImages} ${plural(refusedImages, 'image was', 'images were')} left out: ` +
          'the editor will not embed an SVG, or anything that is not an image at all.',
      )
    }

    return { html: value, warnings }
  }
}
