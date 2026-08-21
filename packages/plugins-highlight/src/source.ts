/**
 * Formatting and highlighting for the HTML source view.
 *
 * ## Why an overlay
 *
 * A `<textarea>` cannot render coloured text. The options are to replace it with
 * a `contenteditable`, which means owning caret preservation across every
 * re-render, or to put a highlighted copy exactly behind a textarea whose own
 * text is transparent. The overlay wins because the textarea keeps doing all the
 * hard parts -- caret, selection, undo, IME, spellcheck, accessibility -- and the
 * copy behind it is inert.
 *
 * The cost is that every metric affecting glyph position must match between the
 * two elements or the caret drifts away from the characters. Those are declared
 * once in `theme.ts` and inherited by both, rather than set on each.
 *
 * ## Formatting is verified, not trusted
 *
 * The editor serializes to one long line. Indenting it is worth more than
 * colouring it -- but reindenting HTML can change what it means, so the
 * reformatted text is only used when it has been *proved* to parse to the same
 * document. If the check fails the original text is shown, unformatted. A
 * formatter that cannot demonstrate it preserved the document does not get to
 * touch it.
 */

import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { formatHtml } from './format.js'
import { highlight } from './highlighter.js'

/** Events the editor element emits when the source view opens and closes. */
export const SOURCE_OPEN_EVENT = 'openleaf:source-open'
export const SOURCE_CLOSE_EVENT = 'openleaf:source-close'

export interface SourceViewDetail {
  textarea: HTMLTextAreaElement
}

const attached = new WeakMap<HTMLTextAreaElement, () => void>()

/**
 * Reformat, but only if the result provably parses to the same document.
 *
 * Returns the original text unchanged when it cannot be proved, which covers
 * every case this cannot anticipate: hand-edited markup mid-keystroke, content
 * inside a preserved atom whose internals we do not model, anything at all.
 */
export function formatIfLossless(html: string): string {
  let formatted: string
  try {
    formatted = formatHtml(html)
  } catch {
    return html
  }

  try {
    const before = serializeHtml(parseHtml(html))
    const after = serializeHtml(parseHtml(formatted))
    return before === after ? formatted : html
  } catch {
    return html
  }
}

/**
 * Above this many characters the backdrop is plain text.
 *
 * The same guard `codeblock.ts` puts on a single block, for the same reason and
 * with the same number. This file had none at all: a 261 KB document -- an
 * ordinary long article, not a pathological paste -- rebuilt roughly six
 * thousand spans inside a `white-space: pre-wrap` `<pre>` on every keystroke,
 * and the caret sits in a transparent textarea directly on top of it, so the
 * relayout is visible as the author types. Uncoloured source is a small loss;
 * a source view that stutters is not.
 */
const MAX_SOURCE_HIGHLIGHT_LENGTH = 20_000

/** Render tokens into the backdrop element. */
function paint(view: HTMLElement, source: string): void {
  view.replaceChildren()
  const doc = view.ownerDocument
  const tokens = source.length > MAX_SOURCE_HIGHLIGHT_LENGTH ? null : highlight(source, 'html')

  if (!tokens) {
    view.textContent = source
    // The trailing-newline fix below applies to the plain path too: without it
    // the backdrop is a line short of the textarea and the colours -- or here,
    // the plain text -- sit above the caret.
    if (source.endsWith('\n')) view.appendChild(doc.createTextNode(' '))
    return
  }

  for (const token of tokens) {
    if (token.type === 'text') {
      view.appendChild(doc.createTextNode(token.value))
      continue
    }
    const span = doc.createElement('span')
    span.className = `ol-t-${token.type}`
    span.textContent = token.value
    view.appendChild(span)
  }

  // A trailing newline is not rendered by the browser at the end of an element,
  // so without this the backdrop is one line shorter than the textarea and the
  // last line's colours sit above the caret.
  if (source.endsWith('\n')) view.appendChild(doc.createTextNode(' '))
}

/**
 * Attach formatting and highlighting to a source textarea.
 *
 * Returns a teardown function. Safe to call twice on the same element.
 */
export function enhanceSourceTextarea(textarea: HTMLTextAreaElement): () => void {
  const existing = attached.get(textarea)
  if (existing) return existing

  const doc = textarea.ownerDocument
  const parent = textarea.parentElement
  if (!parent) return () => undefined

  const formatted = formatIfLossless(textarea.value)
  if (formatted !== textarea.value) {
    textarea.value = formatted
    // The element syncs its bound textarea from the source box on close, and a
    // formatted document parses identically, so nothing needs re-syncing here.
  }

  const wrapper = doc.createElement('div')
  wrapper.className = 'ol-src'
  const view = doc.createElement('pre')
  view.className = 'ol-src-view'
  // Decorative: the textarea already carries the content and the accessible
  // name. Exposing a second copy would make a screen reader read it twice.
  view.setAttribute('aria-hidden', 'true')

  parent.insertBefore(wrapper, textarea)
  wrapper.append(view, textarea)

  /**
   * Repaint once per frame, however fast the author types.
   *
   * `input` fires per keystroke and the repaint is a full re-tokenize plus a
   * rebuild of every node in the backdrop. Nothing between two frames can be
   * seen, so a burst of typing coalesces into the one repaint that gets painted.
   */
  let frame = 0
  const win = doc.defaultView
  const repaintNow = (): void => {
    frame = 0
    paint(view, textarea.value)
  }
  const repaint = (): void => {
    if (!win?.requestAnimationFrame) {
      repaintNow()
      return
    }
    if (frame === 0) frame = win.requestAnimationFrame(repaintNow)
  }
  const syncScroll = (): void => {
    view.scrollTop = textarea.scrollTop
    view.scrollLeft = textarea.scrollLeft
  }

  // The first paint is synchronous: the box is about to be shown, and a frame
  // of unhighlighted source reads as a flash rather than as coalescing.
  repaintNow()
  textarea.addEventListener('input', repaint)
  textarea.addEventListener('scroll', syncScroll)

  const teardown = (): void => {
    // A queued frame outlives the listeners and would paint into a backdrop
    // that has already been taken out of the document.
    if (frame !== 0) win?.cancelAnimationFrame(frame)
    frame = 0
    textarea.removeEventListener('input', repaint)
    textarea.removeEventListener('scroll', syncScroll)
    attached.delete(textarea)
    if (wrapper.parentElement) {
      wrapper.parentElement.insertBefore(textarea, wrapper)
      wrapper.remove()
    }
  }
  attached.set(textarea, teardown)
  return teardown
}

/** Listen for source views opening anywhere in the document. */
export function watchSourceViews(root: Document | HTMLElement): () => void {
  const teardowns = new Map<HTMLTextAreaElement, () => void>()

  const onOpen = (event: Event): void => {
    const detail = (event as CustomEvent<SourceViewDetail>).detail
    if (!detail?.textarea) return
    teardowns.set(detail.textarea, enhanceSourceTextarea(detail.textarea))
  }

  const onClose = (event: Event): void => {
    const detail = (event as CustomEvent<SourceViewDetail>).detail
    if (!detail?.textarea) return
    teardowns.get(detail.textarea)?.()
    teardowns.delete(detail.textarea)
  }

  root.addEventListener(SOURCE_OPEN_EVENT, onOpen)
  root.addEventListener(SOURCE_CLOSE_EVENT, onClose)

  return () => {
    root.removeEventListener(SOURCE_OPEN_EVENT, onOpen)
    root.removeEventListener(SOURCE_CLOSE_EVENT, onClose)
    for (const teardown of teardowns.values()) teardown()
    teardowns.clear()
  }
}
