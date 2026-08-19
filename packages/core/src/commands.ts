/**
 * Editing commands and the selection predicates a toolbar needs.
 *
 * Deliberately separate from any UI. A toolbar button is two things -- a
 * command to run and a question about the current selection ("is the cursor
 * inside bold text?") -- and both are pure ProseMirror logic. Keeping them here
 * means the toolbar package holds no editing knowledge, and a plugin, a
 * keyboard shortcut and a test can all drive the editor the same way a button
 * does.
 *
 * Every command follows ProseMirror's convention: called with `(state)` alone it
 * reports whether it *could* apply, without doing anything. That is what makes
 * button disabled-state free -- the same function answers "can I?" and "do it".
 */

import { redo, undo } from 'prosemirror-history'
import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import type { Attrs, MarkType, Node as PMNode, NodeType } from 'prosemirror-model'
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list'
import type { Command, EditorState } from 'prosemirror-state'
import { NodeSelection } from 'prosemirror-state'
import { safeColor, type Align } from './css.js'

/**
 * Types are resolved from the state's schema, never from a captured singleton.
 *
 * A ProseMirror `Command` already receives the state, and `state.schema` is
 * right there -- so a command that looks its types up per call works against
 * ANY schema, including one a plugin extended with new nodes. Capturing
 * `schema.marks` at module load, as this file used to, is what made the schema
 * impossible to extend: every command was permanently bound to one instance.
 *
 * Resolution returns undefined rather than throwing. A command asked to bold
 * text in a schema with no `strong` mark should decline -- returning false is
 * ProseMirror's way of saying "not applicable here", and the toolbar already
 * renders that as a disabled button. Throwing would take the editor down
 * because a plugin trimmed the schema.
 */
function markIn(state: EditorState, name: string): MarkType | undefined {
  return state.schema.marks[name]
}

function nodeIn(state: EditorState, name: string): NodeType | undefined {
  return state.schema.nodes[name]
}

/** Build a command that needs one mark type, declining when it is absent. */
function markCommand(name: string, build: (type: MarkType) => Command): Command {
  return (state, dispatch, view) => {
    const type = markIn(state, name)
    if (!type) return false
    return build(type)(state, dispatch, view)
  }
}

/** Build a command that needs one node type, declining when it is absent. */
function nodeCommand(name: string, build: (type: NodeType) => Command): Command {
  return (state, dispatch, view) => {
    const type = nodeIn(state, name)
    if (!type) return false
    return build(type)(state, dispatch, view)
  }
}

/* ------------------------------------------------------------------ *
 * Selection predicates
 * ------------------------------------------------------------------ */

/**
 * Is this mark active at the cursor, or across the selection?
 *
 * The empty-selection case uses `storedMarks` first: after pressing Bold with
 * no selection, the mark is pending rather than applied, and a toolbar that
 * ignored `storedMarks` would show Bold as inactive immediately after the user
 * turned it on -- the single most common toolbar bug there is.
 */
export function isMarkActive(state: EditorState, markName: string): boolean {
  const type = markIn(state, markName)
  if (!type) return false
  const { from, $from, to, empty } = state.selection
  if (empty) {
    return !!type.isInSet(state.storedMarks ?? $from.marks())
  }
  return state.doc.rangeHasMark(from, to, type)
}

/** Is the selection inside a node of this type (with these attributes)? */
export function isNodeActive(state: EditorState, nodeName: string, attrs?: Attrs): boolean {
  const type = nodeIn(state, nodeName)
  if (!type) return false
  const { $from, from, to } = state.selection

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const parent = $from.node(depth)
    if (parent.type !== type) continue
    // The selection must sit inside this node. `$from.start(depth)` is always
    // ≤ `to` for an ancestor of `$from`, so comparing start against `to`
    // cannot detect a range that runs past the node. Compare against the
    // node's end, and require `from` to be at or after its start.
    if (from < $from.start(depth) || to > $from.end(depth)) continue
    if (!attrs) return true
    return Object.entries(attrs).every(([key, value]) => parent.attrs[key] === value)
  }
  return false
}

/** Can a node of this type be inserted at the current selection? */
export function canInsert(state: EditorState, nodeName: string): boolean {
  const type = nodeIn(state, nodeName)
  if (!type) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const index = $from.index(depth)
    if ($from.node(depth).canReplaceWith(index, index, type)) return true
  }
  return false
}

/** The heading level at the cursor, or null when not in a heading. */
export function activeHeadingLevel(state: EditorState): number | null {
  const { $from, from, to } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const parent = $from.node(depth)
    if (parent.type !== nodeIn(state, 'heading')) continue
    if (from < $from.start(depth) || to > $from.end(depth)) continue
    return parent.attrs['level'] as number
  }
  return null
}

/** Attributes of the link at the cursor, or null when not in a link. */
export function activeLink(state: EditorState): Attrs | null {
  const type = markIn(state, 'link')
  if (!type) return null
  const { $from, empty, from, to } = state.selection

  if (empty) {
    const found = type.isInSet($from.marks())
    return found ? found.attrs : null
  }
  let attrs: Attrs | null = null
  state.doc.nodesBetween(from, to, (child) => {
    if (attrs) return false
    const found = type.isInSet(child.marks)
    if (found) attrs = found.attrs
    return true
  })
  return attrs
}

/* ------------------------------------------------------------------ *
 * Mark commands
 * ------------------------------------------------------------------ */

export const toggleBold: Command = markCommand('strong', toggleMark)
export const toggleItalic: Command = markCommand('em', toggleMark)
export const toggleUnderline: Command = markCommand('underline', toggleMark)
export const toggleStrike: Command = markCommand('strike', toggleMark)
export const toggleInlineCode: Command = markCommand('code', toggleMark)

/* ------------------------------------------------------------------ *
 * Block commands
 * ------------------------------------------------------------------ */

export const setParagraph: Command = nodeCommand('paragraph', (type) => setBlockType(type))

export function setHeading(level: number): Command {
  return nodeCommand('heading', (type) => setBlockType(type, { level }))
}

/**
 * Toggle a heading level: applying the level you are already in returns the
 * block to a paragraph, which is what every editor's users expect from a
 * heading control even though it is not what `setBlockType` does alone.
 */
export function toggleHeading(level: number): Command {
  return (state, dispatch, view) => {
    if (activeHeadingLevel(state) === level) return setParagraph(state, dispatch, view)
    return setHeading(level)(state, dispatch, view)
  }
}

export const toggleCodeBlock: Command = (state, dispatch, view) => {
  if (isNodeActive(state, 'code_block')) return setParagraph(state, dispatch, view)
  return nodeCommand('code_block', (type) => setBlockType(type))(state, dispatch, view)
}

export const wrapInBlockquote: Command = nodeCommand('blockquote', (type) => wrapIn(type))

export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (!isNodeActive(state, 'blockquote')) return wrapInBlockquote(state, dispatch, view)
  return unwrapBlockquote(state, dispatch)
}

/**
 * Unwrap the enclosing blockquote, not the innermost block.
 *
 * The previous implementation lifted `$from.blockRange()` by `depth - 1`.
 * Inside `<blockquote><ul><li><p>…</p></li></ul></blockquote>` that range is
 * the paragraph, and lifting it into the list is illegal (`bullet_list`
 * only accepts `list_item`). The command threw `TransformError` on a toolbar
 * click. Replacing the blockquote node with its children is valid wherever
 * a blockquote is, because its content matches the parent content expression.
 */
function unwrapBlockquote(
  state: EditorState,
  dispatch?: (tr: import('prosemirror-state').Transaction) => void,
): boolean {
  const { $from } = state.selection
  const type = nodeIn(state, 'blockquote')
  if (!type) return false

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type !== type) continue
    if (dispatch) {
      const node = $from.node(depth)
      const pos = $from.before(depth)
      dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.content).scrollIntoView())
    }
    return true
  }
  return false
}

export const insertHorizontalRule: Command = (state, dispatch) => {
  if (!canInsert(state, 'horizontal_rule')) return false
  if (dispatch) {
    const type = nodeIn(state, 'horizontal_rule')
    if (!type) return false
    dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView())
  }
  return true
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

export const toggleBulletList: Command = toggleList('bullet_list')
export const toggleOrderedList: Command = toggleList('ordered_list')

/**
 * Innermost list containing the selection, walking from the cursor outward.
 *
 * Nested lists must convert the inner one: converting the outer list would
 * leave the author's current list type unchanged, which looks like the
 * button did nothing.
 */
function enclosingList(
  state: EditorState,
): { pos: number; name: 'bullet_list' | 'ordered_list' } | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name === 'bullet_list' || name === 'ordered_list') {
      return { pos: $from.before(depth), name }
    }
  }
  return null
}

function toggleList(target: 'bullet_list' | 'ordered_list'): Command {
  return (state, dispatch, view) => {
    const enclosing = enclosingList(state)
    if (enclosing?.name === target) return outdentListItem(state, dispatch, view)
    if (enclosing) {
      const type = nodeIn(state, target)
      if (!type) return false
      if (dispatch) dispatch(state.tr.setNodeMarkup(enclosing.pos, type).scrollIntoView())
      return true
    }
    return nodeCommand(target, (type) => wrapInList(type))(state, dispatch, view)
  }
}

export const splitListItemCommand: Command = nodeCommand('list_item', (t) => splitListItem(t))
export const indentListItem: Command = nodeCommand('list_item', (t) => sinkListItem(t))
export const outdentListItem: Command = nodeCommand('list_item', (t) => liftListItem(t))

/* ------------------------------------------------------------------ *
 * Alignment
 * ------------------------------------------------------------------ */

/**
 * The text blocks in the selection that can carry an alignment.
 *
 * Membership is decided by asking whether the node carries an `align`
 * attribute, not by naming paragraph and heading. A plugin that adds an
 * alignable block -- a caption, a callout -- gets the toolbar control and the
 * keyboard shortcut for free, and this function does not have to learn its name.
 */
function alignableBlocks(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const found: Array<{ pos: number; node: PMNode }> = []
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    // Asked of the node's resolved attributes rather than its type's spec:
    // `spec.attrs` is optional and undeclared in the public typings, whereas
    // every node carries every attribute its type declares.
    if (Object.hasOwn(node.attrs, 'align')) found.push({ pos, node })
    // Never descend into a text block: its inline children are not alignable
    // and walking them on every keystroke is work with no result.
    return false
  })
  return found
}

/**
 * The alignment of the selection, or null when it has none or is mixed.
 *
 * Null means "no explicit alignment", which is a genuinely different state from
 * "aligned left" and is reported as such: an unaligned paragraph follows the
 * document's reading direction, so it renders right-aligned in Arabic or Hebrew.
 * Reporting it as left would make the left button light up on text that is not
 * left-aligned, and would make `aria-pressed="true"` a lie about a paragraph
 * nobody has aligned.
 *
 * A selection spanning blocks with different alignments also reports null.
 * Showing the first block's value as the state of all of them is a lie the
 * author acts on -- they see "centred", press it to turn it off, and one
 * paragraph they never looked at moves.
 */
export function activeTextAlign(state: EditorState): Align | null {
  const blocks = alignableBlocks(state)
  const first = blocks[0]
  if (!first) return null
  const value = (first.node.attrs['align'] as Align | null) ?? null
  return blocks.every((b) => (b.node.attrs['align'] ?? null) === value) ? value : null
}

/**
 * Set the alignment of every alignable block in the selection. `null` clears it.
 *
 * Reports true whenever there is something to align, even if it already carries
 * this value. The alternative -- returning false because the work is already
 * done -- would make the toolbar render the button for the CURRENT alignment as
 * disabled, since a command's no-dispatch call is what drives enabled state.
 */
export function setTextAlign(align: Align | null): Command {
  return (state, dispatch) => {
    const blocks = alignableBlocks(state)
    if (blocks.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      for (const { pos, node } of blocks) {
        // No position mapping needed: an attribute-only change replaces a node
        // with one of identical size, so earlier edits cannot shift later
        // positions in this loop.
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/**
 * Toggle an alignment: applying the one already in force clears it.
 *
 * The same reasoning as `toggleHeading`. An author who centred a paragraph by
 * accident reaches for the control they just pressed, and having it do nothing
 * because "centre" is already the value leaves them hunting for an
 * un-centre button that does not exist.
 */
export function toggleTextAlign(align: Align): Command {
  return (state, dispatch, view) => {
    const next = activeTextAlign(state) === align ? null : align
    return setTextAlign(next)(state, dispatch, view)
  }
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

/**
 * Apply a colour mark, replacing any existing one of the same kind.
 *
 * Not `toggleMark`: with attributes, toggling means "the same colour twice
 * removes it", so choosing red on text that is already red would clear it --
 * and choosing red on text that is blue would leave two overlapping marks whose
 * winner is decided by mark order. A colour picker is a set operation, so the
 * existing mark is removed first and the new one added over the whole range.
 *
 * With an empty selection the colour goes onto the stored marks, so it applies
 * to what the author types next. That is the same behaviour as pressing Bold on
 * an empty cursor, and leaving it out is the most common complaint about colour
 * pickers -- you choose a colour, type, and get black text.
 */
function colorCommand(name: string, color: string | null): Command {
  return (state, dispatch) => {
    const type = markIn(state, name)
    if (!type) return false

    // A colour the schema would refuse is a bug in the caller, not a formatting
    // request. Declining is better than writing an attribute that will be
    // dropped on the next parse, which would look like the editor losing edits.
    const value = color === null ? null : safeColor(color)
    if (color !== null && value === null) return false

    const { empty, from, to } = state.selection

    if (empty) {
      const current = state.storedMarks ?? state.selection.$from.marks()
      const stripped = current.filter((mark) => mark.type !== type)
      if (value === null && stripped.length === current.length) return false
      if (dispatch) {
        dispatch(
          state.tr.setStoredMarks(
            value === null ? stripped : [...stripped, type.create({ color: value })],
          ),
        )
      }
      return true
    }

    if (value === null && !state.doc.rangeHasMark(from, to, type)) return false
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, type)
      if (value !== null) tr.addMark(from, to, type.create({ color: value }))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Attribute of a colour mark across the selection, or null when absent or mixed. */
function activeColor(state: EditorState, name: string): string | null {
  const type = markIn(state, name)
  if (!type) return null
  const { empty, $from, from, to } = state.selection

  if (empty) {
    const found = type.isInSet(state.storedMarks ?? $from.marks())
    return found ? (found.attrs['color'] as string) : null
  }

  let value: string | null = null
  let uniform = true
  state.doc.nodesBetween(from, to, (child) => {
    if (!child.isText) return true
    const found = type.isInSet(child.marks)
    const colour = found ? (found.attrs['color'] as string) : null
    if (value === null && uniform) value = colour
    else if (colour !== value) uniform = false
    return true
  })
  // Mixed colours report null for the same reason mixed alignment does: a
  // swatch showing one of them invites the author to act on all of them.
  return uniform ? value : null
}

export function setTextColor(color: string): Command {
  return colorCommand('text_color', color)
}

export function setBackgroundColor(color: string): Command {
  return colorCommand('background_color', color)
}

export const clearTextColor: Command = colorCommand('text_color', null)
export const clearBackgroundColor: Command = colorCommand('background_color', null)

export function activeTextColor(state: EditorState): string | null {
  return activeColor(state, 'text_color')
}

export function activeBackgroundColor(state: EditorState): string | null {
  return activeColor(state, 'background_color')
}

/* ------------------------------------------------------------------ *
 * Links and images
 * ------------------------------------------------------------------ */

export interface LinkAttrs {
  href: string
  title?: string | null
  target?: string | null
  rel?: string | null
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
    const { from, to, empty } = state.selection
    if (empty) return false
    if (dispatch) {
      const tr = state.tr
      tr.removeMark(from, to, type)
      tr.addMark(from, to, type.create({ ...attrs }))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const unsetLink: Command = (state, dispatch) => {
  const type = markIn(state, 'link')
  if (!type) return false
  const { from, to, empty } = state.selection
  if (empty || !state.doc.rangeHasMark(from, to, type)) return false
  if (dispatch) dispatch(state.tr.removeMark(from, to, type).scrollIntoView())
  return true
}

export interface ImageAttrs {
  src: string
  alt?: string | null
  title?: string | null
  width?: string | null
  height?: string | null
  class?: string | null
  srcset?: string | null
  sizes?: string | null
  /** Caption text. When set, the image is inserted inside a `<figure>`. */
  caption?: string | null
}

function imageNodeAttrs(attrs: ImageAttrs): Record<string, unknown> {
  return {
    src: attrs.src,
    alt: attrs.alt ?? null,
    title: attrs.title ?? null,
    width: attrs.width ?? null,
    height: attrs.height ?? null,
    class: attrs.class ?? null,
    srcset: attrs.srcset ?? null,
    sizes: attrs.sizes ?? null,
    extra: null,
  }
}

export function insertImage(attrs: ImageAttrs): Command {
  return (state, dispatch) => {
    const imageType = nodeIn(state, 'image')
    if (!imageType) return false
    const captionText = attrs.caption?.trim() ?? ''
    const image = imageType.create(imageNodeAttrs(attrs))

    if (captionText) {
      const figureType = nodeIn(state, 'figure')
      const captionType = nodeIn(state, 'figcaption')
      if (!figureType || !captionType) return false
      if (!canInsert(state, 'figure')) return false
      if (dispatch) {
        const caption = captionType.create(null, state.schema.text(captionText))
        const figure = figureType.create(null, [image, caption])
        dispatch(state.tr.replaceSelectionWith(figure).scrollIntoView())
      }
      return true
    }

    if (!canInsert(state, 'image')) return false
    if (dispatch) dispatch(state.tr.replaceSelectionWith(image).scrollIntoView())
    return true
  }
}

export interface MediaAttrs {
  src?: string | null
  poster?: string | null
  width?: string | null
  height?: string | null
  class?: string | null
  controls?: string | null
  furniture?: string | null
  caption?: string | null
}

function insertMedia(kind: 'video' | 'audio', attrs: MediaAttrs): Command {
  return (state, dispatch) => {
    const type = nodeIn(state, kind)
    if (!type) return false
    const media = type.create({
      src: attrs.src ?? null,
      poster: kind === 'video' ? (attrs.poster ?? null) : null,
      width: attrs.width ?? null,
      height: attrs.height ?? null,
      class: attrs.class ?? null,
      controls: attrs.controls ?? 'controls',
      autoplay: null,
      loop: null,
      muted: null,
      playsinline: null,
      preload: null,
      extra: null,
      furniture: attrs.furniture ?? null,
    })
    const captionText = attrs.caption?.trim() ?? ''
    if (captionText) {
      const figureType = nodeIn(state, 'figure')
      const captionType = nodeIn(state, 'figcaption')
      if (!figureType || !captionType || !canInsert(state, 'figure')) return false
      if (dispatch) {
        const caption = captionType.create(null, state.schema.text(captionText))
        dispatch(state.tr.replaceSelectionWith(figureType.create(null, [media, caption])).scrollIntoView())
      }
      return true
    }
    if (!canInsert(state, kind)) return false
    if (dispatch) dispatch(state.tr.replaceSelectionWith(media).scrollIntoView())
    return true
  }
}

export function insertVideo(attrs: MediaAttrs): Command {
  return insertMedia('video', attrs)
}

export function insertAudio(attrs: MediaAttrs): Command {
  return insertMedia('audio', attrs)
}

export interface SelectedMedia {
  pos: number
  node: PMNode
  figurePos: number | null
}

/** The selected image, video, audio, or figure wrapping one. */
export function selectedMedia(state: EditorState): SelectedMedia | null {
  const sel = state.selection
  if (!(sel instanceof NodeSelection)) return null
  const node = sel.node
  const pos = sel.from
  if (node.type.name === 'figure') {
    const child = node.firstChild
    if (!child) return null
    return { pos: pos + 1, node: child, figurePos: pos }
  }
  if (node.type.name === 'image' || node.type.name === 'video' || node.type.name === 'audio') {
    const $pos = state.doc.resolve(pos)
    const parent = $pos.parent
    const figurePos = parent.type.name === 'figure' ? $pos.before($pos.depth) : null
    return { pos, node, figurePos }
  }
  return null
}

/**
 * Update attributes on the selected media node, and optionally its caption.
 *
 * Dimensions, class and caption live on this one command so the properties
 * dialog has a single write path.
 */
export function updateMedia(attrs: Record<string, unknown>, caption?: string | null): Command {
  return (state, dispatch) => {
    const selected = selectedMedia(state)
    if (!selected) return false
    if (dispatch) {
      let tr = state.tr.setNodeMarkup(selected.pos, undefined, { ...selected.node.attrs, ...attrs })
      if (caption !== undefined) {
        tr = applyCaption(tr, state, selected, caption)
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

function applyCaption(
  tr: import('prosemirror-state').Transaction,
  state: EditorState,
  selected: SelectedMedia,
  caption: string | null,
): import('prosemirror-state').Transaction {
  const captionType = nodeIn(state, 'figcaption')
  const figureType = nodeIn(state, 'figure')
  const paragraph = nodeIn(state, 'paragraph')
  if (!captionType || !figureType) return tr
  const text = caption?.trim() ?? ''

  if (selected.figurePos !== null) {
    const figure = tr.doc.nodeAt(selected.figurePos)
    if (!figure?.firstChild) return tr
    const media = figure.firstChild
    if (!text) {
      const replacement =
        media.type.name === 'image' && paragraph ? paragraph.create(null, media) : media
      return tr.replaceWith(selected.figurePos, selected.figurePos + figure.nodeSize, replacement)
    }
    const existing = figure.lastChild?.type === captionType ? figure.lastChild : null
    const nextCaption = captionType.create(existing?.attrs ?? null, state.schema.text(text))
    return tr.replaceWith(
      selected.figurePos,
      selected.figurePos + figure.nodeSize,
      figureType.create(figure.attrs, [media, nextCaption]),
    )
  }

  if (!text) return tr
  const media = tr.doc.nodeAt(selected.pos)
  if (!media) return tr
  const nextCaption = captionType.create(null, state.schema.text(text))
  const figure = figureType.create(null, [media.copy(), nextCaption])
  const $pos = tr.doc.resolve(selected.pos)
  if ($pos.parent.type.name === 'paragraph' && $pos.parent.childCount === 1) {
    const paraPos = $pos.before($pos.depth)
    return tr.replaceWith(paraPos, paraPos + $pos.parent.nodeSize, figure)
  }
  return tr.replaceWith(selected.pos, selected.pos + media.nodeSize, figure)
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export { redo, undo } from 'prosemirror-history'

export const canUndo: (state: EditorState) => boolean = (state) => undo(state)
export const canRedo: (state: EditorState) => boolean = (state) => redo(state)
