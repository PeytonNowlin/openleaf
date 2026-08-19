/**
 * Two icons, and deliberately no letterforms.
 *
 * Every other editor draws text colour as a letter "A" over a coloured bar. That
 * bakes English into the interface: bold is *gras* in French and *fett* in
 * German, and an "A" is no better -- it is a Latin-script assumption in a control
 * that has to work in Arabic, Greek and Japanese. A pen nib and a marker are what
 * the tools actually are, in any script.
 *
 * The current colour is not in the path data. It is drawn as a separate bar under
 * the icon, so it can change without redrawing an SVG.
 */
export const COLOUR_ICONS: Record<string, string> = {
  // A pen nib: the body, the shoulders, and the slit.
  textColour: 'M12 3l4 9H8zM10 12h4M12 12v4',
  // A marker held at an angle, with its chisel tip against the page.
  highlightColour: 'M16 3l5 5-9 9-5-5zM7 12l-2 5 5-2M4 21h16',
}
