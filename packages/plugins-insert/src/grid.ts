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
  trigger.dataset['olId'] = options.label
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

  trigger.addEventListener('click', () => {
    if (isOpen()) close()
    else open()
  })
  grid.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
    }
  })

  return {
    el: wrap,
    update: (_state: EditorState) => undefined,
    destroy: () => {
      close()
      if (SUPPORTS_POPOVER) grid.remove()
    },
  }
}
