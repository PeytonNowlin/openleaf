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
import type { Attrs, MarkType, NodeType } from 'prosemirror-model'
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list'
import type { Command, EditorState } from 'prosemirror-state'
import { schema } from './schema.js'

const marks = schema.marks
const nodes = schema.nodes

function mark(name: string): MarkType {
  const type = marks[name]
  if (!type) throw new Error(`@openleaf/core: unknown mark "${name}"`)
  return type
}

function node(name: string): NodeType {
  const type = nodes[name]
  if (!type) throw new Error(`@openleaf/core: unknown node "${name}"`)
  return type
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
  const type = mark(markName)
  const { from, $from, to, empty } = state.selection
  if (empty) {
    return !!type.isInSet(state.storedMarks ?? $from.marks())
  }
  return state.doc.rangeHasMark(from, to, type)
}

/** Is the selection inside a node of this type (with these attributes)? */
export function isNodeActive(state: EditorState, nodeName: string, attrs?: Attrs): boolean {
  const type = node(nodeName)
  const { $from, to } = state.selection

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const parent = $from.node(depth)
    if (parent.type !== type) continue
    // Confirm the selection does not extend past this node.
    if ($from.start(depth) > to) continue
    if (!attrs) return true
    return Object.entries(attrs).every(([key, value]) => parent.attrs[key] === value)
  }
  return false
}

/** Can a node of this type be inserted at the current selection? */
export function canInsert(state: EditorState, nodeName: string): boolean {
  const type = node(nodeName)
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const index = $from.index(depth)
    if ($from.node(depth).canReplaceWith(index, index, type)) return true
  }
  return false
}

/** The heading level at the cursor, or null when not in a heading. */
export function activeHeadingLevel(state: EditorState): number | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const parent = $from.node(depth)
    if (parent.type === node('heading')) return parent.attrs['level'] as number
  }
  return null
}

/** Attributes of the link at the cursor, or null when not in a link. */
export function activeLink(state: EditorState): Attrs | null {
  const type = mark('link')
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

export const toggleBold: Command = toggleMark(mark('strong'))
export const toggleItalic: Command = toggleMark(mark('em'))
export const toggleUnderline: Command = toggleMark(mark('underline'))
export const toggleStrike: Command = toggleMark(mark('strike'))
export const toggleInlineCode: Command = toggleMark(mark('code'))

/* ------------------------------------------------------------------ *
 * Block commands
 * ------------------------------------------------------------------ */

export const setParagraph: Command = setBlockType(node('paragraph'))

export function setHeading(level: number): Command {
  return setBlockType(node('heading'), { level })
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
  return setBlockType(node('code_block'))(state, dispatch, view)
}

export const wrapInBlockquote: Command = wrapIn(node('blockquote'))

export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (!isNodeActive(state, 'blockquote')) return wrapInBlockquote(state, dispatch, view)
  // Lifting out of a quote is `liftListItem`-shaped work; reuse ProseMirror's
  // generic lift via the list helper on the enclosing paragraph.
  return liftOut(state, dispatch)
}

/** Lift the selection out of its immediate wrapper. */
function liftOut(state: EditorState, dispatch?: (tr: import('prosemirror-state').Transaction) => void): boolean {
  const { $from, $to } = state.selection
  const range = $from.blockRange($to)
  if (!range) return false
  const target = range.depth > 0 ? range.depth - 1 : 0
  if (target < 0) return false
  if (dispatch) {
    const tr = state.tr
    tr.lift(range, target)
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const insertHorizontalRule: Command = (state, dispatch) => {
  if (!canInsert(state, 'horizontal_rule')) return false
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(node('horizontal_rule').create()).scrollIntoView())
  }
  return true
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

export const toggleBulletList: Command = (state, dispatch, view) => {
  if (isNodeActive(state, 'bullet_list')) return liftListItem(node('list_item'))(state, dispatch, view)
  return wrapInList(node('bullet_list'))(state, dispatch, view)
}

export const toggleOrderedList: Command = (state, dispatch, view) => {
  if (isNodeActive(state, 'ordered_list')) return liftListItem(node('list_item'))(state, dispatch, view)
  return wrapInList(node('ordered_list'))(state, dispatch, view)
}

export const splitListItemCommand: Command = splitListItem(node('list_item'))
export const indentListItem: Command = sinkListItem(node('list_item'))
export const outdentListItem: Command = liftListItem(node('list_item'))

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
    const type = mark('link')
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
  const type = mark('link')
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
}

export function insertImage(attrs: ImageAttrs): Command {
  return (state, dispatch) => {
    if (!canInsert(state, 'image')) return false
    if (dispatch) {
      const image = node('image').create({
        src: attrs.src,
        // An absent alt and alt="" mean different things to a screen reader:
        // "undescribed" versus "decorative". Never collapse them.
        alt: attrs.alt ?? null,
        title: attrs.title ?? null,
        width: attrs.width ?? null,
        height: attrs.height ?? null,
      })
      dispatch(state.tr.replaceSelectionWith(image).scrollIntoView())
    }
    return true
  }
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export { redo, undo } from 'prosemirror-history'

export const canUndo: (state: EditorState) => boolean = (state) => undo(state)
export const canRedo: (state: EditorState) => boolean = (state) => redo(state)
