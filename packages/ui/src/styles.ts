/**
 * Toolbar styles, and the two ways they can reach the page.
 *
 * ## Why this is harder than it should be
 *
 * OpenLeaf deliberately does not use Shadow DOM: the *content* area must
 * inherit the host site's typography for editing to be WYSIWYG against their
 * theme. The price is that these rules share a cascade with a stylesheet we
 * have never seen -- Bootstrap, Tailwind preflight, a 2009 WordPress theme, a
 * Drupal admin theme. So every property a host `button {}` rule or reset might
 * touch is set explicitly below, even where the browser default would do.
 *
 * `all: unset` is NOT used. It looks like the obvious answer and it is a trap:
 * it destroys the inheritance we want (font, colour) and wipes the default
 * focus behaviour we are obliged to keep.
 *
 * No `!important` either. It wins today and makes the toolbar unthemeable
 * tomorrow, which defeats the point of the custom-property API.
 *
 * ## Delivery and CSP
 *
 * Government and enterprise integrators -- the users who most need a free
 * editor -- commonly run `style-src 'self'` with no `'unsafe-inline'`, which
 * blocks an injected `<style>` element. So there are exactly two paths:
 *
 *   1. A constructable `CSSStyleSheet` added to `document.adoptedStyleSheets`.
 *      CSP gates resources *parsed as style*; a CSSOM object attached this way
 *      never passes through that gate, by design rather than by loophole.
 *   2. The integrator links `@openleaf-editor/ui/openleaf.css` themselves and calls
 *      `markStylesExternal()`.
 *
 * There is deliberately NO `<style>` injection fallback. It reads as a safety
 * net and is the opposite: it is blocked by exactly the strict-CSP setups that
 * would need it, and it fails *silently* -- an unstyled toolbar with no signal
 * an integrator can act on. A console warning naming the stylesheet is more
 * useful than a mechanism that quietly does nothing.
 */

/**
 * The dark palette, as fallbacks for the same public tokens the light one uses.
 *
 * Written once and applied from three selectors below rather than pasted three
 * times, because the failure mode of a pasted palette is one selector quietly
 * missing a line -- and the line it is missing is a colour nobody looks at until
 * it is the wrong one.
 */
const DARK_TOKENS = `
  --ol-text: var(--openleaf-color-text, #e6edf3);
  --ol-text-muted: var(--openleaf-color-text-muted, #9198a1);
  --ol-surface: var(--openleaf-color-surface, #0d1117);
  --ol-surface-hover: var(--openleaf-color-surface-hover, #21262d);
  --ol-surface-active: var(--openleaf-color-surface-active, #1f3a5f);
  --ol-border: var(--openleaf-color-border, #3d444d);
  --ol-accent: var(--openleaf-color-accent, #79c0ff);
  --ol-focus: var(--openleaf-color-focus, #79c0ff);
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
  --ol-accent: var(--openleaf-color-accent, #0550ae);
  --ol-focus: var(--openleaf-color-focus, #0969da);
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
  border: 1px solid var(--ol-border);
  border-bottom: 0;
  border-radius: var(--ol-radius) var(--ol-radius) 0 0;
  background: var(--ol-surface);
  font: inherit;
  position: relative;
  z-index: var(--ol-z);
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
   border-inline-start rather than border-left, so it flips under RTL. */
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
  opacity: 0.4;
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
  border: 1px solid var(--ol-border);
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
  border: 1px solid var(--ol-border);
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

.ol-editor .ol-content .ProseMirror th {
  background: var(--ol-surface-hover);
  font-weight: 600;
  text-align: start;
}

/* prosemirror-tables marks cells in a rectangular selection with this class.
   An ::after overlay rather than a background so it composes with a cell that
   already has one, and so a header cell still reads as a header. */
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

/* Preserved-but-unrecognised markup, surfaced rather than hidden. */
.ol-editor .ol-content .ProseMirror-selectednode {
  outline: 2px solid var(--ol-focus);
  outline-offset: 2px;
  border-radius: 2px;
}

.ol-editor .ol-source {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 12rem;
  padding: 12px;
  border: 1px solid var(--ol-border);
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
  border: 1px solid var(--ol-border);
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
  margin: 0;
  padding: 4px;
  border: 1px solid var(--ol-border);
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
.ol-editor .ol-menu-item:hover,
.ol-editor .ol-menu-item:focus-visible {
  background: var(--ol-surface-hover);
  outline: none;
}
.ol-editor .ol-menu-item[aria-disabled="true"] {
  opacity: 0.4;
  cursor: default;
}
.ol-editor .ol-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--ol-border);
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
}
`

let externallyProvided = false

/**
 * Declare that the integrator has linked `openleaf.css` themselves, so no
 * injection is attempted. Call before the first editor is created.
 */
export function markStylesExternal(): void {
  externallyProvided = true
}

const injected = new WeakSet<Document>()
const registered = new Map<Document, Set<string>>()
let warned = false

/**
 * Attach a stylesheet through the CSP-safe path.
 *
 * Public because plugins need it. The highlighting plugin previously
 * hand-rolled this -- the same constructable-stylesheet dance, the same
 * fallback, the same warning -- which meant the CSP reasoning lived in two
 * places and only one of them would get fixed.
 *
 * Deduplicated per document by the CSS text itself, so calling it twice from a
 * bundle loaded twice is harmless.
 */
export function registerStyles(css: string, target?: Document): 'adopted' | 'unavailable' | 'already' {
  const doc = target ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) return 'unavailable'

  let seen = registered.get(doc)
  if (!seen) {
    seen = new Set()
    registered.set(doc, seen)
  }
  if (seen.has(css)) return 'already'

  // CSP gates resources *parsed as style* -- <style> elements, style attributes,
  // linked stylesheets. A CSSOM object attached through adoptedStyleSheets never
  // passes through that gate, by design rather than by loophole.
  if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in Document.prototype) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      seen.add(css)
      return 'adopted'
    } catch {
      /* fall through to the warning */
    }
  }

  if (!warned) {
    warned = true
    console.warn(
      '@openleaf-editor/ui: this browser has no adoptedStyleSheets support, so styles ' +
        'were not injected. Link the stylesheet instead:\n' +
        '  <link rel="stylesheet" href=".../@openleaf-editor/ui/openleaf.css">\n' +
        'then call markStylesExternal() to silence this warning.',
    )
  }
  return 'unavailable'
}

/**
 * Ensure the editor's own stylesheet is present. Safe to call repeatedly.
 *
 * There is deliberately **no `<style>` injection fallback**. It looks like a
 * safety net and is the opposite: it fails under exactly the strict-CSP
 * configurations it would be needed for, and it fails *silently* -- a blocked
 * injection leaves an unstyled toolbar and no signal an integrator can act on.
 */
export function ensureStyles(doc: Document): 'external' | 'adopted' | 'unavailable' | 'already' {
  if (externallyProvided) return 'external'
  if (injected.has(doc)) return 'already'
  const outcome = registerStyles(CSS, doc)
  if (outcome === 'adopted') injected.add(doc)
  return outcome
}
