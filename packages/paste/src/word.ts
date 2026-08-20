/**
 * Microsoft Word paste normalizer.
 *
 * Word does not emit lists. It emits a flat run of paragraphs that merely
 * *look* like a list, with the real structure hidden in a proprietary CSS
 * property and the bullet glyph baked in as literal text:
 *
 *   <p class="MsoListParagraphCxSpFirst"
 *      style="text-indent:-.25in;mso-list:l0 level1 lfo1">
 *     <!--[if !supportLists]-->
 *     <span style="font-family:Symbol">·<span style="font:7.0pt">&nbsp; </span></span>
 *     <!--[endif]-->
 *     Revenue up 12%<o:p></o:p>
 *   </p>
 *
 * Reconstructing real nested `<ul>`/`<ol>` from that is, commercially, the
 * single most valuable piece of code in this project: Word paste fidelity is
 * the main reason organizations pay for a rich text editor. Get it wrong and
 * every pasted list arrives as a wall of paragraphs with stray `·` characters
 * that the author has to clean by hand, forever.
 *
 * The signals we read:
 *   mso-list: l0 level2 lfo1
 *             ^^          list identity -- distinguishes adjacent lists
 *                ^^^^^^   nesting depth, 1-based
 *
 * Ordered versus unordered is decided by the *marker text*, because Word does
 * not say. `1.` `a)` `iv.` are ordered; `·` `o` are Symbol and Courier
 * bullets. The marker is then deleted, since a real `<li>` renders its own.
 */

import {
  collapseBareSpans,
  dropEmptyBlocks,
  extractSemantics,
  stripAllStyles,
} from './clean.js'
import { safeLang } from '@openleaf-editor/content-policy/css'
import {
  parseFragment,
  parseStyle,
  plainText,
  resolveDocument,
  stripComments,
  unwrap,
} from './dom.js'

/** Namespaced junk Word emits: <o:p>, <w:sdt>, <m:oMath>, <v:shape>, <st1:place>. */
const XML_PREFIXES = /^(o|w|m|v|st\d*|x):/i

/** Presentational attributes Word sprays over ordinary text. */
const PRESENTATIONAL_ATTRS = ['align', 'valign', 'width', 'height'] as const

/**
 * Elements where those same attributes are structure rather than noise.
 *
 * `packages/core/src/tables.ts` keeps `width`, `height`, `align` and `valign`
 * on tables and cells deliberately -- "they are how HTML expressed table
 * styling for fifteen years... and dropping them changes how a page renders" --
 * and core's `iframe`, `video` and `img` nodes model `width` and `height` as
 * real attributes. Stripping them here means core never gets the chance: a
 * pasted Word table arrives with every column the same width, which is one of
 * the first things an author notices and one of the two reasons this package
 * exists.
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
 * A marker is ordered when it ends in a delimiter after a number, letter or
 * roman numeral. A bare `o` (Word's level-2 Courier bullet) has no delimiter
 * and so correctly reads as unordered.
 */
const ORDERED_MARKER = /^\s*[([]?\s*(\d+|[a-z]|[ivxlcdm]+)\s*[.)\]]/i

interface ListInfo {
  el: Element
  listId: string
  level: number
  ordered: boolean
  /**
   * Whether a bullet or number glyph was actually found.
   *
   * `ordered` is read off the marker text, so a list paragraph that has no
   * marker -- Word's continuation paragraph, a second paragraph inside one
   * item -- reads as unordered for want of anywhere else to get an answer.
   * That is fine while the flag is only used to pick a list type, and not fine
   * for deciding that the list type CHANGED, which is why the two are
   * separate.
   */
  hasMarker: boolean
  start: number | null
  markerNodes: Node[]
}

/**
 * Locate the bullet or number glyph without removing it yet.
 *
 * Word marks it two different ways depending on version: a span carrying
 * `mso-list:Ignore`, or a range fenced by `[if !supportLists]` conditional
 * comments. Both appear in the wild, so both are handled.
 */
function findMarker(p: Element): { text: string; nodes: Node[] } {
  for (const span of Array.from(p.querySelectorAll('span'))) {
    if (/mso-list\s*:\s*Ignore/i.test(span.getAttribute('style') ?? '')) {
      return { text: plainText(span), nodes: [span] }
    }
  }

  const kids = Array.from(p.childNodes)
  let open = -1
  let close = -1
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]!
    if (node.nodeType !== 8) continue
    const data = (node as Comment).data
    if (open < 0 && /\[if\s*!supportLists\]/i.test(data)) open = i
    else if (open >= 0 && close < 0 && /\[endif\]/i.test(data)) close = i
  }
  if (open >= 0 && close > open) {
    const nodes = kids.slice(open, close + 1)
    // Exclude the comment nodes themselves from the marker text. A comment's
    // textContent is its DATA, so including them makes the marker read as
    // "[if !supportLists]1. [endif]" -- and the leading bracket plus the `i`
    // of `if` then satisfy the ordered-marker pattern's optional-bracket and
    // letter branches, so every numbered list silently became a bullet list.
    const text = nodes
      .filter((node) => node.nodeType !== 8)
      .map(plainText)
      .join('')
    return { text, nodes }
  }

  return { text: '', nodes: [] }
}

/**
 * Memo for `analyze`.
 *
 * `reconstructLists` asks about every child twice -- once on the way down the
 * recursion, once in the main loop -- and the answer involves a
 * `querySelectorAll('span')` over the whole subtree. The result depends only on
 * the element's own `mso-list` style and its marker, neither of which changes
 * between the two questions: an element that becomes a list item is consumed by
 * `buildNested` and never asked about again.
 */
const analyzed = new WeakMap<Element, ListInfo | null>()

function analyze(el: Element): ListInfo | null {
  if (analyzed.has(el)) return analyzed.get(el) ?? null
  const info = readListInfo(el)
  analyzed.set(el, info)
  return info
}

/** Read Word's list metadata off a paragraph, or null if it is not a list item. */
function readListInfo(el: Element): ListInfo | null {
  const style = parseStyle(el)
  const msoList = style.get('mso-list')
  // `class="MsoListParagraph"` alone is not sufficient: Word applies it to
  // indented non-list paragraphs too. The mso-list property is the real signal.
  if (!msoList) return null

  const listId = /\b(l\d+)\b/i.exec(msoList)?.[1]?.toLowerCase() ?? 'l0'
  const level = Number.parseInt(/\blevel(\d+)\b/i.exec(msoList)?.[1] ?? '1', 10) || 1

  const marker = findMarker(el)
  const ordered = ORDERED_MARKER.test(marker.text)
  const startMatch = ordered ? /\d+/.exec(marker.text) : null

  return {
    el,
    listId,
    level,
    ordered,
    hasMarker: marker.text.trim() !== '',
    start: startMatch ? Number.parseInt(startMatch[0], 10) : null,
    markerNodes: marker.nodes,
  }
}

/**
 * Build nested lists from a consecutive run of Word list paragraphs.
 *
 * Standard stack algorithm over the level numbers. A deeper level nests
 * inside the *last `<li>`* of the current list rather than as a sibling,
 * which is what produces `<li><p>x</p><ul>...</ul></li>` -- the shape the
 * OpenLeaf schema requires for list items.
 */
function buildNested(run: ListInfo[], doc: Document): Element {
  const root = doc.createElement(run[0]!.ordered ? 'ol' : 'ul')
  if (run[0]!.ordered && run[0]!.start !== null && run[0]!.start !== 1) {
    root.setAttribute('start', String(run[0]!.start))
  }

  const stack: Array<{ level: number; ordered: boolean; list: Element }> = [
    { level: run[0]!.level, ordered: run[0]!.ordered, list: root },
  ]

  for (const item of run) {
    // Drop the marker glyph: a real <li> supplies its own.
    for (const node of item.markerNodes) node.parentNode?.removeChild(node)

    while (stack.length > 1 && stack[stack.length - 1]!.level > item.level) stack.pop()

    let top = stack[stack.length - 1]!

    if (item.level > top.level) {
      const nested = doc.createElement(item.ordered ? 'ol' : 'ul')
      if (item.ordered && item.start !== null && item.start !== 1) {
        nested.setAttribute('start', String(item.start))
      }
      const host = top.list.lastElementChild ?? top.list.appendChild(doc.createElement('li'))
      host.appendChild(nested)
      stack.push({ level: item.level, ordered: item.ordered, list: nested })
      top = stack[stack.length - 1]!
    } else if (item.ordered !== top.ordered && stack.length > 1) {
      // The list type changed at the same depth, so it is a different list.
      stack.pop()
      const parent = stack[stack.length - 1]!
      const sibling = doc.createElement(item.ordered ? 'ol' : 'ul')
      if (item.ordered && item.start !== null && item.start !== 1) {
        sibling.setAttribute('start', String(item.start))
      }
      const host = parent.list.lastElementChild ?? parent.list
      host.appendChild(sibling)
      stack.push({ level: item.level, ordered: item.ordered, list: sibling })
      top = stack[stack.length - 1]!
    }

    const li = doc.createElement('li')
    const para = doc.createElement('p')
    while (item.el.firstChild) para.appendChild(item.el.firstChild)
    li.appendChild(para)
    top.list.appendChild(li)
  }

  return root
}

/** Replace runs of Word list paragraphs with real nested lists. */
function reconstructLists(container: Element, doc: Document): void {
  // Word wraps the body in <div class="WordSection1">. The algorithm only
  // sees direct children, so without this the whole paste becomes one
  // attributed wrapper and the lists inside it are never reconstructed.
  for (const child of Array.from(container.children)) {
    if (!analyze(child)) reconstructLists(child, doc)
  }

  let children = Array.from(container.children)
  let i = 0

  while (i < children.length) {
    const first = analyze(children[i]!)
    if (!first) {
      i += 1
      continue
    }

    const run: ListInfo[] = [first]
    let j = i + 1
    while (j < children.length) {
      const next = analyze(children[j]!)
      // A change of list identity at the top level starts a new list rather
      // than continuing this one.
      if (!next) break
      if (next.listId !== first.listId && next.level === 1) break
      // So does a change of marker type at the top level. `buildNested` can
      // only switch between <ul> and <ol> below the root, so a run that starts
      // with a bullet and continues with numbers would otherwise put the
      // numbered items in the <ul> -- the type change is the one signal Word
      // gives that these are two lists.
      //
      // Both items must actually HAVE a marker. A continuation paragraph has
      // none and so reads as unordered, and splitting on that would tear a
      // numbered list into three lists around every paragraph of trailing
      // prose inside an item -- trading a rare cosmetic bug for a common
      // structural one, in the code this package exists for.
      if (
        next.level === 1 &&
        first.level === 1 &&
        next.hasMarker &&
        first.hasMarker &&
        next.ordered !== first.ordered
      ) {
        break
      }
      run.push(next)
      j += 1
    }

    const list = buildNested(run, doc)
    container.insertBefore(list, run[0]!.el)
    for (const item of run) item.el.remove()

    children = Array.from(container.children)
    i = children.indexOf(list) + 1
  }
}

/**
 * Keep the language markings that mean something and drop the ones that do not.
 *
 * Word stamps `lang` on more or less every run it emits, so the obvious move --
 * the one this file used to make -- is to delete all of it. That also deletes
 * the author's marking on quoted foreign text, which `packages/core`'s
 * `language` mark models precisely (`span[lang]`, validated with `safeLang`) so
 * that it survives, and which is what tells a screen reader to change
 * pronunciation. Deleting it here means the schema never sees it.
 *
 * What separates the two is repetition. The language Word repeats across the
 * paste is the document's own, and saying it again on every span is noise; a
 * value that appears against that background is a deliberate contrast. So:
 *
 *   - a value `safeLang` does not accept is not a language tag, and goes;
 *   - a value that only repeats an ancestor's is redundant, and goes;
 *   - the value carried by the most elements, when more than one carries it,
 *     is the document language, and goes;
 *   - anything left is the author marking a quotation, and stays.
 *
 * A single `lang` in a short paste therefore survives -- there is no repetition
 * to mark it as boilerplate, and keeping one correct attribute is a far smaller
 * cost than dropping a real one.
 */
function normalizeLanguage(container: Element): void {
  const kept: Array<{ el: Element; lang: string }> = []
  const counts = new Map<string, number>()

  for (const el of Array.from(container.querySelectorAll('*'))) {
    // `xml:lang` is the XHTML spelling of the same thing and nothing
    // downstream reads it. Fold it onto `lang` rather than dropping both.
    const xml = el.getAttribute('xml:lang')
    if (xml !== null) {
      el.removeAttribute('xml:lang')
      if (!el.hasAttribute('lang')) el.setAttribute('lang', xml)
    }

    const raw = el.getAttribute('lang')
    if (raw === null) continue

    const lang = safeLang(raw)
    const ancestor = safeLang(el.parentElement?.closest('[lang]')?.getAttribute('lang'))
    // A marking on an element with no text of its own applies to nothing.
    if (!lang || plainText(el).trim() === '' || lang.toLowerCase() === ancestor?.toLowerCase()) {
      el.removeAttribute('lang')
      continue
    }

    el.setAttribute('lang', lang)
    kept.push({ el, lang })
    const key = lang.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let dominant: string | null = null
  let best = 1
  for (const [lang, count] of counts) {
    if (count > best) {
      dominant = lang
      best = count
    } else if (count === best) {
      // Two languages used equally often: neither is the background, so keep
      // both rather than guess which one the author meant as the contrast.
      dominant = null
    }
  }
  if (dominant === null) return

  for (const { el, lang } of kept) {
    if (lang.toLowerCase() === dominant) el.removeAttribute('lang')
  }
}

/** Remove Word's proprietary elements, classes, attributes and styles. */
function stripJunk(container: Element): void {
  // Before the attribute sweep below, and before bare spans are collapsed: a
  // span that keeps its `lang` is no longer bare.
  normalizeLanguage(container)

  for (const el of Array.from(container.querySelectorAll('*'))) {
    // <style> and <xml> blocks carry Word's entire list definition table.
    if (el.nodeName === 'STYLE' || el.nodeName === 'XML' || el.nodeName === 'LINK') {
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
        .filter((c) => c && !/^Mso/i.test(c) && !/^WordSection/i.test(c))
      if (kept.length) el.setAttribute('class', kept.join(' '))
      else el.removeAttribute('class')
    }

    if (el.nodeName !== 'IMG' && !STRUCTURAL_ATTR_ELEMENTS.has(el.nodeName)) {
      for (const attr of PRESENTATIONAL_ATTRS) el.removeAttribute(attr)
    }
  }

  stripAllStyles(container)
  collapseBareSpans(container)
  // Paragraphs that held nothing but an <o:p> marker.
  dropEmptyBlocks(container, ['p'])
}

/** True when this HTML looks like it came from Microsoft Word or Outlook. */
export function looksLikeWord(html: string): boolean {
  return /mso-|urn:schemas-microsoft-com|class="?Mso|<o:p|<w:|WordDocument/i.test(html)
}

export function normalizeWord(html: string, explicitDocument?: Document): string {
  const doc = resolveDocument(explicitDocument)
  const container = parseFragment(html, doc)

  // Lists first: the algorithm reads conditional comments and mso- styles
  // that the later passes delete.
  reconstructLists(container, doc)
  extractSemantics(container, doc)
  stripComments(container)
  stripJunk(container)

  return container.innerHTML
}
