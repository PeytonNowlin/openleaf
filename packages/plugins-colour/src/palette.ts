/**
 * The default palette.
 *
 * Every swatch is named, and the names are not decoration: a grid of buttons
 * whose only distinguishing feature is a background colour is unusable with a
 * screen reader, unusable in a high-contrast forced-colours mode, and unusable
 * by the eight percent of men with a colour vision deficiency. The name is the
 * accessible name of the button and the tooltip of the swatch, so the control
 * works without seeing the colour at all.
 *
 * Eight columns by four rows, and the rows are ordered greys, strong, deep,
 * light. That is not arbitrary either: authors reach for a grey or a strong hue
 * for text and for a pale hue for a highlight, so the two ends of the grid are
 * the two common cases and neither is buried in the middle.
 *
 * Replaceable. `installColourPicker({ palette })` takes any list, because a brand
 * has its own colours and an author asked to match a style guide from a generic
 * grid will paste hex codes instead.
 */

export interface Swatch {
  /** The CSS colour written into the document. */
  value: string
  /** The accessible name. Shown as the tooltip and read by a screen reader. */
  name: string
}

/** Columns per row. The keyboard grid navigation reads this, not a CSS value. */
export const PALETTE_COLUMNS = 8

export const DEFAULT_PALETTE: readonly Swatch[] = [
  // Greys, black through white.
  { value: '#000000', name: 'Black' },
  { value: '#18181b', name: 'Charcoal' },
  { value: '#3f3f46', name: 'Dark grey' },
  { value: '#71717a', name: 'Grey' },
  { value: '#a1a1aa', name: 'Light grey' },
  { value: '#d4d4d8', name: 'Pale grey' },
  { value: '#f4f4f5', name: 'Off white' },
  { value: '#ffffff', name: 'White' },

  // Strong hues, for text.
  { value: '#dc2626', name: 'Red' },
  { value: '#ea580c', name: 'Orange' },
  { value: '#d97706', name: 'Amber' },
  { value: '#16a34a', name: 'Green' },
  { value: '#0d9488', name: 'Teal' },
  { value: '#2563eb', name: 'Blue' },
  { value: '#4f46e5', name: 'Indigo' },
  { value: '#9333ea', name: 'Purple' },

  // Deep hues, which stay legible on a white page.
  { value: '#991b1b', name: 'Dark red' },
  { value: '#92400e', name: 'Brown' },
  { value: '#4d7c0f', name: 'Olive' },
  { value: '#166534', name: 'Dark green' },
  { value: '#115e59', name: 'Dark teal' },
  { value: '#1e3a8a', name: 'Navy' },
  { value: '#3730a3', name: 'Dark indigo' },
  { value: '#6b21a8', name: 'Plum' },

  // Light hues, which are what a highlight actually wants.
  { value: '#f472b6', name: 'Pink' },
  { value: '#fda4af', name: 'Rose' },
  { value: '#fdba74', name: 'Peach' },
  { value: '#fde047', name: 'Yellow' },
  { value: '#bef264', name: 'Lime' },
  { value: '#86efac', name: 'Mint' },
  { value: '#7dd3fc', name: 'Sky' },
  { value: '#c4b5fd', name: 'Lavender' },
]

/** The name of a colour in a palette, for an announcement. */
export function nameFor(palette: readonly Swatch[], value: string | null): string | null {
  if (value === null) return null
  const found = palette.find((swatch) => swatch.value.toLowerCase() === value.toLowerCase())
  return found ? found.name : value
}
