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
}

export function insertImage(attrs: ImageAttrs): Command {
  return (state, dispatch) => {
    if (!canInsert(state, 'image')) return false
    if (dispatch) {
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
