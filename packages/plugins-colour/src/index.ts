/**
 * Opt-in colour controls for OpenLeaf.
 *
 * ## Why the picker is a separate bundle and the marks are not
 *
 * The `text_color` and `background_color` MARKS live in `@openleaf-editor/core`,
 * always present, for the same reason the table schema does: without them a
 * `<span style="color:#c00">` in inherited content is claimed by the
 * preservation layer and becomes an opaque atom -- round-tripped perfectly and
 * uneditable, a grey card where a sentence used to be. "We read your colours but
 * you may not touch them" is not a thing you can tell a CMS.
 *
 * What is genuinely optional is the PICKER: a swatch grid, its keyboard model
 * and its popover, which is the part with real weight. The core bundle has a hard
 * 90 KB budget with about a kilobyte and a half spare, so a control that does not
 * fit either follows tables out into an opt-in file or pushes something else out.
 * This is that file.
 *
 * ```html
 * <script src="/js/openleaf.min.js"></script>
 * <script src="/js/openleaf-colour.min.js"></script>
 * ```
 *
 * Installing does NOT rearrange anybody's toolbar. The two items register
 * themselves as capabilities; putting them in the bar is the integrator's
 * decision, made with the `toolbar` attribute or by using the ready-made
 * `LAYOUT_WITH_COLOUR` from `@openleaf-editor/ui`.
 *
 * ## On the two spellings, which are deliberate
 *
 * `installColourPicker` sets a `text_color` mark by calling `setTextColor`, and
 * that is not an oversight. The rule, which the codebase already followed before
 * this package existed -- `applyColourScheme` beside `--openleaf-color-border` --
 * is that the CSS layer keeps CSS's own spelling and everything else uses the
 * project's English:
 *
 *   color   CSS property names, the `--openleaf-color-*` theme tokens, the
 *           `.ol-color-*` class names that sit beside them, and the `text_color`
 *           and `background_color` mark names, which mirror the properties they
 *           write and are part of the stored format.
 *
 *   colour  everything an author or an integrator reads or types: this package's
 *           name, its exported function, the `textColour` and `highlightColour`
 *           item ids, the control labels, and the prose.
 */

import {
  activeBackgroundColor,
  activeTextColor,
  clearBackgroundColor,
  clearTextColor,
  setBackgroundColor,
  setTextColor,
} from '@openleaf-editor/core'
import { registerIcons, registerStyles, registerToolbarItem } from '@openleaf-editor/ui'
import { COLOUR_ICONS } from './icons.js'
import { DEFAULT_PALETTE, type Swatch } from './palette.js'
import { buildColorPicker } from './picker.js'
import { COLOUR_CSS } from './styles.js'

export interface ColorOptions {
  /** Replace the default palette, for a brand's own colours. */
  palette?: readonly Swatch[]
}

let installed = false

/**
 * Install the colour controls. Idempotent.
 *
 * Idempotent because a bundle loaded twice -- which happens in CMS templates more
 * often than anyone would like -- should not produce two sets of controls.
 */
export function installColourPicker(options: ColorOptions = {}): void {
  if (installed) return
  installed = true

  const palette = options.palette ?? DEFAULT_PALETTE

  registerIcons(COLOUR_ICONS)
  registerStyles(COLOUR_CSS)

  registerToolbarItem({
    id: 'textColour',
    type: 'custom',
    label: 'Text colour',
    icon: 'textColour',
    render: (ctx) =>
      buildColorPicker(ctx, {
        label: 'Text colour',
        icon: 'textColour',
        palette,
        active: activeTextColor,
        apply: setTextColor,
        clear: clearTextColor,
      }),
  })

  registerToolbarItem({
    id: 'highlightColour',
    type: 'custom',
    label: 'Highlight colour',
    icon: 'highlightColour',
    render: (ctx) =>
      buildColorPicker(ctx, {
        label: 'Highlight colour',
        icon: 'highlightColour',
        palette,
        active: activeBackgroundColor,
        apply: setBackgroundColor,
        clear: clearBackgroundColor,
      }),
  })
}

export { DEFAULT_PALETTE, PALETTE_COLUMNS, nameFor, type Swatch } from './palette.js'
export { buildColorPicker, type PickerOptions } from './picker.js'
