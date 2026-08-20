/**
 * Table context menu.
 *
 * Right-click (and Shift+F10, which fires `contextmenu`) on a table opens the
 * same commands the toolbar exposes, plus the property dialogs. Authors who
 * live in the document rather than the bar should not have to leave the cell
 * they are editing to add a row.
 *
 * Bound on `view.dom` rather than `handleDOMEvents`, because cell-selection
 * handling in `prosemirror-tables` can swallow the event before a later plugin
 * sees it. A capture listener on the editable surface always runs first.
 */

import type { Command } from 'prosemirror-state'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { deleteColumn, deleteRow, deleteTable, mergeCells, splitCell } from 'prosemirror-tables'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  findTable,
  inTable,
  toggleHeaderRow,
} from './commands.js'
import { openCaptionDialog, openCellProperties, openRowProperties, openTableProperties } from './dialogs.js'

interface MenuItem {
  label: string
  run: (view: EditorView, host: HTMLElement) => void
  enabled?: (view: EditorView) => boolean
}

function commandItem(label: string, command: Command): MenuItem {
  return {
    label,
    enabled: (view) => command(view.state),
    run: (view) => {
      command(view.state, view.dispatch, view)
    },
  }
}

function groups(): { items: MenuItem[] }[] {
  return [
    {
      items: [
        commandItem('Insert row above', addRowBefore),
        commandItem('Insert row below', addRowAfter),
        commandItem('Delete row', deleteRow),
      ],
    },
    {
      items: [
        commandItem('Insert column before', addColumnBefore),
        commandItem('Insert column after', addColumnAfter),
        commandItem('Delete column', deleteColumn),
      ],
    },
    {
      items: [
        commandItem('Merge cells', mergeCells),
        commandItem('Split cell', splitCell),
        commandItem('Toggle header row', toggleHeaderRow),
      ],
    },
    {
      items: [
        {
          label: 'Table properties',
          run: (view, host) => {
            void openTableProperties(view, host)
          },
        },
        {
          label: 'Row properties',
          run: (view, host) => {
            void openRowProperties(view, host)
          },
        },
        {
          label: 'Cell properties',
          run: (view, host) => {
            void openCellProperties(view, host)
          },
        },
        {
          label: 'Caption',
          run: (view, host) => {
            void openCaptionDialog(view, host)
          },
        },
      ],
    },
    {
      items: [commandItem('Delete table', deleteTable)],
    },
  ]
}

export function tableContextMenu(): Plugin {
  return new Plugin({
    view(view) {
      let menu: HTMLElement | null = null
      let open = false

      const hostFor = (): HTMLElement =>
        (view.dom.closest('openleaf-editor') as HTMLElement | null) ??
        view.dom.parentElement ??
        view.dom

      const close = (returnFocus = false): void => {
        if (!open || !menu) return
        menu.hidden = true
        open = false
        view.dom.ownerDocument.removeEventListener('pointerdown', onPointerDown, true)
        if (returnFocus) view.focus()
      }

      const onPointerDown = (event: Event): void => {
        const target = event.target
        if (!(target instanceof Node) || menu?.contains(target)) return
        close()
      }

      const fill = (): void => {
        if (!menu) return
        menu.replaceChildren()
        const doc = menu.ownerDocument
        for (const group of groups()) {
          const list = doc.createElement('div')
          list.className = 'ol-table-menu-group'
          for (const item of group.items) {
            const button = doc.createElement('button')
            button.type = 'button'
            button.className = 'ol-table-menu-item'
            button.setAttribute('role', 'menuitem')
            button.tabIndex = -1
            button.textContent = item.label
            const enabled = item.enabled ? item.enabled(view) : true
            button.setAttribute('aria-disabled', enabled ? 'false' : 'true')
            button.addEventListener('click', () => {
              if (!enabled) return
              close()
              item.run(view, hostFor())
            })
            list.appendChild(button)
          }
          menu.appendChild(list)
        }
      }

      const showAt = (x: number, y: number): void => {
        const host = hostFor()
        if (!menu) {
          menu = host.ownerDocument.createElement('div')
          menu.className = 'ol-table-menu'
          menu.setAttribute('role', 'menu')
          menu.setAttribute('aria-label', 'Table')
          host.appendChild(menu)
        }
        fill()
        menu.hidden = false
        menu.style.position = 'fixed'
        menu.style.left = `${Math.round(x)}px`
        menu.style.top = `${Math.round(y)}px`
        open = true
        view.dom.ownerDocument.addEventListener('pointerdown', onPointerDown, true)
        focusItem(menu.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])'))
      }

      const onContextMenu = (event: Event): void => {
        if (!(event instanceof MouseEvent)) return

        // Every item in this menu acts on `state.selection`, and a secondary
        // click does not always move it -- right-clicking a second table while a
        // cell selection is live in the first leaves the old one in place. Read
        // the position under the pointer and work from that, or Delete table
        // deletes the table the author did not click.
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!at) return
        const $pos = view.state.doc.resolve(at.pos)
        if (!findTable($pos)) return

        // Only retargeted when the click lands outside the current selection: a
        // right-click inside a multi-cell selection has to keep it, or "Delete
        // row" would silently narrow to the one row under the pointer.
        const { from, to } = view.state.selection
        if (at.pos < from || at.pos > to) {
          view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
        }
        if (!inTable(view.state)) return

        event.preventDefault()
        event.stopPropagation()
        showAt(event.clientX, event.clientY)
      }

      /*
       * Escape, and the arrow keys, bound on the MENU.
       *
       * They were bound on `view.dom`, which never saw them: `showAt` appends
       * the menu to the editor host and moves focus into it, and because the
       * element builds its chrome in the light DOM, `view.dom` is not an
       * ancestor of the menu. Shift+F10 is a documented way in, so that left a
       * widget with an entrance and no exit.
       */
      const items = (): HTMLButtonElement[] =>
        menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : []

      const focusItem = (next: HTMLButtonElement | null | undefined): void => {
        if (!next) return
        for (const item of items()) item.tabIndex = item === next ? 0 : -1
        next.focus()
      }

      const onKeyDown = (event: KeyboardEvent): void => {
        if (!open) return
        // Tab out of a popup menu closes it rather than walking through it.
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          close(true)
          return
        }
        const all = items()
        const index = all.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const delta = event.key === 'ArrowDown' ? 1 : -1
          focusItem(all[(index + delta + all.length) % all.length])
          return
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          focusItem(event.key === 'Home' ? all[0] : all[all.length - 1])
        }
      }

      view.dom.addEventListener('contextmenu', onContextMenu)
      view.dom.ownerDocument.addEventListener('keydown', onKeyDown, true)

      return {
        destroy() {
          view.dom.removeEventListener('contextmenu', onContextMenu)
          view.dom.ownerDocument.removeEventListener('keydown', onKeyDown, true)
          close()
          menu?.remove()
        },
      }
    },
  })
}
