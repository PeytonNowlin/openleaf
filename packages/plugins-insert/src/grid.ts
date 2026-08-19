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

  const close = (): void => {
    trigger.setAttribute('aria-expanded', 'false')
    if (SUPPORTS_POPOVER && 'hidePopover' in grid) (grid as HTMLElement & { hidePopover(): void }).hidePopover()
    else grid.hidden = true
  }

  const open = (): void => {
    trigger.setAttribute('aria-expanded', 'true')
    if (SUPPORTS_POPOVER && 'showPopover' in grid) (grid as HTMLElement & { showPopover(): void }).showPopover()
    else {
      grid.hidden = false
      const rect = trigger.getBoundingClientRect()
      grid.style.position = 'fixed'
      grid.style.left = `${rect.left}px`
      grid.style.top = `${rect.bottom + 4}px`
    }
    grid.querySelector('button')?.focus()
  }

  grid.hidden = true
  trigger.addEventListener('click', () => {
    if (trigger.getAttribute('aria-expanded') === 'true') close()
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
