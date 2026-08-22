/**
 * The colour picker: a trigger button in the toolbar and a swatch grid beside it.
 *
 * ## Why this is not a `<select>`, and not a `<dialog>` either
 *
 * The toolbar's block-type control is a native `<select>`, chosen because a
 * custom listbox is several hundred lines of ARIA that would then owe real
 * screen reader testing to be worth anything. That reasoning does not transfer
 * here: colours as a list of text options is a worse control, not a cheaper one
 * -- an author picking "Dark indigo" from a dropdown cannot see the difference
 * between it and "Navy", which is the entire information the control exists to
 * convey.
 *
 * A modal `<dialog>`, which is what the link and image prompts use, is wrong for
 * a different reason: it hides the text whose colour is being chosen, and it
 * makes trying three colours three round trips through a modal.
 *
 * So this is the one hand-rolled widget in the project, and it pays for itself
 * by being small and by leaning on the platform everywhere it can:
 *
 *   Top layer      -- `popover="manual"` where supported, so the grid escapes a
 *                     host's `overflow: hidden` and a 2009 WordPress admin bar at
 *                     `z-index: 99999`. Where it is not supported, a fixed
 *                     position and the editor's own z-index token.
 *   Arbitrary      -- a native `<input type="color">`, so the platform's own
 *   colours           colour picker handles the hard part, including its
 *                     accessibility.
 *   Naming         -- every swatch is a real `<button>` with the colour's name as
 *                     its accessible name, so the grid is usable by a screen
 *                     reader and in a forced-colours mode where the swatch itself
 *                     conveys nothing.
 *
 * ## The keyboard model
 *
 * The trigger is one stop in the toolbar's roving tabindex, like any button.
 * Opening moves focus into the grid, where the arrow keys move by one and by a
 * row, Home and End go to the ends of a row, and Escape closes and returns focus
 * to the trigger. Tab moves on to the custom-colour input and the remove button,
 * and leaving the popover closes it -- so a keyboard user can never be stranded
 * in a widget with no exit, which is the failure mode of every hand-rolled
 * popover.
 */

import {
  announce,
  fill,
  iconElement,
  t,
  withLocale,
  type ToolbarContext,
  type ToolbarControl,
} from '@openleaf-editor/ui'
import type { Command, EditorState } from 'prosemirror-state'
import { PALETTE_COLUMNS, nameFor, type Swatch } from './palette.js'

export interface PickerOptions {
  /** Accessible name for the trigger and the popover. */
  label: string
  /** Icon name, registered by the caller. */
  icon: string
  palette: readonly Swatch[]
  /** Reads the colour in force, so the grid can show which swatch is current. */
  active: (state: EditorState) => string | null
  /** Builds the command that applies a colour. */
  apply: (color: string) => Command
  /** Removes the colour. */
  clear: Command
}

/** Does this engine put popovers in the top layer for us? */
const SUPPORTS_POPOVER =
  typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

export function buildColorPicker(ctx: ToolbarContext, options: PickerOptions): ToolbarControl {
  const { view, host } = ctx
  const doc = host.ownerDocument

  /** A UI string in this editor's own language, with `{name}` placeholders filled. */
  const say = (source: string, values: Record<string, string> = {}): string =>
    withLocale(host.getAttribute('lang'), () =>
      fill(t(source), values),
    )

  const wrap = doc.createElement('div')
  wrap.className = 'ol-color'

  /* ---- trigger ---- */

  const trigger = doc.createElement('button')
  trigger.type = 'button'
  // `ol-btn` is load-bearing: it is what the toolbar's roving tabindex looks for.
  trigger.className = 'ol-btn ol-color-trigger'
  // The registered id, not the label: the toolbar reads this back to restore
  // focus after a re-render, and it looks the id up.
  trigger.dataset['olId'] = ctx.id ?? options.label
  trigger.setAttribute('aria-label', options.label)
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.title = options.label
  trigger.appendChild(iconElement(options.icon, doc))

  /*
   * The current colour, as a bar under the icon.
   *
   * Set through the CSSOM rather than as a `style` attribute string. A strict CSP
   * without `unsafe-inline` blocks a style ATTRIBUTE it parses, but not a CSSOM
   * write -- the same distinction that made the icon sprite use DOM APIs instead
   * of innerHTML.
   */
  const bar = doc.createElement('span')
  bar.className = 'ol-color-bar'
  bar.setAttribute('aria-hidden', 'true')
  trigger.appendChild(bar)
  wrap.appendChild(trigger)

  /* ---- popover ---- */

  const popover = doc.createElement('div')
  popover.className = 'ol-color-pop'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', options.label)
  if (SUPPORTS_POPOVER) {
    // "manual" rather than "auto": auto brings light dismiss, which would fight
    // the focusout and Escape handling below and give two code paths for closing
    // depending on the engine. One path is easier to reason about and to test.
    popover.setAttribute('popover', 'manual')
  } else {
    popover.hidden = true
  }

  /*
   * The colour in force, in words.
   *
   * The bar under the trigger icon is a preview, and a preview of a colour is
   * exactly the information a screen reader user does not receive. Named here
   * instead -- which is what `nameFor` was written for, and what it had never
   * been called from.
   */
  const status = doc.createElement('div')
  status.className = 'ol-color-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  popover.appendChild(status)

  // A real grid, not a pile of thirty-two buttons. Without row structure a
  // reader can say the name of the swatch under the cursor and nothing about
  // where in the palette it sits, which is the one thing arrow keys are moving
  // through. Follows plugins-table/src/grid.ts, the in-repo reference.
  const grid = doc.createElement('div')
  grid.className = 'ol-color-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', say('Palette'))
  popover.appendChild(grid)

  /**
   * Keep the document selection while a control in the popover is clicked.
   *
   * The toolbar does this for every button and says why: without it the editor
   * blurs on mousedown, the selection collapses, and the command applies to
   * nothing. It is not optional here either, and it is engine-dependent -- the
   * colour still applied in Chromium with this missing, while WebKit collapsed
   * the selection and turned "Remove colour" into a no-op that closed the popover
   * as though it had worked.
   */
  const keepSelection = (el: HTMLElement): void => {
    el.addEventListener('mousedown', (event) => event.preventDefault())
  }

  const swatches: HTMLButtonElement[] = []
  let row: HTMLDivElement | null = null
  options.palette.forEach((swatch, index) => {
    if (index % PALETTE_COLUMNS === 0) {
      row = doc.createElement('div')
      row.className = 'ol-color-row'
      row.setAttribute('role', 'row')
      grid.appendChild(row)
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'ol-swatch'
    keepSelection(button)
    button.setAttribute('role', 'gridcell')
    button.setAttribute('aria-label', swatch.name)
    // `aria-selected`, not `aria-pressed`: a gridcell has no pressed state, and
    // "which colour is in force" is a selection within the grid, which is
    // exactly what aria-selected means.
    button.setAttribute('aria-selected', 'false')
    button.title = swatch.name
    button.dataset['olColour'] = swatch.value
    button.style.backgroundColor = swatch.value
    // One tab stop for the whole grid; the arrow keys move within it.
    button.tabIndex = index === 0 ? 0 : -1
    button.addEventListener('click', () => choose(swatch.value))
    swatches.push(button)
    row?.appendChild(button)
  })

  const actions = doc.createElement('div')
  actions.className = 'ol-color-actions'

  const customLabel = doc.createElement('label')
  customLabel.className = 'ol-color-custom'
  const customText = doc.createElement('span')
  customText.textContent = say('Custom')
  const custom = doc.createElement('input')
  custom.type = 'color'
  customLabel.append(customText, custom)
  // `change`, not `input`: `input` fires continuously while the native picker is
  // being dragged, which would apply and undo a hundred colours and bury the
  // author's last real edit in the undo history.
  custom.addEventListener('change', () => choose(custom.value))

  const clear = doc.createElement('button')
  clear.type = 'button'
  clear.className = 'ol-color-clear'
  clear.textContent = say('Remove colour')
  keepSelection(clear)
  clear.addEventListener('click', () => {
    options.clear(view.state, view.dispatch, view)
    // Focus goes back to the text, so nothing the author lands on reports what
    // just happened. Without this the change is completely silent.
    announce(host, say('Colour removed'))
    close({ returnFocus: 'content' })
  })

  actions.append(customLabel, clear)
  popover.appendChild(actions)

  /* ---- open and close ---- */

  let open = false

  const position = (): void => {
    const rect = trigger.getBoundingClientRect()
    // Fixed coordinates in both modes. A popover in the top layer is positioned
    // against the viewport, and the fallback deliberately matches it so the two
    // paths cannot drift visually.
    popover.style.position = 'fixed'
    popover.style.top = `${Math.round(rect.bottom + 4)}px`
    // Clamped so a trigger near the right edge does not push the grid off-screen.
    // Must track `.ol-color-pop { width }` in styles.ts.
    const width = 246
    const left = Math.min(Math.round(rect.left), doc.documentElement.clientWidth - width - 8)
    popover.style.left = `${Math.max(8, left)}px`
  }

  const show = (): void => {
    if (open) return
    if (host.hasAttribute('readonly')) return
    if (trigger.getAttribute('aria-disabled') === 'true') return

    if (!popover.isConnected) {
      // On the host, not in the toolbar. Inside the toolbar element the grid's
      // buttons would be found by the roving tabindex, which walks every
      // `button.ol-btn` there -- and a hidden popover full of tab stops is how a
      // toolbar quietly becomes thirty-three tab stops.
      host.appendChild(popover)
    }
    position()
    if (SUPPORTS_POPOVER) (popover as HTMLElement & { showPopover(): void }).showPopover()
    else popover.hidden = false

    open = true
    trigger.setAttribute('aria-expanded', 'true')
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.defaultView?.addEventListener('resize', onViewportChange)
    doc.defaultView?.addEventListener('scroll', onViewportChange, true)

    const current = swatches.find((s) => s.getAttribute('aria-selected') === 'true')
    focus(current ?? swatches[0])
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

  const choose = (color: string): void => {
    options.apply(color)(view.state, view.dispatch, view)
    // "A colour they can see applied to their selection is the confirmation
    // they needed" -- true, and it is confirmation only for an author who can
    // see it. The name is the same confirmation for one who cannot.
    announce(host, say('{colour} applied', { colour: nameFor(options.palette, color) ?? color }))
    // Back to the text, not to the trigger: the author's next act is almost
    // always typing.
    close({ returnFocus: 'content' })
  }

  const focus = (button: HTMLButtonElement | undefined): void => {
    if (!button) return
    for (const swatch of swatches) swatch.tabIndex = swatch === button ? 0 : -1
    button.focus()
  }

  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    if (popover.contains(target) || trigger.contains(target)) return
    close()
  }

  // A popover positioned against the viewport is wrong the moment the page moves
  // under it. Closing rather than repositioning: the author's intent when they
  // scroll is not "keep this open somewhere else".
  const onViewportChange = (): void => close()

  trigger.addEventListener('mousedown', (event) => event.preventDefault())
  trigger.addEventListener('click', () => {
    if (open) close({ returnFocus: 'content' })
    else show()
  })

  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // To the trigger, not the content: Escape means "I did not choose
      // anything", and dumping focus back into the text loses the author's place
      // in the toolbar.
      close({ returnFocus: 'trigger' })
      return
    }

    const index = swatches.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return

    const move = (next: number): void => {
      event.preventDefault()
      focus(swatches[Math.max(0, Math.min(next, swatches.length - 1))])
    }
    const row = Math.floor(index / PALETTE_COLUMNS)

    switch (event.key) {
      case 'ArrowRight':
        move(index + 1)
        break
      case 'ArrowLeft':
        move(index - 1)
        break
      case 'ArrowDown':
        move(index + PALETTE_COLUMNS)
        break
      case 'ArrowUp':
        move(index - PALETTE_COLUMNS)
        break
      case 'Home':
        move(row * PALETTE_COLUMNS)
        break
      case 'End':
        move(row * PALETTE_COLUMNS + PALETTE_COLUMNS - 1)
        break
      default:
        break
    }
  })

  // Leaving by any route closes. `focusout` covers Tab past the last control,
  // Shift-Tab before the first, and a click that moves focus elsewhere -- the
  // three ways a hand-rolled popover normally gets stranded open.
  popover.addEventListener('focusout', () => {
    // Deferred one task: during focusout, `activeElement` is still the element
    // being left, so the check has to run after the move has happened.
    setTimeout(() => {
      if (!open) return
      const active = doc.activeElement
      if (active && (popover.contains(active) || trigger.contains(active))) return
      close()
    }, 0)
  })

  /**
   * The colour the grid is currently showing.
   *
   * `update` runs on every transaction -- every keystroke -- and the work below
   * is one style write plus an `aria-pressed` attribute per swatch, which is 64
   * attribute writes on the default palette, plus a CSSOM round trip to
   * normalise the value for the colour input. Almost every one of those
   * transactions leaves the colour in force exactly where it was, so the whole
   * body is skippable by remembering what was last painted.
   *
   * `undefined` rather than `null` for "nothing painted yet", because `null` is a
   * real value here: it is what "no colour in force" reads as, and the first
   * update has to paint it.
   */
  let painted: string | null | undefined

  return {
    el: wrap,
    update(state) {
      const current = options.active(state)
      if (current === painted) return
      painted = current
      // No colour in force shows the theme's own text colour, which is honest:
      // the bar is a preview of what the author would get, and what they would
      // get is inherited.
      bar.style.backgroundColor = current ?? 'currentColor'
      // The same fact in words, for the reader that cannot use the bar.
      status.textContent =
        current === null ? say('No colour') : (nameFor(options.palette, current) ?? current)
      for (const swatch of swatches) {
        const value = swatch.dataset['olColour']
        const selected = current !== null && value?.toLowerCase() === current.toLowerCase()
        swatch.setAttribute('aria-selected', selected ? 'true' : 'false')
      }
      if (current !== null) custom.value = normalizeForInput(current)
    },
    destroy() {
      close()
      popover.remove()
    },
  }
}

/**
 * `<input type="color">` accepts only `#rrggbb`, and silently keeps its previous
 * value for anything else. A named colour or an `rgb()` from existing content
 * would leave the input showing black, so it is resolved through the CSSOM --
 * which is the one piece of code on the page that already knows every colour
 * name there is.
 *
 * The element doing the resolving is a module singleton, built on first use. It
 * is never attached to anything and holds one property, and building a fresh one
 * per call put a DOM allocation on a path that runs whenever the colour in force
 * changes. Lazily, so importing this module on a server touches no DOM.
 */
let colorProbe: HTMLElement | undefined

function normalizeForInput(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  if (typeof document === 'undefined') return '#000000'
  const probe = (colorProbe ??= document.createElement('span'))
  // Cleared first: the CSSOM ignores a value it cannot parse, and a stale one
  // left over from the previous call would be returned as though it were this
  // colour's answer.
  probe.style.color = ''
  probe.style.color = color
  const computed = probe.style.color
  const rgb = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(computed)
  if (!rgb) return '#000000'
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((n) => Number.parseInt(n as string, 10).toString(16).padStart(2, '0'))
    .join('')}`
}
