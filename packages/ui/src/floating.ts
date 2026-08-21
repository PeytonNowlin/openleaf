/**
 * Floating toolbars: one for a non-empty selection, one for an empty block
 * that is waiting to be filled.
 *
 * They reuse the same `Toolbar` class as the main bar so the keyboard model,
 * live region and item registry stay in one place. Positioning is the only
 * extra job, and it is deliberately pointer-driven: a keyboard user already
 * has Alt+F10 for the main toolbar, and a second bar that jumps around under
 * arrow keys is a focus trap waiting to happen.
 */

import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { Toolbar } from './toolbar.js'

export const DEFAULT_SELECTION_LAYOUT = 'bold italic underline | link'
export const DEFAULT_INSERT_LAYOUT = 'link image horizontalRule'

export class FloatingToolbars {
  #host: HTMLElement
  #doc: Document
  #view: EditorView | null = null
  #resize: ResizeObserver | null = null
  #selection: Toolbar | null
  #insert: Toolbar | null

  constructor(
    host: HTMLElement,
    doc: Document,
    options: {
      selectionLayout?: string | null
      insertLayout?: string | null
      /** This editor's `lang`. Omitted, both bars silently fell back to English. */
      locale?: string | null
    },
  ) {
    this.#host = host
    this.#doc = doc
    const locale = options.locale ?? null
    this.#selection = options.selectionLayout
      ? new Toolbar(host, doc, {
          layout: options.selectionLayout,
          label: 'Selection formatting',
          locale,
        })
      : null
    this.#insert = options.insertLayout
      ? new Toolbar(host, doc, { layout: options.insertLayout, label: 'Insert', locale })
      : null
    if (this.#selection) {
      this.#selection.el.classList.add('ol-floating')
      this.#selection.el.hidden = true
      host.appendChild(this.#selection.el)
    }
    if (this.#insert) {
      this.#insert.el.classList.add('ol-floating')
      this.#insert.el.hidden = true
      host.appendChild(this.#insert.el)
    }
  }

  mount(view: EditorView): void {
    this.#view = view
    this.#selection?.mount(view)
    this.#insert?.mount(view)
    // Position from the state we are mounted with, not from the first
    // transaction after it. An editor that opens on an empty paragraph -- a new
    // post, the commonest way to meet one -- has the caret in exactly the place
    // the insert bar exists for, and waiting for a transaction meant it did not
    // appear until the author did something else first.
    //
    // This was invisible while `hidden` did nothing: both bars were painted
    // whatever the state said, so the missing initial position looked like a
    // working feature. Fixing the CSS is what made it observable.
    this.#position(view.state)

    // Reposition when the editor's box actually changes, rather than chasing
    // each thing that can change it. An editor revealed from a hidden tab, a
    // web font swapping in after its stylesheet was adopted, a container
    // resize -- none of them dispatch an editor transaction, and all of them
    // move the caret out from under a bar placed in viewport coordinates.
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => {
        const current = this.#view
        if (current && !current.isDestroyed) this.#position(current.state)
      })
      this.#resize.observe(view.dom)
    }
  }

  /** Follow the host's `lang` when it changes, as the main bar already does. */
  setLocale(next: string | null): void {
    this.#selection?.setLocale(next)
    this.#insert?.setLocale(next)
  }

  update(state: EditorState): void {
    this.#selection?.update(state)
    this.#insert?.update(state)
    this.#position(state)
  }

  destroy(): void {
    this.#resize?.disconnect()
    this.#resize = null
    this.#selection?.destroy()
    this.#insert?.destroy()
    this.#selection?.el.remove()
    this.#insert?.el.remove()
  }

  #position(state: EditorState): void {
    const view = this.#view
    if (!view) return
    // No layout, no placement. An editor built under a `display: none` ancestor
    // -- a hidden tab, a collapsed dialog -- measures every caret at 0,0, and a
    // bar shown there sits in the corner of the page rather than by the text.
    // It stays hidden until the box exists; the observer above brings it back.
    const box = view.dom.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) {
      if (this.#selection) this.#selection.el.hidden = true
      if (this.#insert) this.#insert.el.hidden = true
      return
    }
    const empty = state.selection.empty
    if (this.#selection) {
      this.#selection.el.hidden = empty
      if (!empty) this.#place(this.#selection.el, view, state.selection.from)
    }
    if (this.#insert) {
      const $from = state.selection.$from
      const showInsert = empty && $from.parent.isTextblock && $from.parent.content.size === 0
      this.#insert.el.hidden = !showInsert
      if (showInsert) this.#place(this.#insert.el, view, state.selection.from)
    }
  }

  #place(el: HTMLElement, view: EditorView, pos: number): void {
    const coords = view.coordsAtPos(pos)
    const hostBox = this.#host.getBoundingClientRect()
    el.style.left = `${coords.left - hostBox.left}px`
    el.style.top = `${coords.bottom - hostBox.top + 8}px`
    void this.#doc
  }
}
