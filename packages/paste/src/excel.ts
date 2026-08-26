/**
 * Microsoft Excel paste normalizer.
 *
 * Excel's HTML clipboard is Microsoft Office markup. It is full of `mso-`
 * properties, `MsoNormalTable`, and `urn:schemas-microsoft-com`, so
 * {@link looksLikeWord} matches it. It is not Word's fake-list protocol. It is
 * a real `<table>` with row/column dimensions, number formats, and merged
 * cells.
 *
 * Routing that HTML through {@link normalizeWord} runs `reconstructLists`
 * first, because Word's list algorithm needs `mso-list` before later passes
 * delete it. A spreadsheet cell that happens to carry that property -- or a
 * paragraph Excel emits around the grid -- is then lifted into a `<ul>`/`<ol>`,
 * which is how a copied range arrives as a list. This file exists so that does
 * not happen: the Excel path never reconstructs lists.
 *
 * Number-format preservation and CSS column widths that live only in
 * `style="width:72pt"` are deliberately out of scope here. The schema already
 * keeps HTML `width` / `colspan` / `rowspan` on tables and cells; that is the
 * structural bargain, and it is the one this normalizer must not lose. A later
 * change that wants to keep `mso-number-format` has a source of its own to
 * hang it on, rather than a Word pass that was never written for cells.
 */

import {
  collapseBareSpans,
  dropEmptyBlocks,
  extractSemantics,
  stripAllStyles,
} from './clean.js'
import { looksLikeGoogleDocs } from './gdocs.js'
import {
  parseFragment,
  plainText,
  resolveDocument,
  serializeFragment,
  stripComments,
  unwrap,
  type Container,
} from './dom.js'

/**
 * Envelope-level Excel clipboard, not a cell that merely looks numeric.
 *
 * `ProgId=Excel.Sheet`, the Excel xmlns, and a Generator that names Microsoft
 * Excel are how Excel labels the clipboard document. `x:num` / `x:str` /
 * `x:fmla` are how it labels cells in a fragment that has already lost its
 * `<head>`. Either is enough.
 *
 * `mso-number-format` and `class="xl65"` are not. Word tables of numbers carry
 * the CSS property, and a Word document that embeds a spreadsheet object
 * carries the cell classes, and in both cases the surrounding paragraphs still
 * need Word's list reconstruction. A false positive here silently degrades
 * Word paste, which is the more common case.
 */
const EXCEL_ENVELOPE =
  /\bExcel\.Sheet\b|xmlns:x\s*=\s*["']?urn:schemas-microsoft-com:office:excel|\bMicrosoft Excel\s+\d|\bx:(?:num|str|fmla)\b/i

/**
 * A Word document envelope, including a Word paste that happens to contain an
 * embedded spreadsheet. Any one of these means the Word path, even when an
 * Excel signal is also present.
 */
const WORD_DOCUMENT_ENVELOPE =
  /WordDocument|\bWord\.Document\b|xmlns:w\s*=|<w:|urn:schemas-microsoft-com:office:word/i

/** Namespaced junk Office emits: <o:p>, <x:ExcelWorkbook>, <w:sdt>. */
const XML_PREFIXES = /^(o|w|m|v|st\d*|x):/i

/** Presentational attributes Excel sprays over ordinary text. */
const PRESENTATIONAL_ATTRS = ['align', 'valign', 'width', 'height'] as const

/**
 * Elements where those same attributes are structure rather than noise.
 *
 * Copied from the Word normalizer for the same reason: dropping `width` on a
 * pasted table is one of the first things an author notices. Excel expresses
 * merged cells as HTML `colspan`/`rowspan`, which are not in the presentational
 * list and so survive without special pleading.
 */
const STRUCTURAL_ATTR_ELEMENTS = new Set([
  'IMG',
  'IFRAME',
  'VIDEO',
  'AUDIO',
  'EMBED',
  'OBJECT',
  'CANVAS',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'COL',
  'COLGROUP',
])

/**
 * True when this HTML is an Excel clipboard rather than Word, Outlook, or
 * Google Sheets.
 *
 * Sheets is checked first because a Sheets paste must keep using the gdocs
 * path when that signal is present -- Excel detection that fires on Sheets
 * HTML is a regression. A Word document envelope is checked next for the
 * same reason in the other direction.
 */
export function looksLikeExcel(html: string): boolean {
  if (looksLikeGoogleDocs(html)) return false
  if (WORD_DOCUMENT_ENVELOPE.test(html)) return false
  return EXCEL_ENVELOPE.test(html)
}

/** Remove Excel's proprietary envelope, classes, namespaced attributes and styles. */
function stripExcelJunk(container: Container): void {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (
      el.nodeName === 'STYLE' ||
      el.nodeName === 'XML' ||
      el.nodeName === 'LINK' ||
      el.nodeName === 'META' ||
      el.nodeName === 'TITLE'
    ) {
      el.remove()
      continue
    }
    if (XML_PREFIXES.test(el.nodeName)) {
      if (plainText(el).trim() === '') el.remove()
      else unwrap(el)
      continue
    }

    const cls = el.getAttribute('class')
    if (cls) {
      const kept = cls
        .split(/\s+/)
        .filter((c) => c && !/^Mso/i.test(c) && !/^WordSection/i.test(c) && !/^xl\d/i.test(c))
      if (kept.length) el.setAttribute('class', kept.join(' '))
      else el.removeAttribute('class')
    }

    // `x:num`, `xmlns:x`, `o:xmlns` -- bookkeeping, not structure. `colspan`
    // is un-namespaced HTML and is not touched.
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.includes(':')) el.removeAttribute(attr.name)
    }

    if (el.nodeName !== 'IMG' && !STRUCTURAL_ATTR_ELEMENTS.has(el.nodeName)) {
      for (const attr of PRESENTATIONAL_ATTRS) el.removeAttribute(attr)
    }
  }

  stripAllStyles(container)
  collapseBareSpans(container)
  dropEmptyBlocks(container, ['p'])
}

export function normalizeExcel(html: string, explicitDocument?: Document): string {
  // Inert throughout -- see parseFragment. Unlike normalizeWord, this does
  // not reconstruct lists: Excel's grid is already a table, and Word's
  // algorithm reading `mso-list` off a cell is how a copied range used to
  // arrive as a `<ul>`.
  const fragment = parseFragment(html, resolveDocument(explicitDocument))
  const { root, doc } = fragment

  extractSemantics(root, doc)
  stripComments(root)
  stripExcelJunk(root)

  return serializeFragment(fragment)
}
