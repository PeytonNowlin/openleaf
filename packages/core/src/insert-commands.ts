import { Slice } from 'prosemirror-model'
import type { Command, EditorState } from 'prosemirror-state'
import { NodeSelection } from 'prosemirror-state'
import { canInsertNode, markIn, nodeIn } from './command-helpers.js'
import { embedSrcFor, safeAllowList, safeEmbedSrc } from './embed.js'
import { parseHtml } from './html.js'
import { serializationTarget } from './preserve.js'
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
 *
 * Declines an href the schema would refuse. The parse rule at `schema.ts:541`
 * already rejects `javascript:`, but only on the way *in* -- so without this
 * check the hostile href lives in the document, serializes into the bound
 * textarea and is submitted. It disappears on the next parse, one round trip
 * after the server stored it, which is the wrong side of the write.
 */
export function setLink(attrs: LinkAttrs): Command {
  return (state, dispatch) => {
    if (!isSafeUrl(attrs.href)) return false
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

/**
 * Insert an image, optionally wrapped in a captioned `<figure>`.
 *
 * Declines a `src` the schema would refuse, for the same reason `setLink` does:
 * the parse rule only guards the way in, so an unchecked `javascript:` src is
 * live in the document and submitted with the form before anything strips it.
 */
export function insertImage(attrs: ImageAttrs): Command {
  return (state, dispatch) => {
    if (!isSafeUrl(attrs.src)) return false
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

/**
 * One `<source>` row from the insert-media dialog.
 *
 * `type` is the MIME hint a browser uses to pick between alternatives without
 * downloading them. It is optional because a dialog cannot always know it, and
 * a `<source>` with no type is still a working source.
 */
export interface MediaSource {
  src: string
  type?: string | null
}

export interface MediaAttrs {
  /**
   * Optional, because a player may carry its addresses in `sources` instead --
   * the source-only shape `mediaAttrs` accepts on parse. One or the other must
   * be present; a player with neither has nothing to play.
   */
  src?: string | null
  title?: string | null
  width?: string | null
  height?: string | null
  /**
   * Omitted means different things on the two paths, deliberately. Inserting a
   * player with no opinion gets controls, because a player nobody can start is
   * not much of one. Updating one with no opinion changes nothing, because the
   * caller did not ask to.
   */
  controls?: boolean
  poster?: string | null
  allow?: string | null
  allowfullscreen?: boolean
  /**
   * Alternative addresses, stored as the `<source>` children of the player.
   *
   * Authoritative for `<source>` on an update: what is passed replaces what is
   * there. Other furniture -- `<track>` captions -- is carried through, so a
   * caller that cannot see them cannot delete them.
   */
  sources?: readonly MediaSource[]
}

/**
 * Build the `furniture` string for a set of alternative sources.
 *
 * Built through the DOM rather than by concatenating markup: `setAttribute`
 * escapes the value for us, so an address containing a quote cannot break out
 * of the attribute and become new markup. `appendMediaFurniture` scrubs this
 * again on the way into the document -- this is the belt, that is the braces.
 */
function mediaFurniture(
  sources: readonly MediaSource[] | undefined,
  keep: string | null = null,
): string | null {
  const doc = serializationTarget()
  let html = ''
  for (const source of sources ?? []) {
    if (!isSafeUrl(source.src)) continue
    const el = doc.createElement('source')
    el.setAttribute('src', source.src)
    const type = source.type?.trim()
    if (type) el.setAttribute('type', type)
    html += el.outerHTML
  }
  // Sources first, then the carried furniture: `<source>` before `<track>` is
  // the order the elements are specified in, and a browser picks its source by
  // walking the children in order.
  html += keep ?? ''
  return html || null
}

/**
 * The furniture an edit is not entitled to rewrite.
 *
 * `updateMedia` rebuilds the `<source>` children from what its caller hands it,
 * so anything else living in `furniture` would be deleted by a save the author
 * thought was a title change. `<track>` captions are the case that matters: a
 * dialog has no field for them, nobody notices they are gone, and the loss is
 * of the accessibility furniture specifically.
 *
 * So the non-`<source>` children are read off the node and appended unchanged.
 * They came out of `readMediaFurniture`, which already scrubbed them, and
 * `appendMediaFurniture` scrubs them again on the way back in.
 */
function carriedFurniture(furniture: unknown): string | null {
  if (typeof furniture !== 'string' || furniture === '') return null
  const doc = serializationTarget()
  const tpl = doc.createElement('template')
  tpl.innerHTML = furniture
  let html = ''
  for (const el of Array.from((tpl as HTMLTemplateElement).content.children)) {
    if (el.nodeName.toLowerCase() === 'source') continue
    html += el.outerHTML
  }
  return html || null
}

/**
 * Does this player have anything to play?
 *
 * The schema declines a `<video>` with neither `src` nor sources, so a command
 * that builds one would insert a node the next parse throws away.
 */
function playable(attrs: MediaAttrs, furniture: string | null): boolean {
  if (furniture !== null) return true
  return typeof attrs.src === 'string' && isSafeUrl(attrs.src)
}

export function insertVideo(attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    const furniture = mediaFurniture(attrs.sources)
    if (!playable(attrs, furniture) || !canInsert(state, 'video')) return false
    if (dispatch) {
      const type = nodeIn(state, 'video')
      if (!type) return false
      dispatch(
        state.tr
          .replaceSelectionWith(
            type.create({
              src: attrs.src && isSafeUrl(attrs.src) ? attrs.src : null,
              furniture,
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
    const furniture = mediaFurniture(attrs.sources)
    if (!playable(attrs, furniture) || !canInsert(state, 'audio')) return false
    if (dispatch) {
      const type = nodeIn(state, 'audio')
      if (!type) return false
      dispatch(
        state.tr
          .replaceSelectionWith(
            type.create({
              src: attrs.src && isSafeUrl(attrs.src) ? attrs.src : null,
              furniture,
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

/** The media node kinds the insert-media dialog can round-trip. */
const MEDIA_KINDS: ReadonlySet<string> = new Set(['video', 'audio', 'iframe'])

export interface SelectedMedia {
  kind: 'video' | 'audio' | 'iframe'
  /** Document position of the node, for `setNodeMarkup`. */
  pos: number
  src: string | null
  title: string | null
  width: string | null
  height: string | null
  controls: boolean
  poster: string | null
  /** Alternative addresses read back out of the stored `<source>` children. */
  sources: MediaSource[]
}

/**
 * The media node the selection is on, or null.
 *
 * Only a `NodeSelection` counts. A caret beside a player is not a selection of
 * it, and treating it as one would let the dialog silently retarget: the author
 * clicks away, opens the dialog expecting to insert, and edits the node they
 * had selected a moment ago instead.
 */
export function selectedMedia(state: EditorState): SelectedMedia | null {
  const selection = state.selection
  if (!(selection instanceof NodeSelection)) return null
  const node = selection.node
  const name = node.type.name
  if (!MEDIA_KINDS.has(name)) return null
  const attrs = node.attrs
  return {
    kind: name as 'video' | 'audio' | 'iframe',
    pos: selection.from,
    src: (attrs['src'] as string | null) ?? null,
    title: (attrs['title'] as string | null) ?? null,
    width: (attrs['width'] as string | null) ?? null,
    height: (attrs['height'] as string | null) ?? null,
    controls: attrs['controls'] === true,
    poster: (attrs['poster'] as string | null) ?? null,
    sources: readMediaSources(attrs['furniture'] as string | null),
  }
}

/**
 * Read stored furniture back into dialog rows.
 *
 * Parsed rather than regexed: the string is markup, and the dialog has to show
 * the author the same addresses the document will play.
 */
function readMediaSources(furniture: string | null): MediaSource[] {
  if (!furniture) return []
  const doc = serializationTarget()
  const tpl = doc.createElement('template')
  tpl.innerHTML = furniture
  const out: MediaSource[] = []
  for (const el of Array.from((tpl as HTMLTemplateElement).content.children)) {
    if (el.nodeName.toLowerCase() !== 'source') continue
    const src = el.getAttribute('src')
    if (src === null) continue
    out.push({ src, type: el.getAttribute('type') })
  }
  return out
}

/**
 * Update the selected media node in place.
 *
 * `setNodeMarkup` rather than replace-with-a-new-node: the position and the
 * selection both survive, so the player the author was editing is still the
 * selected one afterwards and a second edit does not have to find it again.
 */
export function updateMedia(attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    const current = selectedMedia(state)
    if (!current) return false
    const node = state.doc.nodeAt(current.pos)
    if (!node) return false
    const furniture =
      current.kind === 'iframe'
        ? null
        : mediaFurniture(attrs.sources, carriedFurniture(node.attrs['furniture']))
    // An iframe has no `<source>` children, so its address is the only thing it
    // can play and an unsafe one leaves nothing to fall back to. Converted the
    // same way the insert path converts it: an author editing a player is
    // holding the same watch-page URL as an author inserting one, and refusing
    // it here made the edit a silent no-op.
    const embed = current.kind === 'iframe' ? embedSrcFor(attrs.src) : null
    if (current.kind === 'iframe') {
      if (!embed) return false
    } else if (!playable(attrs, furniture)) return false
    if (dispatch) {
      const next: Record<string, unknown> = { ...node.attrs }
      if (current.kind === 'iframe') {
        next['src'] = embed
      } else {
        next['src'] = attrs.src && isSafeUrl(attrs.src) ? attrs.src : null
        next['furniture'] = furniture
      }
      next['title'] = attrs.title ?? null
      // `undefined` is "as it was", not "on". A dialog with no controls field
      // passes nothing, and defaulting that to on gave a control bar to every
      // controls-less player whose title someone edited.
      if ('controls' in node.attrs && attrs.controls !== undefined) {
        next['controls'] = attrs.controls
      }
      if ('width' in node.attrs) next['width'] = attrs.width ?? null
      if ('height' in node.attrs) next['height'] = attrs.height ?? null
      if ('poster' in node.attrs) {
        next['poster'] = attrs.poster && isSafeUrl(attrs.poster) ? attrs.poster : null
      }
      dispatch(state.tr.setNodeMarkup(current.pos, undefined, next))
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
