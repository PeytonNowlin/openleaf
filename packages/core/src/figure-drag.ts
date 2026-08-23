/**
 * Dragging the image inside a captioned figure must move the figure.
 *
 * `image` is `draggable: true`; `figure` is not. ProseMirror's dragstart
 * therefore builds a NodeSelection on the `<img>` (`pos.inside` is the image,
 * not the figure), and the default drop moves only that node. The caption
 * stays behind. An image-less `<figure><figcaption>` is illegal on the next
 * parse.
 *
 * Marking `figure` draggable is not enough -- mousedown still resolves to the
 * image. Making figure an atom would kill caption editing. Caption text
 * drags are left alone: only a NodeSelection on the image whose parent is
 * figure is claimed.
 */

import { Fragment, Slice } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state'
import { dropPoint } from 'prosemirror-transform'
import type { EditorView } from 'prosemirror-view'

const key = new PluginKey('openleaf-figure-drag')

type Dragging = {
  slice: Slice
  move: boolean
  node?: NodeSelection
}

function draggedImageInFigure(view: EditorView): NodeSelection | null {
  const dragging = view.dragging as Dragging | null
  if (!dragging) return null
  // dragstart stores the image NodeSelection on `dragging.node` and does not
  // dispatch it. A pre-selected image drag leaves `node` unset and uses the
  // state's NodeSelection instead.
  const sel =
    dragging.node ??
    (view.state.selection instanceof NodeSelection ? view.state.selection : null)
  if (!sel || sel.node.type.name !== 'image') return null
  if (sel.$from.parent.type.name !== 'figure') return null
  return sel
}

/**
 * If the drag is a NodeSelection on an image inside a figure, insert (or
 * move) the whole figure at `pos`. Returns true when it handled the drop.
 *
 * `copy` is the inverse of ProseMirror's drop `moved` flag: Alt on Mac / Ctrl
 * elsewhere copies. One transaction so undo is a single step.
 */
export function dropFigureForDraggedImage(
  view: EditorView,
  pos: number,
  copy: boolean,
): boolean {
  if (!view.editable) return false
  const sel = draggedImageInFigure(view)
  if (!sel) return false

  const figure = sel.$from.parent
  const from = sel.$from.before(sel.$from.depth)
  const slice = new Slice(Fragment.from(figure), 0, 0)
  const insertPos = dropPoint(view.state.doc, pos, slice)
  if (insertPos == null) return false

  const tr = view.state.tr
  if (!copy) tr.delete(from, from + figure.nodeSize)
  const dest = tr.mapping.map(insertPos)
  tr.insert(dest, figure)
  tr.setSelection(NodeSelection.create(tr.doc, dest))
  view.dispatch(tr.scrollIntoView())
  return true
}

export function figureDragPlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      handleDrop(view, event, _slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!coords) return false
        return dropFigureForDraggedImage(view, coords.pos, !moved)
      },
    },
  })
}
