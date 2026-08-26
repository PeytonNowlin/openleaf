/**
 * Floating toolbars: one for a non-empty selection, one for an empty block
 * that is waiting to be filled.
 *
 * They reuse the same `Toolbar` class as the main bar so the keyboard model,
 * live region and item registry stay in one place. Positioning is the only
 * extra job, and it is deliberately pointer-driven: a keyboard user already
 * has Alt+F10 for the main toolbar, and a second bar that jumps around under
 * arrow keys is a focus trap waiting to happen.
 *
 * Visibility is not selection-shape alone. The bars follow the same rule the
 * main toolbar already uses in inline mode -- shown while the editor is the
 * thing the author is using -- plus two extra gates the main bar does not
 * need because its buttons disable in place: the editor is editable, and the
 * selection is not inside a locked node. Without those, a click on the host
 * page left the selection bar painted, a readonly empty editor showed the
 * insert bar on mount, and a range inside `contenteditable="false"` still
 * offered Bold.
 */

import { isNonEditableNode } from '@openleaf-editor/core'
import { NodeSelection, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { Toolbar } from './toolbar.js'

type PMNode = Parameters<typeof isNonEditableNode>[0]

export const DEFAULT_SELECTION_LAYOUT = 'bold italic underline | link'
export const DEFAULT_INSERT_LAYOUT = 'link image horizontalRule'

export class FloatingToolbars {
  #host: HTMLElement
  #doc: Document
  #view: EditorView | null = null
  #resize: ResizeObserver | null = null
  #readonlyObserver: MutationObserver | null = null
  #selection: Toolbar | null
  #insert: Toolbar | null
  /**
   * True between a pointerdown inside the canvas and the matching pointerup.
   *
   * `view.hasFocus()` is false during the pointer sequence that is
   * *establishing* the selection in some engines -- the range updates, the
   * transaction runs, `#position` runs, and focus has not moved into the view
   * yet. A naive `hasFocus()` guard then hides the selection bar on a normal
   * drag-select. Pointer-driven placement is intentional; this flag is what
   * keeps it from becoming a focus trap under a hide-unless-focused rule.
   */
  #pointerSelecting = false

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
    this.#bindView(view)
    // Position from the state we are mounted with, not from the first
    // transaction after it. An editor that opens on an empty paragraph -- a new
    // post, the commonest way to meet one -- has the caret in exactly the place
    // the insert bar exists for, and waiting for a transaction meant it did not
    // appear until the author did something else first.
    //
    // This was invisible while `hidden` did nothing: both bars were painted
    // whatever the state said, so the missing initial position looked like a
    // working feature. Fixing the CSS is what made it observable. The focus /
    // readonly / lock gates below apply here too: an unfocused or readonly
    // editor that opens on an empty block still must not show the insert bar.
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
    this.#unbindView()
    this.#resize?.disconnect()
    this.#resize = null
    this.#readonlyObserver?.disconnect()
    this.#readonlyObserver = null
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
      this.#hideAll()
      return
    }
    const allowed = this.#chromeAllowed(view, state)
    const empty = state.selection.empty
    if (this.#selection) {
      const show = allowed && !empty
      this.#selection.el.hidden = !show
      if (show) this.#place(this.#selection.el, view, state.selection.from)
    }
    if (this.#insert) {
      const $from = state.selection.$from
      const emptyBlock = empty && $from.parent.isTextblock && $from.parent.content.size === 0
      const show = allowed && emptyBlock
      this.#insert.el.hidden = !show
      if (show) this.#place(this.#insert.el, view, state.selection.from)
    }
  }

  /**
   * Shown only while the author is actually using this editor on unlocked
   * content. Inline mode already clips every `.ol-toolbar` until the host is
   * focused; framed mode had no equivalent, which is how a leftover range
   * painted a second toolbar over an inactive page.
   */
  #chromeAllowed(view: EditorView, state: EditorState): boolean {
    if (!this.#editable(view)) return false
    if (!this.#hasEditorFocus(view)) return false
    if (selectionInLockedContent(state)) return false
    return true
  }

  #editable(view: EditorView): boolean {
    if (this.#host.hasAttribute('readonly')) return false
    // `editable` is the view's live reading of the same attribute (and of
    // anything else that flipped `editable()`). Checking both means a direct
    // `FloatingToolbars` consumer that never sets `readonly` on the host still
    // hides when the view is not editable, and a `readonly` set after mount
    // is seen even before the next `setProps`.
    if (view.editable === false) return false
    return true
  }

  #hasEditorFocus(view: EditorView): boolean {
    if (view.hasFocus()) return true
    return this.#pointerSelecting
  }

  #hideAll(): void {
    if (this.#selection) this.#selection.el.hidden = true
    if (this.#insert) this.#insert.el.hidden = true
  }

  #bindView(view: EditorView): void {
    view.dom.addEventListener('focusin', this.#onFocusIn)
    view.dom.addEventListener('focusout', this.#onFocusOut)
    view.dom.addEventListener('pointerdown', this.#onPointerDown)
    const doc = view.dom.ownerDocument
    doc.addEventListener('pointerup', this.#onPointerUp)
    doc.addEventListener('pointercancel', this.#onPointerUp)
    // `#applyReadonly` on the element updates the main bars and not these.
    // Watching the attribute keeps the gate on the mount path *and* on a
    // `readonly` added later, without a hook in the element.
    if (typeof MutationObserver !== 'undefined') {
      this.#readonlyObserver = new MutationObserver(() => {
        const current = this.#view
        if (current && !current.isDestroyed) this.#position(current.state)
      })
      this.#readonlyObserver.observe(this.#host, { attributes: true, attributeFilter: ['readonly'] })
    }
  }

  #unbindView(): void {
    const view = this.#view
    if (view?.dom) {
      view.dom.removeEventListener('focusin', this.#onFocusIn)
      view.dom.removeEventListener('focusout', this.#onFocusOut)
      view.dom.removeEventListener('pointerdown', this.#onPointerDown)
      const doc = view.dom.ownerDocument
      doc.removeEventListener('pointerup', this.#onPointerUp)
      doc.removeEventListener('pointercancel', this.#onPointerUp)
    }
    this.#pointerSelecting = false
  }

  #onFocusIn = (): void => {
    const view = this.#view
    if (view && !view.isDestroyed) this.#position(view.state)
  }

  #onFocusOut = (event: FocusEvent): void => {
    if (this.#pointerSelecting) return
    const next = event.relatedTarget
    // Focus moving to chrome we own -- a main-toolbar button, a floating
    // button whose `mousedown` `preventDefault` failed -- is not a blur of
    // the editor as far as the author is concerned.
    if (next instanceof Node && this.#host.contains(next)) return
    const view = this.#view
    if (!view || view.isDestroyed) return
    // Some engines deliver `focusout` with a null `relatedTarget` before the
    // next target is focused, or before the view has taken focus during the
    // pointer sequence. Recheck after the event; `hasFocus()` is then honest.
    queueMicrotask(() => {
      const current = this.#view
      if (current && !current.isDestroyed) this.#position(current.state)
    })
  }

  #onPointerDown = (event: Event): void => {
    const button = 'button' in event ? (event as MouseEvent).button : 0
    if (button !== 0) return
    this.#pointerSelecting = true
    const view = this.#view
    if (view && !view.isDestroyed) this.#position(view.state)
  }

  #onPointerUp = (): void => {
    if (!this.#pointerSelecting) return
    this.#pointerSelecting = false
    const view = this.#view
    if (view && !view.isDestroyed) this.#position(view.state)
  }

  #place(el: HTMLElement, view: EditorView, pos: number): void {
    const coords = view.coordsAtPos(pos)
    const hostBox = this.#host.getBoundingClientRect()
    el.style.left = `${coords.left - hostBox.left}px`
    el.style.top = `${coords.bottom - hostBox.top + 8}px`
    void this.#doc
  }
}

/**
 * True when the selection is *inside* a locked region, or *is* a preserved
 * atom.
 *
 * `isNonEditableNode` is the same predicate the transaction filter uses, so
 * a bar that offers Bold cannot appear over a range the filter would refuse.
 * Preserved atoms (`unknown_block` / `unknown_inline`) are already uneditable
 * as a whole -- their interior is opaque markup -- and a NodeSelection on one
 * is not "unlocked content" either. Other atoms (an image, a rule) are not
 * locked in that sense and keep the selection bar.
 */
function selectionInLockedContent(state: EditorState): boolean {
  const sel = state.selection
  if (sel instanceof NodeSelection) return isLockedNode(sel.node)
  return isInsideLocked(sel.$from) || isInsideLocked(sel.$to)
}

function isInsideLocked($pos: EditorState['selection']['$from']): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (isLockedNode($pos.node(depth))) return true
  }
  return false
}

function isLockedNode(node: PMNode): boolean {
  if (isNonEditableNode(node)) return true
  const name = node.type.name
  return name === 'unknown_block' || name === 'unknown_inline'
}
