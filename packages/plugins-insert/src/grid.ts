import { iconElement, type ToolbarContext, type ToolbarControl } from '@openleaf-editor/ui'
import { insertText } from '@openleaf-editor/core'
import type { EditorState } from 'prosemirror-state'
import { GLYPH_COLUMNS } from './glyphs.js'

const SUPPORTS_POPOVER =
  typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

export function buildGlyphPicker(
  ctx: ToolbarContext,
  options: {
    label: string
    icon: string
    items: ReadonlyArray<{ char: string; name: string }>
  },
): ToolbarControl {
  const { view, host } = ctx
  const doc = host.ownerDocument
  const wrap = doc.createElement('div')

  const trigger = doc.createElement('button')
  trigger.type = 'button'
  trigger.className = 'ol-btn'
  trigger.dataset['olId'] = ctx.id ?? options.label
  trigger.setAttribute('aria-label', options.label)
  trigger.setAttribute('aria-haspopup', 'grid')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.appendChild(iconElement(options.icon, doc))

  /*
   * A real grid, not a pile of buttons under role="menu". menu requires
   * menuitem children; a <button>'s implicit role is button, so a reader
   * announced a menu with no items while forty focusable buttons sat inside
   * it. Follows plugins-colour/src/picker.ts, which follows plugins-table.
   */
  const grid = doc.createElement('div')
  grid.className = 'ol-insert-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', options.label)
  if (SUPPORTS_POPOVER) grid.setAttribute('popover', 'manual')

  const cells: HTMLButtonElement[] = []
  let row: HTMLDivElement | null = null
  options.items.forEach((item, index) => {
    if (index % GLYPH_COLUMNS === 0) {
      row = doc.createElement('div')
      row.className = 'ol-insert-row'
      row.setAttribute('role', 'row')
      grid.appendChild(row)
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.textContent = item.char
    button.setAttribute('role', 'gridcell')
    button.setAttribute('aria-label', item.name)
    button.title = item.name
    // One tab stop for the whole grid; the arrow keys move within it.
    button.tabIndex = index === 0 ? 0 : -1
    button.addEventListener('click', () => {
      insertText(item.char)(view.state, view.dispatch, view)
      close()
      view.focus()
    })
    cells.push(button)
    row?.appendChild(button)
  })

  wrap.appendChild(trigger)
  if (!SUPPORTS_POPOVER) wrap.appendChild(grid)
  else doc.body.appendChild(grid)

  const isOpen = (): boolean =>
    SUPPORTS_POPOVER ? grid.matches(':popover-open') : !grid.hidden

  const close = (options: { returnFocus?: boolean } = {}): void => {
    trigger.setAttribute('aria-expanded', 'false')
    if (!SUPPORTS_POPOVER) {
      grid.hidden = true
    } else if (grid.matches(':popover-open')) {
      // Guarded: hidePopover() throws on an element that is not showing, and
      // destroy() closes whether or not the picker was ever opened.
      ;(grid as HTMLElement & { hidePopover(): void }).hidePopover()
    }
    if (options.returnFocus) trigger.focus()
  }

  /**
   * Anchor the grid under its trigger, and keep it on screen.
   *
   * The popover path needs this as much as the fallback does: UA styles for
   * `[popover]` are `position: fixed; inset: 0; margin: auto`, which centres the
   * panel in the viewport rather than putting it under the button that opened
   * it. Measured after showing, because a hidden element has no size to clamp.
   */
  const place = (): void => {
    const trigger_ = trigger.getBoundingClientRect()
    const win = doc.defaultView
    const viewWidth = win?.innerWidth ?? 0
    const viewHeight = win?.innerHeight ?? 0
    grid.style.position = 'fixed'
    grid.style.margin = '0'
    const box = grid.getBoundingClientRect()
    const left = Math.max(4, Math.min(trigger_.left, viewWidth - box.width - 4))
    // Flipped above the trigger when there is no room below it.
    const below = trigger_.bottom + 4
    const top = below + box.height > viewHeight ? Math.max(4, trigger_.top - box.height - 4) : below
    grid.style.left = `${Math.round(left)}px`
    grid.style.top = `${Math.round(top)}px`
  }

  const focusCell = (button: HTMLButtonElement | undefined): void => {
    if (!button) return
    for (const cell of cells) cell.tabIndex = cell === button ? 0 : -1
    button.focus()
  }

  const open = (): void => {
    trigger.setAttribute('aria-expanded', 'true')
    if (!SUPPORTS_POPOVER) grid.hidden = false
    else if (!grid.matches(':popover-open')) {
      ;(grid as HTMLElement & { showPopover(): void }).showPopover()
    }
    place()
    const current = cells.find((cell) => cell.tabIndex === 0)
    focusCell(current ?? cells[0])
  }

  // `hidden` is the fallback path's only lever. On the popover path the popover
  // state is what closes the grid, and leaving `hidden` set as well would fight
  // the stylesheet rule that implements it -- showPopover() would open a grid
  // that `[hidden]` still keeps at display:none.
  if (!SUPPORTS_POPOVER) grid.hidden = true

  // Custom controls bypass the toolbar's own `#invoke` guard entirely, so the
  // `aria-disabled` it writes onto the trigger is decoration unless the control
  // reads it back. The colour picker does; this one did not.
  trigger.addEventListener('mousedown', (event) => event.preventDefault())
  trigger.addEventListener('click', () => {
    if (isOpen()) close()
    else if (!host.hasAttribute('readonly') && trigger.getAttribute('aria-disabled') !== 'true') {
      open()
    }
  })
  grid.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close({ returnFocus: true })
      return
    }

    /*
     * Tab is handled, and that reverses the note below about leaving it alone.
     *
     * Leaving it to the engine is correct in Chromium: the popover sits at the
     * end of <body>, so Tab walks off the end of the document, and the focusout
     * handler closes the panel. Firefox does not move focus at all -- measured,
     * not inferred: after Tab, `document.activeElement` is still the cell and
     * the popover is still open. That is a keyboard trap (WCAG 2.1.2 No
     * Keyboard Trap), and Escape being the only way out is exactly the failure
     * the arrow-key model was added to prevent.
     *
     * So the widget decides instead of the engine, the same way it decides for
     * Escape: close, return focus to the trigger, and do NOT preventDefault, so
     * the browser's own Tab then runs from the trigger and lands wherever it
     * would have landed had the panel never been open. Shift+Tab keeps working
     * backwards for free, which an interception would have had to reimplement.
     */
    if (event.key === 'Tab') {
      close({ returnFocus: true })
      return
    }

    const index = cells.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return

    const move = (next: number): void => {
      event.preventDefault()
      focusCell(cells[Math.max(0, Math.min(next, cells.length - 1))])
    }
    const rowIndex = Math.floor(index / GLYPH_COLUMNS)

    switch (event.key) {
      case 'ArrowRight':
        move(index + 1)
        break
      case 'ArrowLeft':
        move(index - 1)
        break
      case 'ArrowDown':
        move(index + GLYPH_COLUMNS)
        break
      case 'ArrowUp':
        move(index - GLYPH_COLUMNS)
        break
      case 'Home':
        move(rowIndex * GLYPH_COLUMNS)
        break
      case 'End':
        move(rowIndex * GLYPH_COLUMNS + GLYPH_COLUMNS - 1)
        break
      default:
        break
    }
  })

  // Leaving by any route closes -- pointer, Escape, Tab, or focus moving for a
  // reason this widget never hears about. The colour picker's failure mode was a
  // hand-rolled popover left open with nowhere to go.
  //
  // Tab is handled above rather than swallowed. Swallowing it outright is what
  // once closed the panel while focus sat on the first glyph, which left one of
  // forty characters reachable from the keyboard; moving focus first and letting
  // the default action run is the part that makes it safe.
  grid.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isOpen()) return
      const active = doc.activeElement
      if (active && (grid.contains(active) || trigger.contains(active))) return
      close()
    }, 0)
  })

  /*
   * Four behaviours the colour picker records as necessary. The first three
   * this grid already had: keeping the selection through a mousedown -- whose
   * absence WebKit turns into a control that closes as though it had worked --
   * dismissal by a click elsewhere, and closing when the page moves under a
   * panel positioned against the viewport. The fourth is the keyboard model
   * above: arrows, Home, End, a roving tabindex, and Tab left alone.
   */
  for (const button of cells) {
    button.addEventListener('mousedown', (event) => event.preventDefault())
  }

  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node) || grid.contains(target) || trigger.contains(target)) return
    close()
  }
  const onViewportChange = (): void => {
    if (isOpen()) close()
  }
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.defaultView?.addEventListener('scroll', onViewportChange, true)
  doc.defaultView?.addEventListener('resize', onViewportChange)

  return {
    el: wrap,
    update: (_state: EditorState) => undefined,
    destroy: () => {
      close()
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.defaultView?.removeEventListener('scroll', onViewportChange, true)
      doc.defaultView?.removeEventListener('resize', onViewportChange)
      if (SUPPORTS_POPOVER) grid.remove()
    },
  }
}
