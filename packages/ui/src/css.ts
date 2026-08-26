/**
 * The editor stylesheet, as a string, and nothing else.
 *
 * ## Why this is not in `styles.ts`
 *
 * This is 20 KB of the ~24 KB `@openleaf-editor/ui` ships, and it is needed by
 * exactly one function -- `ensureStyles`. While it lived beside `registerStyles`
 * in `styles.ts`, every consumer that reached that module for any reason paid for
 * the whole stylesheet: `skins.ts` imports `registerStyles`, so a bundle that
 * touched a skin -- or, through the barrel, one that touched nothing but `t()` --
 * carried the full sheet.
 *
 * Alone in a module whose only top-level binding is a string literal, it is
 * trivially droppable. A bundler keeps it when something calls `ensureStyles` and
 * discards it when the integrator has linked `openleaf.css` themselves, which is
 * the distinction `markStylesExternal()` has always claimed to offer and could
 * not previously deliver at bundle time.
 *
 * `dist/openleaf.css` is generated from this constant by `scripts/emit-css.mjs`,
 * so the constructable-stylesheet path and the linked-file path cannot drift.
 */

/**
 * The dark palette, as fallbacks for the same public tokens the light one uses.
 *
 * Written once and applied from three selectors below rather than pasted three
 * times, because the failure mode of a pasted palette is one selector quietly
 * missing a line -- and the line it is missing is a colour nobody looks at until
 * it is the wrong one.
 */
/**
 * ## Why the accessibility reasoning lives out here
 *
 * The bundles are minified, which strips these comments but NOT the contents of
 * the template literal below -- a CSS comment is string data and ships to every
 * user. So the long-form arguments sit here and the rules carry a short marker
 * pointing back. Ratios below are computed with the WCAG 2.x sRGB formula
 * against all four built-in palettes: default light, midnight, paper, contrast.
 *
 * ### Two border tokens
 *
 * `--ol-border` is 1.43:1 against the default surface (1.92 midnight, 1.47
 * paper). That is right for a table rule or a group divider and wrong for the
 * only thing delimiting a `<select>`, where WCAG 1.4.11 wants 3:1 for the parts
 * of a control that identify it. Rather than darken every hairline in the
 * editor, the two jobs are split: `--ol-border-strong` takes the control
 * boundaries -- toolbar, menubar, content frame, source view, select, menu --
 * and the decorative one stays quiet. The fallback clears 3:1 on a white
 * surface (4.55:1) and a dark one (4.16:1) alike, so a third-party skin that
 * sets only `--openleaf-color-border` still gets a legible control boundary.
 *
 * ### Menu focus
 *
 * `.ol-menu-item` had `outline: none` and a background swap standing in for the
 * ring. That swap is 1.13:1 on the default palette, 1.24 midnight, 1.13 paper,
 * and 1.23 in the skin named "High contrast"; 1.4.11 requires 3:1. A menu item
 * is reachable only by ArrowDown, so that swap was the author's sole position
 * marker. The ring is back and the swap stays as hover affordance. It is inset
 * two pixels rather than outset so it is drawn inside the item rather than over
 * the menu's padding and its neighbour, and it lands at 4.59:1 against the
 * item's own hovered background (7.82 midnight, 4.88 paper, 9.73 contrast).
 *
 * ### Disabled is not invisible
 *
 * `opacity: 0.4` put a 16px glyph at 2.41:1 (2.34 paper, 2.85 contrast), which
 * is not a dimmed icon but an absent one -- and `undo`, `redo` and `link` are
 * disabled at rest. 0.55 stays plainly quieter than an enabled control while
 * clearing 3:1 as non-text content. A disabled control is exempt from 1.4.3
 * either way; being exempt from a rule is not a reason to be unreadable.
 *
 * ### Cell selection
 *
 * The `.selectedCell` tint alone measured 1.06-1.18:1 depending on the palette,
 * and a selection you cannot see is one you will destroy by typing. The ring
 * carries the information now and the tint is the nicety. The ring goes on the
 * cell rather than on the `::after` overlay because the overlay's own `opacity`
 * would fade it to the same invisibility -- a 40% accent lands near 2:1. Per
 * CSS 2.1 Appendix E an element's outline paints in step 10, after all its
 * descendants, so the tint does not cover it.
 *
 * ### Forced colours
 *
 * The block at the end of the sheet previously stopped at `.ol-btn`. Everything
 * added to it depends on a palette this mode discards outright, so each of them
 * had no indicator at all: which menu is open, which menu item has focus, which
 * cells are selected, and every one of the visual aids -- whose entire output
 * is a colour.
 *
 * ### Sticky toolbar
 *
 * The main bar sticks to the nearest scrolling ancestor. Page scroll is the
 * one that used to take it off-screen: autoresize grows the canvas
 * (`overflow: hidden` on `.ProseMirror`, a descendant, so it is not a
 * sticky-killing scrollport above the bar) and the page moves. The host
 * itself has no overflow. Fullscreen is a column flex whose `.ol-content` /
 * `.ol-source` scroll -- the bar is not in that scroller, so sticky is a
 * no-op there and the bar already stays put. Do not "fix" fullscreen.
 *
 * Floating bars re-specify `position: absolute` at (0,3,0), so they are not
 * stuck. A second toolbar (`toolbar2`) is reset to `relative`: two sticky
 * bars at the same `top` would paint on top of each other. The menubar is
 * not sticky for the same reason -- stacking it with the toolbar needs a
 * height this sheet cannot know. `--openleaf-toolbar-sticky-offset` is the
 * host-header pad; 0px so a host that never heard of the token still gets a
 * bar that stays on screen.
 */

const DARK_TOKENS = `
  --ol-text: var(--openleaf-color-text, #e6edf3);
  --ol-text-muted: var(--openleaf-color-text-muted, #9198a1);
  --ol-surface: var(--openleaf-color-surface, #0d1117);
  --ol-surface-hover: var(--openleaf-color-surface-hover, #21262d);
  --ol-surface-active: var(--openleaf-color-surface-active, #1f3a5f);
  --ol-border: var(--openleaf-color-border, #3d444d);
  --ol-border-strong: var(--openleaf-color-border-strong, #8b949e);
  --ol-accent: var(--openleaf-color-accent, #79c0ff);
  --ol-focus: var(--openleaf-color-focus, #79c0ff);
  --ol-danger: var(--openleaf-color-danger, #ff8182);
`

export const CSS = `
.ol-editor {
  /* Two families, named before either is public API. A singular
     \`--openleaf-font\` implies "the" font, and source view already has a
     monospace surface -- bolting a mono token on beside a singular name later
     is the awkward outcome worth avoiding now. \`--openleaf-font\` is still
     honoured as a fallback. */
  --ol-font: var(--openleaf-font-ui, var(--openleaf-font, system-ui, -apple-system, "Segoe UI", sans-serif));
  --ol-font-mono: var(--openleaf-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --ol-font-size: var(--openleaf-font-size, 14px);
  --ol-radius: var(--openleaf-radius, 4px);
  --ol-text: var(--openleaf-color-text, #1f2328);
  --ol-text-muted: var(--openleaf-color-text-muted, #59636e);
  --ol-surface: var(--openleaf-color-surface, #ffffff);
  --ol-surface-hover: var(--openleaf-color-surface-hover, #f0f1f3);
  --ol-surface-active: var(--openleaf-color-surface-active, #dbe9ff);
  --ol-border: var(--openleaf-color-border, #d1d9e0);
  /* Control boundaries, not decoration. See "Two border tokens" above. */
  --ol-border-strong: var(--openleaf-color-border-strong, #6e7781);
  --ol-accent: var(--openleaf-color-accent, #0550ae);
  --ol-focus: var(--openleaf-color-focus, #0969da);
  --ol-danger: var(--openleaf-color-danger, #cf222e);
  --ol-button-size: var(--openleaf-button-size, 32px);
  --ol-icon-size: var(--openleaf-icon-size, 16px);
  --ol-gap: var(--openleaf-gap, 2px);
  /* A 2009 WordPress admin bar sits at z-index 99999 and Drupal's toolbar plays
     similar games. Without a sanctioned escape hatch integrators fix a toolbar
     rendered behind a sticky host header with !important -- the exact thing the
     token API exists to prevent. */
  --ol-z: var(--openleaf-z-index, 1);
  /* Thickness and offset, not just colour: "you can change the colour but not
     the thickness" is a poor answer to a Section 508 team citing WCAG 2.2
     Focus Appearance. */
  --ol-focus-width: var(--openleaf-focus-width, 2px);
  --ol-focus-offset: var(--openleaf-focus-offset, 1px);
  /* Host-header pad. See "Sticky toolbar" above. */
  --ol-toolbar-sticky-offset: var(--openleaf-toolbar-sticky-offset, 0px);

  display: block;
  position: relative;
  color: var(--ol-text);
}

/* Three ways into the dark palette, and one way out of it.
   \`data-ol-scheme\` is set from the applied skin's declared scheme, and a skin
   that declares one outranks both the attribute and the system -- it has to,
   because its tokens have already replaced the palette outright. Without the
   \`:not()\` guards a light skin on a dark machine would take these fallbacks for
   every token it did not itself set, which is a light surface carrying dark-mode
   muted text. */
@media (prefers-color-scheme: dark) {
  .ol-editor:not([data-ol-theme="light"]):not([data-ol-scheme]) {${DARK_TOKENS}}
}

.ol-editor[data-ol-theme="dark"]:not([data-ol-scheme]) {${DARK_TOKENS}}

.ol-editor[data-ol-scheme="dark"] {${DARK_TOKENS}}

/* Native widget chrome -- the popup a \`select\` opens, scrollbars, the caret,
   form control backgrounds -- is painted by the browser from \`color-scheme\`,
   not from any property we can hand an integrator. Left alone it follows the
   page, which is right while the editor's own palette also follows the page and
   wrong the moment either attribute pins the editor to one world. So it is set
   exactly when the editor stops following along, and inherited from the host
   otherwise. */
.ol-editor[data-ol-theme="light"] { color-scheme: light; }
.ol-editor[data-ol-theme="dark"] { color-scheme: dark; }
.ol-editor[data-ol-scheme="light"] { color-scheme: light; }
.ol-editor[data-ol-scheme="dark"] { color-scheme: dark; }

/* Wrapping, not scrolling and not an overflow menu. Both of those hide
   controls -- one off-screen, one behind a click -- and a formatting control
   the author cannot see is a control they do not have. */
.ol-editor .ol-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ol-gap);
  box-sizing: border-box;
  margin: 0;
  padding: 4px;
  border: 1px solid var(--ol-border-strong);
  border-bottom: 0;
  border-radius: var(--ol-radius) var(--ol-radius) 0 0;
  background: var(--ol-surface);
  font: inherit;
  /* See "Sticky toolbar" above. */
  position: sticky;
  top: var(--ol-toolbar-sticky-offset);
  z-index: var(--ol-z);
}

/* Second toolbar stays in flow. See "Sticky toolbar" above. */
.ol-editor .ol-toolbar:not(.ol-floating) ~ .ol-toolbar:not(.ol-floating) {
  position: relative;
  top: auto;
}

.ol-editor .ol-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ol-gap);
}

/* The divider is a BORDER on the group, not a standalone flex item.
   As its own element it could wrap onto the trailing edge of a row with nothing
   after it -- a stranded line floating at the end of a row. Wrapping begins
   around 690-740px, well inside ordinary desktop widths (a CMS sidebar, a
   half-width split pane), so this was not a 360px-only edge case.
   border-inline-start rather than border-left, so it flips under RTL.

   This selector is why the renderer emits NO element between groups. It used to
   emit an .ol-sep div, which made the two groups non-adjacent and stopped this
   rule from ever matching -- so no divider rendered in any theme, and every bar
   carried inert empty divs. Adding a separator element back here breaks this. */
.ol-editor .ol-group + .ol-group {
  border-inline-start: 1px solid var(--ol-border);
  padding-inline-start: 5px;
  margin-inline-start: 1px;
}

/* Every property a host reset or \`button {}\` rule is likely to touch is set
   here explicitly. Specificity is (0,2,0) via the descendant selector, which
   beats a bare element or single-class host rule without resorting to
   !important. */
.ol-editor .ol-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--ol-button-size);
  height: var(--ol-button-size);
  min-width: var(--ol-button-size);
  min-height: var(--ol-button-size);
  max-width: none;
  padding: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: var(--ol-radius);
  background: transparent;
  color: var(--ol-text);
  font: inherit;
  font-family: var(--ol-font);
  font-size: var(--ol-font-size);
  font-weight: 400;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  text-align: center;
  text-decoration: none;
  text-shadow: none;
  box-shadow: none;
  opacity: 1;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  outline-offset: var(--ol-focus-offset);
  -webkit-tap-highlight-color: transparent;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.ol-editor .ol-btn:hover {
  background: var(--ol-surface-hover);
}

/* :focus-visible only, so a mouse click does not leave a ring behind, but the
   ring is never removed for keyboard users. */
.ol-editor .ol-btn:focus-visible {
  outline: var(--ol-focus-width) solid var(--ol-focus);
  outline-offset: var(--ol-focus-offset);
}

/* Pressed state is distinguished from hover by THREE signals, not just colour:
   a filled background, a visible border, and an inset shadow that reads as
   physically depressed. Colour alone would fail for a colour-blind author and
   would be invisible in forced-colours mode. */
.ol-editor .ol-btn[aria-pressed="true"] {
  background: var(--ol-surface-active);
  border-color: var(--ol-accent);
  color: var(--ol-accent);
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 12%);
}

.ol-editor .ol-btn[aria-pressed="true"]:hover {
  background: var(--ol-surface-active);
  border-color: var(--ol-accent);
}

/* aria-disabled rather than the disabled attribute: a disabled button is
   removed from the roving tabindex and cannot be reached or announced, so an
   author using a screen reader cannot discover that the control exists. */
.ol-editor .ol-btn[aria-disabled="true"] {
  opacity: 0.55;
  cursor: default;
}

.ol-editor .ol-btn[aria-disabled="true"]:hover {
  background: transparent;
}

.ol-editor .ol-icon {
  width: var(--ol-icon-size);
  height: var(--ol-icon-size);
  display: block;
  pointer-events: none;
  flex: 0 0 auto;
}

/* Block-type select. Sized and coloured to sit level with the icon buttons so
   it does not read as bolted on, but it stays a native <select> -- a custom
   listbox is a large amount of ARIA that would then owe real screen reader
   testing to be worth anything. */
.ol-editor .ol-select {
  box-sizing: border-box;
  height: var(--ol-button-size);
  max-width: 11em;
  padding: 0 22px 0 6px;
  margin: 0;
  border: 1px solid var(--ol-border-strong);
  border-radius: var(--ol-radius);
  background-color: transparent;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: right 10px center, right 6px center;
  background-size: 4px 4px, 4px 4px;
  background-repeat: no-repeat;
  color: var(--ol-text);
  font-family: var(--ol-font);
  font-size: var(--ol-font-size);
  font-weight: 400;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  box-shadow: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.ol-editor .ol-select--wide {
  max-width: 14em;
}

.ol-editor .ol-select:hover {
  background-color: var(--ol-surface-hover);
}

.ol-editor .ol-select:focus-visible {
  outline: var(--ol-focus-width) solid var(--ol-focus);
  outline-offset: var(--ol-focus-offset);
}

/* The option list is painted by the OS, which does not inherit our tokens, so
   give it explicit colours or dark mode shows black text on black. */
.ol-editor .ol-select option {
  background: var(--ol-surface);
  color: var(--ol-text);
}

.ol-editor .ol-content {
  box-sizing: border-box;
  border: 1px solid var(--ol-border-strong);
  border-radius: 0 0 var(--ol-radius) var(--ol-radius);
  background: var(--ol-surface);
}

/* Deliberately minimal: the content area inherits the host's typography, which
   is the entire reason this project does not use Shadow DOM. Only padding and
   the focus ring are ours. */
.ol-editor .ol-content .ProseMirror {
  padding: 12px;
  min-height: 8rem;
  outline: none;
}

.ol-editor .ol-content:focus-within {
  outline: 2px solid var(--ol-focus);
  outline-offset: -1px;
}

/* Tables.
   These styles live in core, not in the opt-in table plugin, because table
   NODES live in core: every deployment reads and renders tables even where
   editing them is switched off. Unstyled tables would render as runs of
   undelimited text. */
.ol-editor .ol-content .ProseMirror table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin: 0 0 1em;
  overflow: hidden;
}

.ol-editor .ol-content .ProseMirror td,
.ol-editor .ol-content .ProseMirror th {
  border: 1px solid var(--ol-border);
  padding: 6px 8px;
  vertical-align: top;
  /* A zero-width cell cannot be clicked into, so it cannot be repaired. */
  min-width: 2em;
  position: relative;
}

/* Presentational valign is otherwise beaten by the rule above, which would
   make the cell-properties dialog a no-op on screen. */
.ol-editor .ol-content .ProseMirror td[valign="middle"],
.ol-editor .ol-content .ProseMirror th[valign="middle"] { vertical-align: middle; }
.ol-editor .ol-content .ProseMirror td[valign="bottom"],
.ol-editor .ol-content .ProseMirror th[valign="bottom"] { vertical-align: bottom; }
.ol-editor .ol-content .ProseMirror td[valign="baseline"],
.ol-editor .ol-content .ProseMirror th[valign="baseline"] { vertical-align: baseline; }

.ol-editor .ol-content .ProseMirror th {
  background: var(--ol-surface-hover);
  font-weight: 600;
  text-align: start;
}

/* prosemirror-tables marks cells in a rectangular selection with this class.
   An ::after overlay rather than a background so it composes with a cell that
   already has one, and so a header cell still reads as a header.

   The ring, not the tint, is the indicator -- see "Cell selection" above. */
.ol-editor .ol-content .ProseMirror .selectedCell {
  outline: 2px solid var(--ol-accent);
  outline-offset: -2px;
}
.ol-editor .ol-content .ProseMirror .selectedCell::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--ol-surface-active);
  opacity: 0.4;
  pointer-events: none;
}

/* The column resize handle, drawn by prosemirror-tables' columnResizing. */
.ol-editor .ol-content .ProseMirror .column-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--ol-accent);
  pointer-events: none;
  z-index: 20;
}

.ol-editor .ol-content .ProseMirror.resize-cursor {
  cursor: col-resize;
}

.ol-editor .ol-content .ProseMirror img.ol-float-left {
  float: left;
  margin: 0 1em 0.5em 0;
}
.ol-editor .ol-content .ProseMirror img.ol-float-right {
  float: right;
  margin: 0 0 0.5em 1em;
}
.ol-editor .ol-content .ProseMirror img.ol-align-center {
  display: block;
  margin: 0 auto 0.5em;
}
.ol-editor .ol-content .ProseMirror figure {
  margin: 0 0 1em;
}
.ol-editor .ol-content .ProseMirror figcaption {
  font-size: .9em;
  opacity: .8;
  margin-top: .35em;
}
.ol-editor .ol-content .ProseMirror details {
  border: 1px solid var(--ol-border);
  border-radius: var(--ol-radius);
  padding: .5em .75em;
  margin: 0 0 1em;
}
.ol-editor .ol-content .ProseMirror summary {
  cursor: pointer;
  font-weight: 600;
}
.ol-editor .ol-content .ProseMirror hr.ol-pagebreak {
  border: 0;
  border-top: 2px dashed var(--ol-border);
  margin: 1.5em 0;
}
.ol-editor .ol-content .ProseMirror iframe,
.ol-editor .ol-content .ProseMirror video,
.ol-editor .ol-content .ProseMirror audio {
  max-width: 100%;
}

/* Preserved-but-unrecognised markup, surfaced rather than hidden. */
.ol-editor .ol-content .ProseMirror-selectednode {
  outline: 2px solid var(--ol-focus);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Gap cursor: the caret beside a block atom or isolating node, where no
   textblock exists. Hidden until the view is focused so it cannot paint over
   an inactive canvas. */
.ol-editor .ol-content .ProseMirror-gapcursor {
  display: none;
  pointer-events: none;
  position: absolute;
}
.ol-editor .ol-content .ProseMirror-gapcursor:after {
  content: "";
  display: block;
  position: absolute;
  top: -2px;
  width: 20px;
  border-top: 1px solid var(--ol-text);
  animation: ol-gapcursor-blink 1.1s steps(2, start) infinite;
}
@keyframes ol-gapcursor-blink {
  to { visibility: hidden; }
}
.ol-editor .ol-content .ProseMirror-focused .ProseMirror-gapcursor {
  display: block;
}

.ol-editor .ol-source {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 12rem;
  padding: 12px;
  border: 1px solid var(--ol-border-strong);
  border-radius: 0 0 var(--ol-radius) var(--ol-radius);
  background: var(--ol-surface);
  color: var(--ol-text);
  font-family: var(--ol-font-mono);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  white-space: pre-wrap;
}

/* Directional icons under RTL.
   Group order reverses for free with flexbox, but a curved undo arrow does not:
   in an RTL document "back" points the other way. Only genuinely directional
   icons are flipped -- bold and italic must not be mirrored. */
.ol-editor[dir="rtl"] .ol-icon--directional,
[dir="rtl"] .ol-editor .ol-icon--directional {
  transform: scaleX(-1);
}

/* The announcement region. Visually hidden but not display:none, which would
   remove it from the accessibility tree and silence it. */
.ol-editor .ol-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Menubar, menus, floating chrome, visual aids, fullscreen, inline. */
.ol-editor .ol-menubar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ol-gap);
  box-sizing: border-box;
  margin: 0;
  padding: 2px 4px;
  border: 1px solid var(--ol-border-strong);
  border-bottom: 0;
  border-radius: var(--ol-radius) var(--ol-radius) 0 0;
  background: var(--ol-surface);
  position: relative;
  z-index: var(--ol-z);
}
.ol-editor .ol-menubar + .ol-toolbar {
  border-radius: 0;
}
.ol-editor .ol-menu-trigger {
  box-sizing: border-box;
  margin: 0;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--ol-radius);
  background: transparent;
  color: var(--ol-text);
  font: inherit;
  font-family: var(--ol-font);
  font-size: var(--ol-font-size);
  cursor: pointer;
  appearance: none;
}
.ol-editor .ol-menu-trigger:hover,
.ol-editor .ol-menu-trigger[aria-expanded="true"] {
  background: var(--ol-surface-hover);
}
.ol-editor .ol-menu-trigger:focus-visible {
  outline: var(--ol-focus-width) solid var(--ol-focus);
  outline-offset: var(--ol-focus-offset);
}
.ol-editor .ol-menu {
  position: absolute;
  z-index: calc(var(--ol-z) + 20);
  min-width: 12rem;
  /* Capped, so a deep menu opened low on a short window can be flipped above
     its trigger instead of running off the bottom of the page. */
  max-height: 60vh;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  border: 1px solid var(--ol-border-strong);
  border-radius: var(--ol-radius);
  background: var(--ol-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}
.ol-editor .ol-menu-item {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--ol-radius);
  background: transparent;
  color: var(--ol-text);
  font: inherit;
  font-family: var(--ol-font);
  font-size: var(--ol-font-size);
  text-align: start;
  cursor: pointer;
  appearance: none;
}
.ol-editor .ol-menu-item:hover {
  background: var(--ol-surface-hover);
}
/* Was outline:none plus a 1.13:1 background swap. See "Menu focus" above. */
.ol-editor .ol-menu-item:focus-visible {
  background: var(--ol-surface-hover);
  outline: var(--ol-focus-width) solid var(--ol-focus);
  outline-offset: -2px;
}
/* 0.55, not 0.4: see "Disabled is not invisible" above. */
.ol-editor .ol-menu-item[aria-disabled="true"] {
  opacity: 0.55;
  cursor: default;
}
/* Third time for the same specificity trap, after the floating bar and the
   overflow panel below: \`.ol-editor .ol-btn\` is (0,2,0) and its
   \`display: inline-flex\` outranks the UA's \`[hidden]\` rule, so
   \`button.hidden = true\` set the attribute and painted the button anyway. A bar
   wide enough to need no overflow still showed its More trigger, and pressing
   it opened an empty panel. */
.ol-editor .ol-btn[hidden] {
  display: none;
}
.ol-editor .ol-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--ol-border);
}
/* \`display: flex\` on .ol-toolbar above outranks the UA's \`[hidden]\` rule --
   a class selector beats an attribute selector on specificity -- so setting
   \`el.hidden = true\` in floating.ts styled a hidden bar and showed it anyway.
   Both floating bars sat over the prose at rest, with no selection to format.
   The overflow panel needed the same rule for the same reason; see below. */
.ol-editor .ol-toolbar.ol-floating[hidden] {
  display: none;
}
.ol-editor .ol-toolbar.ol-floating {
  position: absolute;
  flex-wrap: nowrap;
  border: 1px solid var(--ol-border);
  border-radius: var(--ol-radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  z-index: calc(var(--ol-z) + 10);
}
.ol-editor .ol-toolbar.ol-toolbar--overflow {
  flex-wrap: nowrap;
  overflow: hidden;
}
/* The More panel. Positioned in viewport coordinates from script, because the
   bar it belongs to may live inside a host with \`overflow: hidden\` -- which is
   the situation the whole feature exists for. */
.ol-editor .ol-overflow-menu {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--ol-gap);
  max-height: 70vh;
  overflow-y: auto;
}
.ol-editor .ol-overflow-menu[hidden] {
  display: none;
}
/* Vertical: the panel exists because there is no horizontal room left. */
.ol-editor .ol-overflow-menu .ol-group {
  flex-direction: column;
  align-items: stretch;
}
.ol-editor .ol-overflow-menu .ol-group + .ol-group {
  border-inline-start: 0;
  border-block-start: 1px solid var(--ol-border);
  padding-inline-start: 0;
  margin-inline-start: 0;
  padding-block-start: 4px;
  margin-block-start: 3px;
}
.ol-editor.ol-visual-aids .ol-empty-block {
  outline: 1px dashed var(--ol-border);
  outline-offset: 2px;
  min-height: 1.2em;
}
.ol-editor.ol-visual-aids .ol-nbsp {
  background: color-mix(in srgb, var(--ol-accent) 25%, transparent);
  box-shadow: inset 0 -1px 0 var(--ol-accent);
}
.ol-editor.ol-visual-aids .ol-hidden-structure {
  outline: 1px dotted var(--ol-accent);
  outline-offset: 2px;
}
.ol-editor .ol-noneditable {
  cursor: default;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 6px,
    color-mix(in srgb, var(--ol-border) 35%, transparent) 6px,
    color-mix(in srgb, var(--ol-border) 35%, transparent) 7px
  );
}
.ol-editor.ol-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  margin: 0;
  border-radius: 0;
  background: var(--ol-surface);
  display: flex;
  flex-direction: column;
}
.ol-editor.ol-fullscreen .ol-content,
.ol-editor.ol-fullscreen .ol-source {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.ol-editor.ol-autoresize .ol-content .ProseMirror {
  overflow: hidden;
}
.ol-editor.ol-inline:not(.ol-inline-active) .ol-toolbar,
.ol-editor.ol-inline:not(.ol-inline-active) .ol-menubar {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
}
.ol-editor.ol-inline .ol-content {
  border-radius: var(--ol-radius);
}
.ol-help-table {
  width: 100%;
  border-collapse: collapse;
  font: inherit;
}
.ol-help-table th,
.ol-help-table td {
  padding: 4px 8px;
  text-align: start;
  vertical-align: top;
  border-bottom: 1px solid var(--openleaf-color-border, #d1d9e0);
}
.ol-help-table th {
  font-weight: 600;
  white-space: nowrap;
}

/* Coarse pointers get a larger target. WCAG 2.2 SC 2.5.8 asks for 24x24 CSS px
   minimum; 32 clears that on a mouse and 40 is comfortable on a thumb. */
@media (pointer: coarse) {
  .ol-editor {
    --ol-button-size: var(--openleaf-button-size, 40px);
    --ol-gap: var(--openleaf-gap, 4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ol-editor .ol-btn {
    transition: none;
  }
}

/* Forced colours (Windows high contrast) replaces our palette wholesale. The
   pressed state must not depend on a background we no longer control, so it is
   re-expressed as a border, which the mode preserves. */
@media (forced-colors: active) {
  .ol-editor .ol-btn {
    border-color: ButtonBorder;
    color: ButtonText;
  }
  .ol-editor .ol-btn[aria-pressed="true"] {
    border-color: Highlight;
    color: Highlight;
    box-shadow: none;
  }
  .ol-editor .ol-btn:focus-visible {
    outline-color: Highlight;
  }
  .ol-editor .ol-btn[aria-disabled="true"] {
    color: GrayText;
    opacity: 1;
  }
  .ol-editor .ol-menu-item:focus-visible {
    outline-color: Highlight;
  }
  .ol-editor .ol-menu-item[aria-disabled="true"] {
    color: GrayText;
    opacity: 1;
  }
  .ol-editor .ol-menu-trigger[aria-expanded="true"] {
    border-color: Highlight;
    color: Highlight;
  }
  .ol-editor .ol-content .ProseMirror .selectedCell {
    outline-color: Highlight;
  }
  .ol-editor .ol-content .ProseMirror .selectedCell::after {
    background: transparent;
  }
  .ol-editor .ol-content .ProseMirror .column-resize-handle {
    background: Highlight;
  }
  .ol-editor.ol-visual-aids .ol-nbsp {
    background: transparent;
    box-shadow: inset 0 -2px 0 Highlight;
  }
  .ol-editor.ol-visual-aids .ol-hidden-structure {
    outline-color: Highlight;
  }
  .ol-editor.ol-visual-aids .ol-empty-block {
    outline-color: GrayText;
  }
  .ol-editor .ol-noneditable {
    background: transparent;
    outline: 1px dashed GrayText;
  }
}
`
