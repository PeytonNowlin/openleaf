/**
 * File converters, and the seam for the ones this package does not ship.
 *
 * ## What is built in, and why the split falls there
 *
 * HTML and plain text convert with no dependency at all, because the paste
 * pipeline already does the hard part. That matters more than it sounds: Word's
 * own **Save as Web Page** produces exactly the `mso-list` markup
 * `@openleaf/paste` was written to reconstruct. So "import an HTML file" already
 * covers a real share of "import a Word document", for zero bytes.
 *
 * `.docx` is a different problem -- a ZIP of OOXML, not HTML -- and converting it
 * properly is somebody else's solved problem. Measured before deciding:
 *
 *     mammoth (browser build)   492 KB min   122.3 KB gzip
 *
 * That is larger than the entire editor. Forcing it on every integrator who
 * wants to import an HTML file would be the wrong trade, and writing a worse
 * OOXML converter to avoid it would be a much worse one. So `.docx` arrives
 * through a seam, with a documented five-line recipe -- the same shape as
 * `setHighlighter` in the highlighting plugin and the sanitizer configuration in
 * `@openleaf/sanitize`. Ship the integration point, not the reimplementation.
 *
 * ## On PDF
 *
 * There is deliberately no PDF converter, and the seam is not an invitation to
 * add one casually. PDF is a *layout* format: it stores positioned glyphs, not
 * paragraphs. There is no heading, no list, and no table in a PDF -- only text
 * that happens to be arranged like one. Every converter therefore guesses, and
 * the guesses fail in the same ways: line breaks become paragraph breaks,
 * headings become bold paragraphs or nothing, multi-column layouts interleave,
 * and tables arrive as a run of unrelated numbers.
 *
 * A feature called "import" that reliably destroys structure is the failure this
 * project exists to avoid, with the user's own permission attached. If you need
 * the words out of a PDF, register a converter that says *extract text* and
 * makes no structural claim.
 */

import { normalizePastedHtml } from '@openleaf/paste'

export interface ConversionResult {
  /** HTML to insert. Runs through the paste normalizer before parsing. */
  html: string
  /**
   * Things the conversion could not carry, in plain language.
   *
   * Surfaced to the author rather than logged. Someone importing a document
   * needs to know that its images did not come with it *now*, while they still
   * have the original open.
   */
  warnings?: string[]
}

/** Converts one file. Return null to decline; the next converter is tried. */
export type FileConverter = (file: File) => Promise<ConversionResult | null>

const converters: FileConverter[] = []

/**
 * Register a converter, tried before the built-in ones.
 *
 * ```ts
 * import mammoth from 'mammoth/mammoth.browser.js'
 * import { registerFileConverter } from '@openleaf/plugins-import'
 *
 * registerFileConverter(async (file) => {
 *   if (!file.name.toLowerCase().endsWith('.docx')) return null
 *   const { value, messages } = await mammoth.convertToHtml({
 *     arrayBuffer: await file.arrayBuffer(),
 *   })
 *   return {
 *     html: value,
 *     warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message),
 *   }
 * })
 * ```
 */
export function registerFileConverter(converter: FileConverter): () => void {
  converters.unshift(converter)
  return () => {
    const index = converters.indexOf(converter)
    if (index >= 0) converters.splice(index, 1)
  }
}

/** Testing seam. Not public API. */
export function clearFileConverters(): void {
  converters.length = 0
}

const HTML_EXTENSIONS = /\.(x?html?|htm)$/i
const TEXT_EXTENSIONS = /\.(txt|md|markdown)$/i

function isHtml(file: File): boolean {
  return HTML_EXTENSIONS.test(file.name) || file.type === 'text/html'
}

function isText(file: File): boolean {
  return TEXT_EXTENSIONS.test(file.name) || file.type === 'text/plain'
}

/**
 * Take the body of a full HTML document.
 *
 * A file saved from a browser or from Word is a whole document -- `<head>`,
 * `<style>`, `<meta>` and all. Parsing the lot would work, because the
 * preservation layer drops `<style>` and `<meta>` on security grounds, but
 * taking the body is clearer about intent and avoids importing a page title as
 * a heading.
 */
export function extractBody(html: string, doc: Document): string {
  if (!/<body[\s>]/i.test(html)) return html
  const parsed = new doc.defaultView!.DOMParser().parseFromString(html, 'text/html')
  return parsed.body.innerHTML
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Plain text becomes paragraphs on blank lines, which is what authors expect. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return blocks
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeText(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Convert a file to HTML ready for insertion.
 *
 * Registered converters are tried first, then the built-ins. Returns null when
 * nothing can handle the file, so the caller can say which formats it does
 * accept rather than failing silently.
 */
export async function convertFile(file: File, doc: Document): Promise<ConversionResult | null> {
  for (const converter of converters) {
    const result = await converter(file)
    if (result) {
      return { ...result, html: normalizePastedHtml(extractBody(result.html, doc), doc) }
    }
  }

  if (isHtml(file)) {
    const raw = await file.text()
    // Through the paste normalizer, because a file saved from Word is the same
    // mso-list markup a Word paste produces -- and reconstructing its lists is
    // the single most valuable thing this import does.
    return { html: normalizePastedHtml(extractBody(raw, doc), doc) }
  }

  if (isText(file)) {
    return { html: textToHtml(await file.text()) }
  }

  return null
}

/** Extensions the built-in converters accept, for a file picker. */
export const BUILT_IN_ACCEPT = '.html,.htm,.xhtml,.txt,.md,text/html,text/plain'
