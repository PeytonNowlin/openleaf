import { iconElement, type ToolbarContext, type ToolbarControl } from '@openleaf-editor/ui'
import { insertText } from '@openleaf-editor/core'
import type { EditorState } from 'prosemirror-state'

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
  trigger.setAttribute('aria-haspopup', 'true')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.appendChild(iconElement(options.icon, doc))

  const grid = doc.createElement('div')
  grid.className = 'ol-insert-grid'
  grid.setAttribute('role', 'menu')
  grid.setAttribute('aria-label', options.label)
  if (SUPPORTS_POPOVER) grid.setAttribute('popover', 'manual')

  for (const item of options.items) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.textContent = item.char
    button.setAttribute('aria-label', item.name)
    button.title = item.name
    button.addEventListener('click', () => {
      insertText(item.char)(view.state, view.dispatch, view)
      close()
      view.focus()
    })
    grid.appendChild(button)
  }

  wrap.appendChild(trigger)
  if (!SUPPORTS_POPOVER) wrap.appendChild(grid)
  else doc.body.appendChild(grid)

  const isOpen = (): boolean =>
    SUPPORTS_POPOVER ? grid.matches(':popover-open') : !grid.hidden

  const close = (): void => {
    trigger.setAttribute('aria-expanded', 'false')
    if (!SUPPORTS_POPOVER) {
      grid.hidden = true
      return
    }
    // Guarded: hidePopover() throws on an element that is not showing, and
    // destroy() closes whether or not the picker was ever opened.
    if (grid.matches(':popover-open')) {
      ;(grid as HTMLElement & { hidePopover(): void }).hidePopover()
    }
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

  const open = (): void => {
    trigger.setAttribute('aria-expanded', 'true')
    if (!SUPPORTS_POPOVER) grid.hidden = false
    else if (!grid.matches(':popover-open')) {
      ;(grid as HTMLElement & { showPopover(): void }).showPopover()
    }
    place()
    grid.querySelector('button')?.focus()
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
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      close()
      trigger.focus()
    }
  })

  /*
   * Three behaviours the colour picker records as necessary and this grid did
   * without: keeping the selection through a mousedown -- whose absence WebKit
   * turns into a control that closes as though it had worked -- dismissal by a
   * click elsewhere, and closing when the page moves under a panel positioned
   * against the viewport.
   */
  for (const button of grid.querySelectorAll('button')) {
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
