/**
 * Nested-table column-resize hit-testing.
 *
 * `columnResizing()` is installed once for the document. Its own
 * `domCellAround` walks to the innermost `TD`/`TH`, so a pointer over a nested
 * table can never grab an outer column — even when it is sitting on that
 * column's border. Nested tables are legal (`table_cell` is `block+`; Insert
 * table inside a cell is tested), and that hit-test is inside the third-party
 * plugin, not behind an option.
 *
 * Forking the plugin would mean owning `handleMouseMove` / `edgeCell` /
 * `handleDecorations` for every upstream change. The wrapping plugin below is
 * the smaller seam: it shares `columnResizingPluginKey` and the same handle
 * width, and on `mousemove` it looks at every ancestor cell. An outer border
 * within the handle width wins; otherwise it returns false and the upstream
 * plugin handles the innermost table as before.
 *
 * Plugin order is load-bearing. `EditorView.someProp` walks from the start of
 * the plugin list and stops at the first `handleDOMEvents` handler that returns
 * true, so this plugin must sit *before* `columnResizing`. Returning true after
 * setting the outer handle is what stops the innermost walk from overwriting it.
 * `mousedown` is deliberately not claimed: once `activeHandle` points at the
 * outer cell, the upstream drag logic is the right one to run.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import {
  columnResizingPluginKey,
  pointsAtCell,
  TableMap,
} from 'prosemirror-tables'
import type { EditorView } from 'prosemirror-view'

/** Matches `columnResizing`'s default. Keep the two in lockstep in `index.ts`. */
export const COLUMN_RESIZE_HANDLE_WIDTH = 5

const nestedColumnResizeKey = new PluginKey('openleaf-nested-column-resize')

export function nestedColumnResizePlugin(
  handleWidth = COLUMN_RESIZE_HANDLE_WIDTH,
): Plugin {
  return new Plugin({
    key: nestedColumnResizeKey,
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) return false
          if (!(event instanceof MouseEvent)) return false
          const pluginState = columnResizingPluginKey.getState(view.state)
          if (!pluginState || pluginState.dragging) return false

          const cell = nestedHandleCell(view, event, handleWidth)
          if (cell == null) return false
          if (cell !== pluginState.activeHandle) {
            view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cell }))
          }
          return true
        },
      },
    },
  })
}

/**
 * The cell whose column should be resized, or `null` to leave the decision to
 * `columnResizing`.
 *
 * `null` covers "no nesting", "pointer is not on an outer edge", and "the only
 * matching edge is the innermost one". Those are all cases the upstream plugin
 * already handles, and intercepting them would mean reimplementing it.
 */
function nestedHandleCell(view: EditorView, event: MouseEvent, handleWidth: number): number | null {
  const cells = ancestorCells(event.target)
  if (cells.length < 2) return null

  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const td = cells[i]!
    const { left, right } = td.getBoundingClientRect()
    let side: 'left' | 'right' | null = null
    if (event.clientX - left <= handleWidth) side = 'left'
    else if (right - event.clientX <= handleWidth) side = 'right'
    if (!side) continue

    const cellPos = cellPosFromDOM(view, td)
    if (cellPos == null) continue
    const handle = handleCellForSide(view, cellPos, side)
    if (handle < 0) continue
    if (!pointsAtCell(view.state.doc.resolve(handle))) continue

    // Innermost match: `columnResizing` will pick the same cell.
    if (i === 0) return null
    return handle
  }
  return null
}

/** Innermost first, walking out through nested tables to the editor root. */
function ancestorCells(target: EventTarget | null): HTMLElement[] {
  const cells: HTMLElement[] = []
  let node: Node | null = target instanceof Node ? target : null
  while (node) {
    if (node instanceof HTMLElement) {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') cells.push(node)
      if (node.classList.contains('ProseMirror')) break
    }
    node = node.parentNode
  }
  return cells
}

function cellPosFromDOM(view: EditorView, td: HTMLElement): number | null {
  let pos: number
  try {
    pos = view.posAtDOM(td, 0)
  } catch {
    return null
  }
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec['tableRole'] as string | undefined
    if (role !== 'cell' && role !== 'header_cell') continue
    const cellPos = $pos.before(depth)
    const dom = view.nodeDOM(cellPos)
    if (!dom) continue
    if (dom === td) return cellPos
    if (td.contains(dom)) return cellPos
    if (dom instanceof Node && dom.contains(td)) return cellPos
  }
  return null
}

/**
 * Same mapping as upstream `edgeCell`: the right edge resizes this cell's
 * column, the left edge resizes the previous one, and the first column's left
 * edge is not a handle.
 *
 * `edgeCell` itself cannot be reused. It calls `posAtCoords` and then
 * `cellAround`, both of which resolve to the innermost cell under the pointer
 * — the original bug.
 */
function handleCellForSide(view: EditorView, cellPos: number, side: 'left' | 'right'): number {
  const $cell = view.state.doc.resolve(cellPos)
  const role = $cell.nodeAfter?.type.spec['tableRole'] as string | undefined
  if (role !== 'cell' && role !== 'header_cell') return -1
  if (side === 'right') return $cell.pos

  const table = $cell.node(-1)
  if (table.type.spec['tableRole'] !== 'table') return -1
  const map = TableMap.get(table)
  const start = $cell.start(-1)
  const index = map.map.indexOf($cell.pos - start)
  if (index < 0) return -1
  if (index % map.width === 0) return -1
  const prev = map.map[index - 1]
  return prev == null ? -1 : start + prev
}
