/**
 * Quick-insert table grid.
 *
 * A 8×8 chooser next to the Insert table button. A modal asking for rows and
 * columns is slower than the grid every other editor ships, and a hardcoded
 * 3×3 is what authors then spend the rest of the session repairing.
 *
 * The trigger is the one toolbar tab stop. The grid lives on the host, not in
 * the toolbar element, for the same reason the colour picker does: the bar's
 * roving tabindex walks every `button.ol-btn` inside itself.
 */

import { iconElement, type ToolbarContext, type ToolbarControl } from '@openleaf-editor/ui'
import { canInsert } from '@openleaf-editor/core'
import type { EditorState } from 'prosemirror-state'
import { insertTable } from './commands.js'

export const GRID_SIZE = 8

const SUPPORTS_POPOVER =
  typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

export function buildInsertGrid(ctx: ToolbarContext): ToolbarControl {
  const { view, host } = ctx
  const doc = host.ownerDocument

  const wrap = doc.createElement('div')
  wrap.className = 'ol-table-grid'

  const trigger = doc.createElement('button')
  trigger.type = 'button'
  trigger.className = 'ol-btn'
  trigger.dataset['olId'] = ctx.id ?? 'insertTable'
  trigger.setAttribute('aria-label', 'Insert table')
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.title = 'Insert table'
  trigger.appendChild(iconElement('table', doc))
  wrap.appendChild(trigger)

  const popover = doc.createElement('div')
  popover.className = 'ol-table-pop'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', 'Table size')
  if (SUPPORTS_POPOVER) popover.setAttribute('popover', 'manual')
  else popover.hidden = true

  const status = doc.createElement('div')
  status.className = 'ol-table-pop-status'
  status.setAttribute('aria-live', 'polite')
  status.textContent = '1 × 1'

  const grid = doc.createElement('div')
  grid.className = 'ol-table-size'
  grid.setAttribute('role', 'grid')

  const cells: HTMLButtonElement[] = []
  for (let row = 1; row <= GRID_SIZE; row += 1) {
    const gridRow = doc.createElement('div')
    gridRow.setAttribute('role', 'row')
    gridRow.className = 'ol-table-size-row'
    for (let col = 1; col <= GRID_SIZE; col += 1) {
      const cell = doc.createElement('button')
      cell.type = 'button'
      cell.className = 'ol-table-size-cell'
      cell.setAttribute('role', 'gridcell')
      cell.setAttribute('aria-label', `${row} by ${col} table`)
      cell.dataset['olRows'] = String(row)
      cell.dataset['olCols'] = String(col)
      cell.tabIndex = row === 1 && col === 1 ? 0 : -1
      gridRow.appendChild(cell)
      cells.push(cell)
    }
    grid.appendChild(gridRow)
  }

  popover.append(status, grid)

  let open = false
  let hoverRows = 1
  let hoverCols = 1

  const paint = (rows: number, cols: number): void => {
    hoverRows = rows
    hoverCols = cols
    status.textContent = `${rows} × ${cols}`
    for (const cell of cells) {
      const r = Number(cell.dataset['olRows'])
      const c = Number(cell.dataset['olCols'])
      cell.setAttribute('aria-pressed', r <= rows && c <= cols ? 'true' : 'false')
    }
  }

  const position = (): void => {
    const rect = trigger.getBoundingClientRect()
    popover.style.position = 'fixed'
    popover.style.left = `${Math.round(rect.left)}px`
    popover.style.top = `${Math.round(rect.bottom + 4)}px`
  }

  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    if (popover.contains(target) || trigger.contains(target)) return
    close()
  }

  const onViewportChange = (): void => close()

  const show = (): void => {
    if (open) return
    if (!popover.isConnected) host.appendChild(popover)
    position()
    if (SUPPORTS_POPOVER) (popover as HTMLElement & { showPopover(): void }).showPopover()
    else popover.hidden = false
    open = true
    trigger.setAttribute('aria-expanded', 'true')
    paint(1, 1)
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.defaultView?.addEventListener('resize', onViewportChange)
    doc.defaultView?.addEventListener('scroll', onViewportChange, true)
    cells[0]?.focus()
  }

  const close = (options: { returnFocus?: 'trigger' | 'content' | 'none' } = {}): void => {
    if (!open) return
    if (SUPPORTS_POPOVER) (popover as HTMLElement & { hidePopover(): void }).hidePopover()
    else popover.hidden = true
    open = false
    trigger.setAttribute('aria-expanded', 'false')
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.defaultView?.removeEventListener('resize', onViewportChange)
    doc.defaultView?.removeEventListener('scroll', onViewportChange, true)
    if (options.returnFocus === 'trigger') trigger.focus()
    else if (options.returnFocus === 'content') view.focus()
  }

  const choose = (rows: number, cols: number): void => {
    insertTable(rows, cols)(view.state, view.dispatch, view)
    close({ returnFocus: 'content' })
  }

  const focusCell = (rows: number, cols: number): void => {
    const next = cells.find(
      (cell) => Number(cell.dataset['olRows']) === rows && Number(cell.dataset['olCols']) === cols,
    )
    if (!next) return
    for (const cell of cells) cell.tabIndex = cell === next ? 0 : -1
    paint(rows, cols)
    next.focus()
  }

  trigger.addEventListener('mousedown', (event) => event.preventDefault())
  trigger.addEventListener('click', () => {
    if (!canInsert(view.state, 'table')) return
    // A custom control never goes through the toolbar's own guard, so the
    // `aria-disabled` the bar writes onto this trigger only means anything if
    // the trigger reads it back.
    if (host.hasAttribute('readonly') || trigger.getAttribute('aria-disabled') === 'true') return
    if (open) close({ returnFocus: 'content' })
    else show()
  })

  for (const cell of cells) {
    cell.addEventListener('mouseenter', () => {
      paint(Number(cell.dataset['olRows']), Number(cell.dataset['olCols']))
    })
    cell.addEventListener('click', () => {
      choose(Number(cell.dataset['olRows']), Number(cell.dataset['olCols']))
    })
  }

  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close({ returnFocus: 'trigger' })
      return
    }
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || !cells.includes(target)) return
    let rows = Number(target.dataset['olRows'])
    let cols = Number(target.dataset['olCols'])
    const move = (nextRows: number, nextCols: number): void => {
      event.preventDefault()
      focusCell(
        Math.max(1, Math.min(GRID_SIZE, nextRows)),
        Math.max(1, Math.min(GRID_SIZE, nextCols)),
      )
    }
    switch (event.key) {
      case 'ArrowRight':
        move(rows, cols + 1)
        break
      case 'ArrowLeft':
        move(rows, cols - 1)
        break
      case 'ArrowDown':
        move(rows + 1, cols)
        break
      case 'ArrowUp':
        move(rows - 1, cols)
        break
      case 'Home':
        move(rows, 1)
        break
      case 'End':
        move(rows, GRID_SIZE)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(hoverRows, hoverCols)
        break
      default:
        break
    }
  })

  popover.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!open) return
      const active = doc.activeElement
      if (active && (popover.contains(active) || trigger.contains(active))) return
      close()
    }, 0)
  })

  return {
    el: wrap,
    update(state: EditorState) {
      const enabled = canInsert(state, 'table')
      trigger.setAttribute('aria-disabled', enabled ? 'false' : 'true')
    },
    destroy() {
      close()
      popover.remove()
    },
  }
}
