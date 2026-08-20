import { Slice } from 'prosemirror-model'
import type { Command } from 'prosemirror-state'
import { canInsertNode, markIn, nodeIn } from './command-helpers.js'
import { safeAllowList, safeEmbedSrc } from './embed.js'
import { parseHtml } from './html.js'
import { IMAGE_ALIGN_CLASSES, safeClassList, safeId, type ImageAlign } from './tokens.js'
import { isSafeUrl } from './url.js'

const canInsert = canInsertNode

/* ------------------------------------------------------------------ *
 * Links and images
 * ------------------------------------------------------------------ */

export interface LinkAttrs {
  href: string
  title?: string | null
  target?: string | null
  rel?: string | null
  id?: string | null
}

/**
 * Apply or update a link across the selection.
 *
 * Removes any existing link first: without that, updating a link that only
 * partially overlaps the selection leaves two adjacent links with different
 * hrefs, which looks fine and is wrong.
 */
export function setLink(attrs: LinkAttrs): Command {
  return (state, dispatch) => {
    const type = markIn(state, 'link')
    if (!type) return false
    if (state.selection.empty) return false
    if (dispatch) {
      const tr = state.tr
      const mark = type.create({
        href: attrs.href,
        title: attrs.title ?? null,
        target: attrs.target ?? null,
        rel: attrs.rel ?? null,
        id: safeId(attrs.id),
      })
      // Per range, not across `from`..`to`: those are one range's bounds, so a
      // table cell selection linked a single cell. See `selectedRanges` in
      // commands.ts for the full account.
      for (const range of state.selection.ranges) {
        tr.removeMark(range.$from.pos, range.$to.pos, type)
        tr.addMark(range.$from.pos, range.$to.pos, mark)
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const unsetLink: Command = (state, dispatch) => {
  const type = markIn(state, 'link')
  if (!type) return false
  const ranges = state.selection.ranges
  if (state.selection.empty) return false
  if (!ranges.some((r) => state.doc.rangeHasMark(r.$from.pos, r.$to.pos, type))) return false
  if (dispatch) {
    const tr = state.tr
    for (const range of ranges) tr.removeMark(range.$from.pos, range.$to.pos, type)
    dispatch(tr.scrollIntoView())
  }
  return true
}

export interface ImageAttrs {
  src: string
  alt?: string | null
  title?: string | null
  width?: string | null
  height?: string | null
  align?: ImageAlign | null
  className?: string | null
  /**
   * When present, the image is wrapped in `<figure>` with this caption.
   * An empty string still wraps: a figure with no caption text is how an
   * author says "this will have a caption" without writing one yet.
   */
  caption?: string | null
}

export function insertImage(attrs: ImageAttrs): Command {
  return (state, dispatch) => {
    const imageType = nodeIn(state, 'image')
    if (!imageType) return false
    const image = imageType.create({
      src: attrs.src,
      // An absent alt and alt="" mean different things to a screen reader:
      // "undescribed" versus "decorative". Never collapse them.
      alt: attrs.alt ?? null,
      title: attrs.title ?? null,
      width: attrs.width ?? null,
      height: attrs.height ?? null,
      align: attrs.align ?? null,
      className: safeClassList(attrs.className ?? null, IMAGE_ALIGN_CLASSES),
    })

    if (attrs.caption !== undefined && attrs.caption !== null) {
      if (!canInsert(state, 'figure')) return false
      const figureType = nodeIn(state, 'figure')
      const captionType = nodeIn(state, 'figcaption')
      if (!figureType || !captionType) return false
      if (dispatch) {
        const caption =
          attrs.caption === '' ? captionType.create() : captionType.create(null, state.schema.text(attrs.caption))
        dispatch(state.tr.replaceSelectionWith(figureType.create(null, [image, caption])).scrollIntoView())
      }
      return true
    }

    if (!canInsert(state, 'image')) return false
    if (dispatch) dispatch(state.tr.replaceSelectionWith(image).scrollIntoView())
    return true
  }
}

export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (text === '') return false
    if (dispatch) dispatch(state.tr.insertText(text).scrollIntoView())
    return true
  }
}

export const insertNonBreakingSpace: Command = insertText('\u00a0')

export const insertPageBreak: Command = (state, dispatch) => {
  if (!canInsert(state, 'page_break')) return false
  if (dispatch) {
    const type = nodeIn(state, 'page_break')
    if (!type) return false
    dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView())
  }
  return true
}

export function insertNamedAnchor(id: string): Command {
  return (state, dispatch) => {
    const value = safeId(id)
    if (!value || !canInsert(state, 'named_anchor')) return false
    if (dispatch) {
      const type = nodeIn(state, 'named_anchor')
      if (!type) return false
      dispatch(state.tr.replaceSelectionWith(type.create({ id: value })).scrollIntoView())
    }
    return true
  }
}

export function setHeadingId(id: string | null): Command {
  return (state, dispatch) => {
    const type = nodeIn(state, 'heading')
    if (!type) return false
    const { $from } = state.selection
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type !== type) continue
      if (dispatch) {
        dispatch(
          state.tr
            .setNodeMarkup($from.before(depth), undefined, { ...node.attrs, id: safeId(id) })
            .scrollIntoView(),
        )
      }
      return true
    }
    return false
  }
}

export function insertDetails(summaryText = 'Details'): Command {
  return (state, dispatch) => {
    if (!canInsert(state, 'details')) return false
    const detailsType = nodeIn(state, 'details')
    const summaryType = nodeIn(state, 'summary')
    const paragraphType = nodeIn(state, 'paragraph')
    if (!detailsType || !summaryType || !paragraphType) return false
    if (dispatch) {
      const body = paragraphType.createAndFill()
      if (!body) return false
      const node = detailsType.create(null, [
        summaryType.create(null, summaryText === '' ? undefined : state.schema.text(summaryText)),
        body,
      ])
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
    }
    return true
  }
}

export interface MediaAttrs {
  src: string
  title?: string | null
  width?: string | null
  height?: string | null
  controls?: boolean
  poster?: string | null
  allow?: string | null
  allowfullscreen?: boolean
}

export function insertVideo(attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    if (!isSafeUrl(attrs.src) || !canInsert(state, 'video')) return false
    if (dispatch) {
      const type = nodeIn(state, 'video')
      if (!type) return false
      dispatch(
        state.tr
          .replaceSelectionWith(
            type.create({
              src: attrs.src,
              title: attrs.title ?? null,
              width: attrs.width ?? null,
              height: attrs.height ?? null,
              controls: attrs.controls !== false,
              poster: attrs.poster && isSafeUrl(attrs.poster) ? attrs.poster : null,
            }),
          )
          .scrollIntoView(),
      )
    }
    return true
  }
}

export function insertAudio(attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    if (!isSafeUrl(attrs.src) || !canInsert(state, 'audio')) return false
    if (dispatch) {
      const type = nodeIn(state, 'audio')
      if (!type) return false
      dispatch(
        state.tr
          .replaceSelectionWith(
            type.create({
              src: attrs.src,
              title: attrs.title ?? null,
              controls: attrs.controls !== false,
            }),
          )
          .scrollIntoView(),
      )
    }
    return true
  }
}

export function insertIframe(attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    const src = safeEmbedSrc(attrs.src)
    if (!src || !canInsert(state, 'iframe')) return false
    if (dispatch) {
      const type = nodeIn(state, 'iframe')
      if (!type) return false
      dispatch(
        state.tr
          .replaceSelectionWith(
            type.create({
              src,
              title: attrs.title ?? null,
              width: attrs.width ?? null,
              height: attrs.height ?? null,
              allow: safeAllowList(attrs.allow),
              allowfullscreen: attrs.allowfullscreen !== false,
            }),
          )
          .scrollIntoView(),
      )
    }
    return true
  }
}

/**
 * Parse HTML against the live schema and insert it.
 *
 * Used by the snippet picker. The HTML still goes through the same parse
 * pipeline as stored content, so a snippet cannot smuggle in a `<script>`.
 */
export function insertHtml(html: string): Command {
  return (state, dispatch) => {
    const parsed = parseHtml(html, { schema: state.schema })
    if (parsed.childCount === 0) return false
    if (dispatch) {
      dispatch(state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView())
    }
    return true
  }
}
