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
    view.dom.addEventListener('focusin', this.#sync)
    view.dom.addEventListener('focusout', this.#onFocusOut)
    view.dom.addEventListener('pointerdown', this.#onPointerDown)
    const doc = view.dom.ownerDocument
    doc.addEventListener('pointerup', this.#onPointerUp)
    doc.addEventListener('pointercancel', this.#onPointerUp)
    // Workaround: `OpenLeafEditor.#applyReadonly` updates the main bars and
    // not these. The cleaner fix is `this.#floating?.update(view.state)`
    // there; this file cannot reach it. Watching the attribute covers mount
    // and a later `readonly` without that hook.
    if (typeof MutationObserver !== 'undefined') {
      this.#readonlyObserver = new MutationObserver(this.#sync)
      this.#readonlyObserver.observe(this.#host, { attributes: true, attributeFilter: ['readonly'] })
    }
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
      this.#resize = new ResizeObserver(this.#sync)
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
    const view = this.#view
    if (view?.dom) {
      view.dom.removeEventListener('focusin', this.#sync)
      view.dom.removeEventListener('focusout', this.#onFocusOut)
      view.dom.removeEventListener('pointerdown', this.#onPointerDown)
      const doc = view.dom.ownerDocument
      doc.removeEventListener('pointerup', this.#onPointerUp)
      doc.removeEventListener('pointercancel', this.#onPointerUp)
    }
    this.#pointerSelecting = false
    this.#resize?.disconnect()
    this.#resize = null
    this.#readonlyObserver?.disconnect()
    this.#readonlyObserver = null
    this.#selection?.destroy()
    this.#insert?.destroy()
    this.#selection?.el.remove()
    this.#insert?.el.remove()
  }

  #sync = (): void => {
    const view = this.#view
    if (view && !view.isDestroyed) this.#position(view.state)
  }

  #position(state: EditorState): void {
    const view = this.#view
    if (!view) return
    // No layout, no placement. An editor built under a `display: none` ancestor
    // -- a hidden tab, a collapsed dialog -- measures every caret at 0,0, and a
    // bar shown there sits in the corner of the page rather than by the text.
    // It stays hidden until the box exists; the observer above brings it back.
    //
    // Shown only while the author is actually using this editor on unlocked
    // content. Inline mode already clips every `.ol-toolbar` until the host is
    // focused; framed mode had no equivalent, which is how a leftover range
    // painted a second toolbar over an inactive page. `view.editable` is the
    // live reading of `readonly` (and of anything else that flipped
    // `editable()`), so a consumer that never sets the attribute still hides.
    const box = view.dom.getBoundingClientRect()
    const sel = state.selection
    const empty = sel.empty
    const allowed =
      (box.width !== 0 || box.height !== 0) &&
      !this.#host.hasAttribute('readonly') &&
      view.editable !== false &&
      (view.hasFocus() || this.#pointerSelecting) &&
      !selectionInLockedContent(state)
    if (this.#selection) {
      const show = allowed && !empty
      this.#selection.el.hidden = !show
      if (show) this.#place(this.#selection.el, view, sel.from)
    }
    if (this.#insert) {
      const parent = sel.$from.parent
      const show = allowed && empty && parent.isTextblock && parent.content.size === 0
      this.#insert.el.hidden = !show
      if (show) this.#place(this.#insert.el, view, sel.from)
    }
  }

  #onFocusOut = (event: FocusEvent): void => {
    if (this.#pointerSelecting) return
    const next = event.relatedTarget
    // Focus moving to chrome we own -- a main-toolbar button, a floating
    // button whose `mousedown` `preventDefault` failed -- is not a blur of
    // the editor as far as the author is concerned.
    if (next instanceof Node && this.#host.contains(next)) return
    // Some engines deliver `focusout` with a null `relatedTarget` before the
    // next target is focused, or before the view has taken focus during the
    // pointer sequence. Recheck after the event; `hasFocus()` is then honest.
    queueMicrotask(this.#sync)
  }

  #onPointerDown = (event: Event): void => {
    if ('button' in event && (event as MouseEvent).button !== 0) return
    this.#pointerSelecting = true
    this.#sync()
  }

  #onPointerUp = (): void => {
    if (!this.#pointerSelecting) return
    this.#pointerSelecting = false
    this.#sync()
  }

  #place(el: HTMLElement, view: EditorView, pos: number): void {
    const coords = view.coordsAtPos(pos)
    const hostBox = this.#host.getBoundingClientRect()
    el.style.left = `${coords.left - hostBox.left}px`
    el.style.top = `${coords.bottom - hostBox.top + 8}px`
  }
}

/**
 * True when the selection covers no unlocked content.
 *
 * Hide the bar over a caret or a range that lives entirely inside a locked
 * node (or *is* a preserved atom): Bold would no-op, and offering it on text
 * the author cannot change is the original bug. Do not hide it merely because
 * the range *contains* a locked node. Select All, and a drag that starts
 * before a `contenteditable="false"` block and ends after it, still have
 * unlocked text the author can format -- `filterTransaction` already refuses
 * the locked interior. Walking only `[from, to]` (and stopping at the first
 * unlocked text) keeps this off the empty-caret keystroke path.
 *
 * `isNonEditableNode` is the same predicate the transaction filter uses.
 * Preserved atoms (`unknown_block` / `unknown_inline`) are uneditable as a
 * whole. Other atoms (an image, a rule) are not locked in that sense.
 */
function selectionInLockedContent(state: EditorState): boolean {
  const sel = state.selection
  if (sel.empty) return lockedAncestor(sel.$from)
  if (sel instanceof NodeSelection) return isLockedNode(sel.node)
  let unlocked = false
  state.doc.nodesBetween(sel.from, sel.to, (node) => {
    if (unlocked) return false
    if (isLockedNode(node)) return false
    if (node.isText && (node.text?.length ?? 0) > 0) {
      unlocked = true
      return false
    }
    return true
  })
  return !unlocked
}

function lockedAncestor($pos: EditorState['selection']['$from']): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (isLockedNode($pos.node(depth))) return true
  }
  return false
}

function isLockedNode(node: PMNode): boolean {
  const name = node.type.name
  return isNonEditableNode(node) || name === 'unknown_block' || name === 'unknown_inline'
}
