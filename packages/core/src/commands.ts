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
import { toggleMark, wrapIn } from 'prosemirror-commands'
import {
  Fragment,
  type Attrs,
  type MarkType,
  type Node as PMNode,
  type NodeType,
} from 'prosemirror-model'
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list'
import {
  NodeSelection,
  Selection,
  type Command,
  type EditorState,
  type SelectionRange,
  type Transaction,
} from 'prosemirror-state'
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
import { canInsertNode, markCommand, markIn, nodeCommand, nodeIn } from './command-helpers.js'
import { CARRIED_ATTR } from './extensions.js'
import { selectedImage } from './insert-commands.js'
import { IMAGE_ALIGNMENTS } from './tokens.js'

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
/* ------------------------------------------------------------------ *
 * Two things every command in this file has to get right
 * ------------------------------------------------------------------ */

/**
 * The selected ranges. For an ordinary selection there is exactly one; for a
 * table selection there is one per cell.
 *
 * `selection.from` and `selection.to` are the bounds of a SINGLE range, not the
 * union of all of them. That is fine for a text selection and silently wrong for
 * a `CellSelection` from prosemirror-tables: selecting a column of a 3x2 table
 * gives `ranges.length === 2` while `from`/`to` describe the interior of one
 * cell. Every command that read those two numbers therefore coloured, sized or
 * cleared one cell of a selected column and left the others untouched.
 *
 * What made it a bug rather than an unimplemented feature is that `toggleBold`
 * was never affected: it goes through prosemirror-commands' `toggleMark`, which
 * iterates ranges. So on one identical selection, Bold worked and colour did
 * not, which an author reads as the editor failing at random rather than as a
 * limitation they could work around.
 *
 * A named accessor rather than inlining `state.selection.ranges` everywhere,
 * because the point that needs to survive future edits is "never destructure
 * from/to for an operation over a selection", and a function is where that
 * reasoning can live.
 */
function selectedRanges(state: EditorState): readonly SelectionRange[] {
  return state.selection.ranges
}

/** True when any selected range carries this mark. */
function anyRangeHasMark(state: EditorState, type: MarkType): boolean {
  return selectedRanges(state).some((range) =>
    state.doc.rangeHasMark(range.$from.pos, range.$to.pos, type),
  )
}

/** Remove a mark from every selected range, optionally re-adding it. */
function replaceMarkInRanges(
  state: EditorState,
  tr: Transaction,
  type: MarkType,
  attrs: Attrs | null,
): void {
  for (const range of selectedRanges(state)) {
    const { pos: from } = range.$from
    const { pos: to } = range.$to
    tr.removeMark(from, to, type)
    if (attrs !== null) tr.addMark(from, to, type.create(attrs))
  }
}

/**
 * The attributes to give a node being retyped, so that changing a block's TYPE
 * does not also change everything else about it.
 *
 * Every attribute the destination type also declares comes across unchanged;
 * anything it does not declare is dropped, because there is nowhere to put it.
 * The one that matters most is `__openleafCarried`, the residue holding `class`,
 * every `data-*` and all unmodelled CSS -- and `dir`, which schema.ts makes a
 * first-class attribute precisely because dropping it silently breaks Arabic,
 * Hebrew and Persian content.
 *
 * Three separate mechanisms used to lose all of it, which is why the fix is a
 * shared helper rather than four local patches. `setHeading` hand-built its
 * attribute object and listed four names, so anything added to the schema
 * afterwards fell back to a default. `setParagraph` and `toggleCodeBlock` passed
 * no attributes at all. `toggleList` called `setNodeMarkup(pos, type)` and
 * prosemirror-transform does `type.create(undefined, ...)` there -- it does NOT
 * fall back to the old node's attributes, which is the part that reads as though
 * it should be safe and is not.
 *
 * It also silently broke `formats.ts`: `setBlockClass` writes the chosen format
 * class into the carried residue, so applying a format and then changing the
 * heading level removed the format.
 */
function carryOver(from: PMNode, to: NodeType, overrides: Attrs = {}): Attrs {
  const out: Record<string, unknown> = {}
  const declared = new Set(Object.keys(to.spec.attrs ?? {}))
  for (const name of declared) {
    if (name in from.attrs) out[name] = from.attrs[name]
  }

  /*
   * An `id` outlives the block type it was written on.
   *
   * `heading` declares `id` and `paragraph` does not, so demoting a heading to
   * a paragraph dropped it -- and an id on a heading is not decoration, it is
   * the target of every in-page link and every table-of-contents entry pointing
   * at that section. Changing a block's type is not a request to break the
   * links to it.
   *
   * It moves into the carried residue rather than into an attribute, because
   * the destination type has no such attribute to move it into. That is exactly
   * what residue is for, and it is already where a `<p id="x">` parsed from
   * stored content keeps its id, so both routes arrive at one representation.
   */
  if (!declared.has('id') && declared.has(CARRIED_ATTR)) {
    const id = from.attrs['id']
    if (typeof id === 'string' && id !== '') {
      const carried = { ...((out[CARRIED_ATTR] as Record<string, string> | null) ?? {}) }
      if (carried['id'] === undefined) carried['id'] = id
      out[CARRIED_ATTR] = carried
    }
  }

  return { ...out, ...overrides }
}

/**
 * `setBlockType`, with per-node attributes and every selected range.
 *
 * prosemirror-commands' own `setBlockType` takes ONE attribute object and
 * applies it to every block in the selection, which cannot express "keep each
 * block's own residue". prosemirror-transform's `Transform.setBlockType` does
 * accept a function, so the applicability check and the loop are reproduced here
 * against that. The shape is deliberately the same as upstream's so the two stay
 * comparable.
 */
function setBlockTypeCarrying(
  name: string,
  overrides: (node: PMNode) => Attrs = () => ({}),
): Command {
  return (state, dispatch) => {
    const type = nodeIn(state, name)
    if (!type) return false
    const attrsFor = (node: PMNode): Attrs => carryOver(node, type, overrides(node))

    let applicable = false
    for (const range of selectedRanges(state)) {
      if (applicable) break
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (applicable) return false
        // `hasMarkup` is what makes "set paragraph on a plain paragraph" report
        // false, and it has to be asked with the attributes this call would
        // actually write -- otherwise a no-op conversion looks like a change.
        if (!node.isTextblock || node.hasMarkup(type, attrsFor(node))) return
        // A figure is a textblock (`content: 'inline+'`) but its children are an
        // image and a caption -- retyping it produces an <h2> holding a
        // <figcaption>. `heading` and `paragraph` also accept inline content, so
        // `validContent` is not enough; isolating is what marks a textblock that
        // is not a retypable paragraph.
        if (node.type.spec.isolating) return
        // `code_block` cannot hold an image or a figcaption, which is where the
        // TransformError came from when this check was missing.
        if (!type.validContent(node.content)) return
        if (node.type === type) {
          applicable = true
          return
        }
        const $pos = state.doc.resolve(pos)
        const index = $pos.index()
        applicable = $pos.parent.canReplaceWith(index, index + 1, type)
        return
      })
    }
    if (!applicable) return false

    if (dispatch) {
      const tr = state.tr
      for (const range of selectedRanges(state)) {
        // Per node, not the whole range: `setBlockType` on a span that also
        // covers a figure would still try to retype that figure, which is the
        // TransformError a select-all used to throw even after the
        // applicability check started skipping it.
        state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
          if (!node.isTextblock || node.hasMarkup(type, attrsFor(node))) return
          if (node.type.spec.isolating) return
          if (!type.validContent(node.content)) return
          if (node.type !== type) {
            const $pos = state.doc.resolve(pos)
            const index = $pos.index()
            if (!$pos.parent.canReplaceWith(index, index + 1, type)) return
          }
          const mappedFrom = tr.mapping.map(pos)
          const mappedTo = tr.mapping.map(pos + node.nodeSize)
          tr.setBlockType(mappedFrom, mappedTo, type, attrsFor)
        })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
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
  const { $from, empty } = state.selection
  if (empty) {
    return !!type.isInSet(state.storedMarks ?? $from.marks())
  }
  return anyRangeHasMark(state, type)
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
  return canInsertNode(state, nodeName)
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
  const { $from, empty } = state.selection

  if (empty) {
    const found = type.isInSet($from.marks())
    return found ? found.attrs : null
  }
  let attrs: Attrs | null = null
  for (const range of selectedRanges(state)) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (child) => {
      if (attrs) return false
      const found = type.isInSet(child.marks)
      if (found) attrs = found.attrs
      return true
    })
  }
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

export const setParagraph: Command = setBlockTypeCarrying('paragraph')

/**
 * `level` is the only attribute this command decides; everything else about the
 * block is the author's and travels with it.
 *
 * `id` needs no special case any more, and that is a property of the schema
 * rather than a shortcut: `paragraph` does not declare an `id`, so `carryOver`
 * cannot promote one from a paragraph, while a heading's own `id` is declared
 * and does come across. A paragraph stored as `<p id="x">` keeps its id anyway,
 * through the carried residue, which is where an unmodelled attribute belongs.
 */
export function setHeading(level: number): Command {
  return setBlockTypeCarrying('heading', () => ({ level }))
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
  return setBlockTypeCarrying('code_block')(state, dispatch, view)
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
      const node = state.doc.nodeAt(enclosing.pos)
      if (!node) return false
      // Attributes must be passed explicitly. `setNodeMarkup(pos, type)` reads
      // as "change the type and leave the rest alone" and does not do that:
      // prosemirror-transform calls `type.create(undefined, ...)`, so every
      // attribute silently reverts to its default. `start` is genuinely dropped
      // here because a `<ul>` has no such concept; `listStyle` and the residue
      // holding `class` and every `data-*` are not.
      if (dispatch) {
        dispatch(state.tr.setNodeMarkup(enclosing.pos, type, carryOver(node, type)).scrollIntoView())
      }
      return true
    }
    return nodeCommand(target, (type) => wrapInList(type))(state, dispatch, view)
  }
}

/**
 * Split a list item, including items that hold extra `block*` after the
 * paragraph.
 *
 * Stock `splitListItem` already splits a non-empty item at depth 2, so
 * following blocks travel with the new item -- Word and Google Docs. Its empty
 * handling only runs when the empty textblock is the *last* child. Extra
 * `block*` after the paragraph skips that branch, and Enter either creates a
 * sibling `<li>` (never leaves) or the chained base keymap inserts a sibling
 * `<p>` inside the same item.
 *
 * Enter on an empty bullet is how authors leave a list. Extra children are
 * promoted to siblings of the list and the empty paragraph is dropped so we
 * do not store `<p></p>` next to a callout. Nested empty last inner items
 * (no extra children) still go through stock, which outdents one level.
 */
function splitListItemAllowingExtraBlocks(itemType: NodeType): Command {
  const split = splitListItem(itemType)
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    if ($from.depth >= 3 && $from.sameParent($to) && $from.node(-1).type === itemType) {
      if ($from.parent.content.size === 0 && $from.node(-1).childCount > $from.indexAfter(-1)) {
        return leaveListPromotingExtra(state, dispatch)
      }
    }
    return split(state, dispatch)
  }
}

function leaveListPromotingExtra(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from } = state.selection
  const item = $from.node(-1)
  const emptyIndex = $from.index(-1)
  const kept: PMNode[] = []
  for (let i = 0; i < item.childCount; i++) {
    if (i !== emptyIndex) kept.push(item.child(i))
  }

  const list = $from.node(-2)
  const itemIndex = $from.index(-2)
  const before: PMNode[] = []
  const after: PMNode[] = []
  for (let i = 0; i < list.childCount; i++) {
    if (i < itemIndex) before.push(list.child(i))
    else if (i > itemIndex) after.push(list.child(i))
  }

  const beforeList = before.length > 0 ? list.copy(Fragment.from(before)) : null
  const afterList = after.length > 0 ? list.copy(Fragment.from(after)) : null
  const replacement: PMNode[] = []
  if (beforeList) replacement.push(beforeList)
  replacement.push(...kept)
  if (afterList) replacement.push(afterList)

  const parent = $from.node(-3)
  const listIndex = $from.index(-3)
  const replaceFrag = Fragment.from(replacement)
  if (!parent.canReplace(listIndex, listIndex + 1, replaceFrag)) return false
  if (dispatch) {
    const listPos = $from.before(-2)
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, replaceFrag)
    const beforeSize = beforeList ? beforeList.nodeSize : 0
    tr.setSelection(Selection.near(tr.doc.resolve(listPos + beforeSize)))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const splitListItemCommand: Command = nodeCommand('list_item', splitListItemAllowingExtraBlocks)
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
  // Deduplicated by position: callers write one `setNodeMarkup` per entry, and
  // two writes to the same position in one transaction would have the second
  // one built from a node the first already replaced.
  const seen = new Set<number>()
  for (const range of selectedRanges(state)) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) return true
      if (Object.hasOwn(node.attrs, attr) && !seen.has(pos)) {
        seen.add(pos)
        found.push({ pos, node })
      }
      return false
    })
  }
  return found
}

function uniformBlockAttr<T>(state: EditorState, attr: string): T | null {
  const blocks = blocksWithAttr(state, attr)
  const first = blocks[0]
  if (!first) return null
  const value = (first.node.attrs[attr] as T | null) ?? null
  return blocks.every((b) => (b.node.attrs[attr] ?? null) === value) ? value : null
}

/**
 * True when this alignment is one an image can store.
 *
 * `image.attrs.align` is `left` / `right` / `center` (a float or a block
 * centre). Justify is a text-block value only: writing it onto an image
 * would serialize as the class `undefined`.
 */
function isImageAlign(align: Align | null): boolean {
  return align === null || (IMAGE_ALIGNMENTS as readonly string[]).includes(align)
}

/**
 * The nodes in the selection that can carry an alignment.
 *
 * Textblocks that declare `align`, and `image` nodes whose alignment is a
 * float/centre class rather than `text-align`. A NodeSelection on an image
 * -- or on the figure wrapping one -- is only that image: walking the parent
 * paragraph as well would float the picture AND centre the paragraph, which
 * is not what Align right means when the author has clicked the picture.
 *
 * `blocksWithAttr` stops inside a textblock, so it never sees an inline
 * image. Alignment has to look inside, but only for a non-empty range: a
 * caret beside an image must not retarget it, the same trap `selectedImage`
 * refuses.
 */
function alignableBlocks(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const selected = selectedImage(state)
  if (selected) {
    const node = state.doc.nodeAt(selected.pos)
    return node && node.type.name === 'image' ? [{ pos: selected.pos, node }] : []
  }

  const found: Array<{ pos: number; node: PMNode }> = []
  const seen = new Set<number>()
  for (const range of selectedRanges(state)) {
    const from = range.$from.pos
    const to = range.$to.pos
    const coverImages = from !== to
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (coverImages && node.type.name === 'image' && Object.hasOwn(node.attrs, 'align') && !seen.has(pos)) {
        seen.add(pos)
        found.push({ pos, node })
      }
      if (!node.isTextblock) return true
      if (Object.hasOwn(node.attrs, 'align') && !seen.has(pos)) {
        seen.add(pos)
        found.push({ pos, node })
      }
      return coverImages
    })
  }
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
 * Set the alignment of every alignable node in the selection. `null` clears it.
 *
 * Images store `left` / `right` / `center` on `image.attrs.align`; serialization
 * maps those to the `ol-*` classes. Justify is skipped on images, because it
 * is not an image alignment.
 *
 * Reports true whenever there is something to align, even if it already carries
 * this value. The alternative -- returning false because the work is already
 * done -- would make the toolbar render the button for the CURRENT alignment as
 * disabled, since a command's no-dispatch call is what drives enabled state.
 */
export function setTextAlign(align: Align | null): Command {
  return (state, dispatch) => {
    const blocks = alignableBlocks(state).filter(
      ({ node }) => node.type.name !== 'image' || isImageAlign(align),
    )
    if (blocks.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      const selected = selectedImage(state)
      for (const { pos, node } of blocks) {
        // No position mapping needed: an attribute-only change replaces a node
        // with one of identical size, so earlier edits cannot shift later
        // positions in this loop.
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
      }
      // Keep a clicked image selected. `setNodeMarkup` replaces the node, and
      // without this the selection collapses beside it -- `activeTextAlign`
      // would then read the parent paragraph and the toolbar would go dark.
      if (selected) {
        tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(selected.pos)))
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

    const { empty } = state.selection

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

    if (value === null && !anyRangeHasMark(state, type)) return false
    if (dispatch) {
      const tr = state.tr
      replaceMarkInRanges(state, tr, type, value === null ? null : { color: value })
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Attribute of a colour mark across the selection, or null when absent or mixed. */
function activeColor(state: EditorState, name: string): string | null {
  const type = markIn(state, name)
  if (!type) return null
  const { empty, $from } = state.selection

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
  // Over every range, for the same reason the command below writes over every
  // range: reading one cell of a selected column and reporting it as the state
  // of all of them puts a colour in the swatch that most of the selection does
  // not have.
  for (const range of selectedRanges(state)) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (child) => {
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
  }
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

    const { empty } = state.selection
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

    if (next === null && !anyRangeHasMark(state, type)) return false
    if (dispatch) {
      const tr = state.tr
      replaceMarkInRanges(state, tr, type, next === null ? null : { [attr]: next })
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

function activeMarkAttr(state: EditorState, name: string, attr: string): string | null {
  const type = markIn(state, name)
  if (!type) return null
  const { empty, $from } = state.selection

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
  for (const range of selectedRanges(state)) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (child) => {
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
  }
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
 * content. Language stays: it is the same kind of fact as direction, only
 * modelled as a mark (`<span lang>`) rather than a node attribute. Headings
 * and lists stay: they are structure. Alignment, indent, line height, fonts,
 * colours, and the common character marks go.
 */
export const clearFormatting: Command = (state, dispatch) => {
  const keep = new Set(['link', 'language'])
  const { empty, $from } = state.selection
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
    if (anyRangeHasMark(state, type)) hasMarks = true
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
    for (const type of marks) {
      for (const range of selectedRanges(state)) {
        tr = tr.removeMark(range.$from.pos, range.$to.pos, type)
      }
    }
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

export {
  insertAudio,
  insertDetails,
  insertHtml,
  insertIframe,
  insertImage,
  insertNamedAnchor,
  insertNonBreakingSpace,
  insertPageBreak,
  insertText,
  insertVideo,
  selectedImage,
  selectedMedia,
  setHeadingId,
  setLink,
  unsetLink,
  updateImage,
  updateMedia,
  type ImageAttrs,
  type LinkAttrs,
  type MediaAttrs,
  type MediaSource,
  type SelectedImage,
  type SelectedMedia,
} from './insert-commands.js'

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export { redo, undo } from 'prosemirror-history'

export const canUndo: (state: EditorState) => boolean = (state) => undo(state)
export const canRedo: (state: EditorState) => boolean = (state) => redo(state)
