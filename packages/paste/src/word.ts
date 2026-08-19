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

/** Read Word's list metadata off a paragraph, or null if it is not a list item. */
function analyze(el: Element): ListInfo | null {
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

/** Remove Word's proprietary elements, classes, attributes and styles. */
function stripJunk(container: Element): void {
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

    for (const attr of ['lang', 'xml:lang', 'align', 'valign', 'width', 'height']) {
      if (el.nodeName !== 'IMG') el.removeAttribute(attr)
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
