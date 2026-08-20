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
import { Slice, type Attrs, type MarkType, type Node as PMNode, type NodeType } from 'prosemirror-model'
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list'
import type { Command, EditorState } from 'prosemirror-state'
import {
  MAX_INDENT,
  safeColor,
  safeDir,
  safeFontFamily,
  safeFontSize,
  safeLang,
  safeLineHeight,
  safeListStyle,
  type Align,
  type Dir,
  type ListStyle,
} from './css.js'
import { safeAllowList, safeEmbedSrc } from './embed.js'
import { parseHtml } from './html.js'
import { IMAGE_ALIGN_CLASSES, safeClassList, safeId, type ImageAlign } from './tokens.js'
import { isSafeUrl } from './url.js'

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
export const toggleSubscript: Command = markCommand('subscript', toggleMark)
export const toggleSuperscript: Command = markCommand('superscript', toggleMark)

/* ------------------------------------------------------------------ *
 * Block commands
 * ------------------------------------------------------------------ */

export const setParagraph: Command = nodeCommand('paragraph', (type) => setBlockType(type))

export function setHeading(level: number): Command {
  return (state, dispatch, view) => {
    const type = nodeIn(state, 'heading')
    if (!type) return false
    const parent = state.selection.$from.parent
    const attrs = {
      level,
      dir: (parent.attrs['dir'] as string | null) ?? null,
      align: (parent.attrs['align'] as Align | null) ?? null,
      id: parent.type === type ? ((parent.attrs['id'] as string | null) ?? null) : null,
    }
    return setBlockType(type, attrs)(state, dispatch, view)
  }
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

/**
 * Indent: nest a list item when the selection is in a list, otherwise add a
 * `padding-inline-start` step on the text blocks. Outdent is the reverse, and
 * lifting a top-level list item out of its list is still how you leave a list.
 */
export const indent: Command = (state, dispatch, view) => {
  if (enclosingList(state)) return indentListItem(state, dispatch, view)
  return adjustIndent(1)(state, dispatch, view)
}

export const outdent: Command = (state, dispatch, view) => {
  if (enclosingList(state)) return outdentListItem(state, dispatch, view)
  return adjustIndent(-1)(state, dispatch, view)
}

function adjustIndent(delta: number): Command {
  return (state, dispatch) => {
    const blocks = blocksWithAttr(state, 'indent')
    if (blocks.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      for (const { pos, node } of blocks) {
        const current = (node.attrs['indent'] as number | null) ?? 0
        const next = Math.max(0, Math.min(MAX_INDENT, current + delta))
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next === 0 ? null : next })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export function activeIndent(state: EditorState): number | null {
  return uniformBlockAttr(state, 'indent')
}

export function setListStyle(style: ListStyle | null): Command {
  return (state, dispatch) => {
    const enclosing = enclosingList(state)
    if (!enclosing) return false
    const value = style === null ? null : safeListStyle(style)
    if (style !== null && value === null) return false
    if (dispatch) {
      const node = state.doc.nodeAt(enclosing.pos)
      if (!node) return false
      dispatch(
        state.tr.setNodeMarkup(enclosing.pos, undefined, { ...node.attrs, listStyle: value }).scrollIntoView(),
      )
    }
    return true
  }
}

export function activeListStyle(state: EditorState): ListStyle | null {
  const enclosing = enclosingList(state)
  if (!enclosing) return null
  const node = state.doc.nodeAt(enclosing.pos)
  return (node?.attrs['listStyle'] as ListStyle | null) ?? null
}

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
function blocksWithAttr(state: EditorState, attr: string): Array<{ pos: number; node: PMNode }> {
  const found: Array<{ pos: number; node: PMNode }> = []
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (Object.hasOwn(node.attrs, attr)) found.push({ pos, node })
    return false
  })
  return found
}

function uniformBlockAttr<T>(state: EditorState, attr: string): T | null {
  const blocks = blocksWithAttr(state, attr)
  const first = blocks[0]
  if (!first) return null
  const value = (first.node.attrs[attr] as T | null) ?? null
  return blocks.every((b) => (b.node.attrs[attr] ?? null) === value) ? value : null
}

function alignableBlocks(state: EditorState): Array<{ pos: number; node: PMNode }> {
  return blocksWithAttr(state, 'align')
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

export function setLineHeight(value: string | null): Command {
  return setBlockStringAttr('lineHeight', value, safeLineHeight)
}

export function activeLineHeight(state: EditorState): string | null {
  return uniformBlockAttr(state, 'lineHeight')
}

export function setDir(dir: Dir | null): Command {
  return (state, dispatch) => {
    const blocks = blocksWithAttr(state, 'dir')
    if (blocks.length === 0) return false
    const value = dir === null ? null : safeDir(dir)
    if (dir !== null && value === null) return false
    if (dispatch) {
      const tr = state.tr
      for (const { pos, node } of blocks) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir: value })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export function toggleDir(dir: Dir): Command {
  return (state, dispatch, view) => {
    const next = activeDir(state) === dir ? null : dir
    return setDir(next)(state, dispatch, view)
  }
}

export function activeDir(state: EditorState): Dir | null {
  return uniformBlockAttr(state, 'dir')
}

function setBlockStringAttr(
  attr: string,
  value: string | null,
  validate: (value: string | null | undefined) => string | null,
): Command {
  return (state, dispatch) => {
    const blocks = blocksWithAttr(state, attr)
    if (blocks.length === 0) return false
    const next = value === null ? null : validate(value)
    if (value !== null && next === null) return false
    if (dispatch) {
      const tr = state.tr
      for (const { pos, node } of blocks) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: next })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
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

  // `seen` is load-bearing: `null` means both "not visited yet" and "unmarked
  // text", so without a separate flag a selection that starts unmarked and then
  // hits a coloured run would report the colour as uniform.
  let seen = false
  let value: string | null = null
  let uniform = true
  state.doc.nodesBetween(from, to, (child) => {
    if (!child.isText) return true
    const found = type.isInSet(child.marks)
    const colour = found ? (found.attrs['color'] as string) : null
    if (!seen) {
      value = colour
      seen = true
    } else if (colour !== value) {
      uniform = false
    }
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

function attrMarkCommand(
  name: string,
  attr: string,
  value: string | null,
  validate: (value: string | null | undefined) => string | null,
): Command {
  return (state, dispatch) => {
    const type = markIn(state, name)
    if (!type) return false
    const next = value === null ? null : validate(value)
    if (value !== null && next === null) return false

    const { empty, from, to } = state.selection
    if (empty) {
      const current = state.storedMarks ?? state.selection.$from.marks()
      const stripped = current.filter((mark) => mark.type !== type)
      if (next === null && stripped.length === current.length) return false
      if (dispatch) {
        dispatch(
          state.tr.setStoredMarks(next === null ? stripped : [...stripped, type.create({ [attr]: next })]),
        )
      }
      return true
    }

    if (next === null && !state.doc.rangeHasMark(from, to, type)) return false
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, type)
      if (next !== null) tr.addMark(from, to, type.create({ [attr]: next }))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

function activeMarkAttr(state: EditorState, name: string, attr: string): string | null {
  const type = markIn(state, name)
  if (!type) return null
  const { empty, $from, from, to } = state.selection

  if (empty) {
    const found = type.isInSet(state.storedMarks ?? $from.marks())
    return found ? (found.attrs[attr] as string) : null
  }

  // Same sentinel problem as activeColor: without `seen`, an unmarked run at
  // the start of the selection is overwritten by the first marked value and
  // the dropdown claims the whole range has that family or size.
  let seen = false
  let value: string | null = null
  let uniform = true
  state.doc.nodesBetween(from, to, (child) => {
    if (!child.isText) return true
    const found = type.isInSet(child.marks)
    const current = found ? (found.attrs[attr] as string) : null
    if (!seen) {
      value = current
      seen = true
    } else if (current !== value) {
      uniform = false
    }
    return true
  })
  return uniform ? value : null
}

export function setFontFamily(family: string | null): Command {
  return attrMarkCommand('font_family', 'family', family, safeFontFamily)
}

export function setFontSize(size: string | null): Command {
  return attrMarkCommand('font_size', 'size', size, safeFontSize)
}

export function setLanguage(lang: string | null): Command {
  return attrMarkCommand('language', 'lang', lang, safeLang)
}

export function activeFontFamily(state: EditorState): string | null {
  return activeMarkAttr(state, 'font_family', 'family')
}

export function activeFontSize(state: EditorState): string | null {
  return activeMarkAttr(state, 'font_size', 'size')
}

export function activeLanguage(state: EditorState): string | null {
  return activeMarkAttr(state, 'language', 'lang')
}

/**
 * Strip character formatting and block decoration from the selection.
 *
 * Links stay: they are a destination, not a look. Direction stays: it is
 * content. Headings and lists stay: they are structure. Alignment, indent,
 * line height, fonts, colours, and the common character marks go.
 */
export const clearFormatting: Command = (state, dispatch) => {
  const keep = new Set(['link'])
  const { empty, from, to, $from } = state.selection
  const marks = Object.values(state.schema.marks).filter((type) => !keep.has(type.name))

  if (empty) {
    const current = state.storedMarks ?? $from.marks()
    const stripped = current.filter((mark) => keep.has(mark.type.name))
    const blocks = blocksWithAttr(state, 'align')
    const canClearBlocks = blocks.some(
      (b) =>
        b.node.attrs['align'] != null ||
        b.node.attrs['lineHeight'] != null ||
        b.node.attrs['indent'] != null,
    )
    if (stripped.length === current.length && !canClearBlocks) return false
    if (dispatch) {
      let tr = state.tr.setStoredMarks(stripped)
      for (const { pos, node } of blocks) {
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          align: null,
          lineHeight: null,
          indent: null,
        })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  let hasMarks = false
  for (const type of marks) {
    if (state.doc.rangeHasMark(from, to, type)) hasMarks = true
  }
  const blocks = blocksWithAttr(state, 'align')
  const canClearBlocks = blocks.some(
    (b) =>
      b.node.attrs['align'] != null ||
      b.node.attrs['lineHeight'] != null ||
      b.node.attrs['indent'] != null,
  )
  if (!hasMarks && !canClearBlocks) return false
  if (dispatch) {
    let tr = state.tr
    for (const type of marks) tr = tr.removeMark(from, to, type)
    for (const { pos, node } of blocks) {
      tr = tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        align: null,
        lineHeight: null,
        indent: null,
      })
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

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
    const { from, to, empty } = state.selection
    if (empty) return false
    if (dispatch) {
      const tr = state.tr
      tr.removeMark(from, to, type)
      tr.addMark(
        from,
        to,
        type.create({
          href: attrs.href,
          title: attrs.title ?? null,
          target: attrs.target ?? null,
          rel: attrs.rel ?? null,
          id: safeId(attrs.id),
        }),
      )
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

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export { redo, undo } from 'prosemirror-history'

export const canUndo: (state: EditorState) => boolean = (state) => undo(state)
export const canRedo: (state: EditorState) => boolean = (state) => redo(state)
