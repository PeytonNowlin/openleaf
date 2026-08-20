/**
 * Token colours.
 *
 * Every colour is a custom property with a fallback, so an integrator can theme
 * highlighting the same way they theme the toolbar -- and so a site with its own
 * code palette can match it without forking.
 *
 * Contrast was chosen against the editor surface in both schemes rather than
 * copied from a terminal theme: several popular palettes put comments at around
 * 3:1 on white, which fails WCAG 1.4.3 for body-size text. Comments here are the
 * colour most likely to be dismissed as "just grey" and are deliberately not.
 *
 * The two palettes are written once each below, and *which* one is in force is
 * kept a separate question from what the colours are -- otherwise the selectors
 * that answer it would each carry their own copy of seventeen colours, and the
 * one line a copy was missing would be a colour nobody looks at until it is the
 * wrong one.
 */
const LIGHT_TOKENS = `
  --ol-t-comment: var(--openleaf-code-comment, #5c6370);
  /* #6e7781 was 4.27:1 on the #f6f8fa code surface -- the only token in either
     palette below 4.5:1, and punctuation is where a missing brace hides. */
  --ol-t-punct: var(--openleaf-code-punctuation, #656d76);
  --ol-t-tag: var(--openleaf-code-tag, #116329);
  --ol-t-attr: var(--openleaf-code-attr-name, #0550ae);
  --ol-t-value: var(--openleaf-code-attr-value, #0a3069);
  --ol-t-string: var(--openleaf-code-string, #0a3069);
  --ol-t-keyword: var(--openleaf-code-keyword, #cf222e);
  --ol-t-literal: var(--openleaf-code-literal, #953800);
  --ol-t-number: var(--openleaf-code-number, #953800);
  --ol-t-function: var(--openleaf-code-function, #8250df);
  --ol-t-operator: var(--openleaf-code-operator, #cf222e);
  --ol-t-selector: var(--openleaf-code-selector, #116329);
  --ol-t-property: var(--openleaf-code-property, #0550ae);
  --ol-t-entity: var(--openleaf-code-entity, #953800);
  --ol-t-fg: var(--openleaf-code-text, #1f2328);
  --ol-t-surface: var(--openleaf-code-surface, #f6f8fa);
  --ol-t-code-border: var(--openleaf-code-border, #d1d9e0);
`

const DARK_TOKENS = `
  --ol-t-comment: var(--openleaf-code-comment, #8b949e);
  --ol-t-punct: var(--openleaf-code-punctuation, #8b949e);
  --ol-t-tag: var(--openleaf-code-tag, #7ee787);
  --ol-t-attr: var(--openleaf-code-attr-name, #79c0ff);
  --ol-t-value: var(--openleaf-code-attr-value, #a5d6ff);
  --ol-t-string: var(--openleaf-code-string, #a5d6ff);
  --ol-t-keyword: var(--openleaf-code-keyword, #ff7b72);
  --ol-t-literal: var(--openleaf-code-literal, #ffa657);
  --ol-t-number: var(--openleaf-code-number, #ffa657);
  --ol-t-function: var(--openleaf-code-function, #d2a8ff);
  --ol-t-operator: var(--openleaf-code-operator, #ff7b72);
  --ol-t-selector: var(--openleaf-code-selector, #7ee787);
  --ol-t-property: var(--openleaf-code-property, #79c0ff);
  --ol-t-entity: var(--openleaf-code-entity, #ffa657);
  --ol-t-fg: var(--openleaf-code-text, #e6edf3);
  --ol-t-surface: var(--openleaf-code-surface, #161b22);
  --ol-t-code-border: var(--openleaf-code-border, #30363d);
`

export const HIGHLIGHT_CSS = `
.ol-editor {${LIGHT_TOKENS}}

/* Which palette, and why a skin gets the last word.
   The obvious answer -- follow \`prefers-color-scheme\` -- is only right while the
   editor around the code block is following it too. A skin replaces the editor's
   palette outright and is unmoved by the system setting, so a code block that
   kept following the system landed a dark surface inside a cream editor on any
   machine set to dark. Hence \`data-ol-scheme\`, which the skin declares: it wins
   over the theme attribute, and the theme attribute wins over the system, in the
   same order the editor's own surface resolves. Matching that order is the whole
   fix -- a syntax palette is only ever readable relative to the surface it is
   sitting on, and here that surface belongs to the editor. */
@media (prefers-color-scheme: dark) {
  .ol-editor:not([data-ol-theme="light"]):not([data-ol-scheme]) {${DARK_TOKENS}}
}

.ol-editor[data-ol-theme="dark"]:not([data-ol-scheme]) {${DARK_TOKENS}}

.ol-editor[data-ol-scheme="dark"] {${DARK_TOKENS}}

/* The code block's own surface.
   Owning the background is not a style preference: this plugin sets foreground
   colours chosen against a known surface, and a host page that styles pre
   elements -- as this project's own demo did -- can leave those colours on a
   background they were never picked for. Light-mode syntax colours on a dark
   host background are unreadable, and they were unreadable on our own demo page
   before this rule. Without the plugin loaded, pre is left entirely to the host,
   because then nothing here has an opinion about its foreground either.

   The unhighlighted text in the block -- whitespace-separated identifiers no
   grammar claimed, and every line of a block whose language is unknown -- is
   coloured from the same palette for the same reason. It previously inherited
   the editor's own text colour, which is a different colour chosen against a
   different background, and read as invisible whenever the two surfaces
   disagreed. */
.ol-editor .ol-content .ProseMirror pre {
  background: var(--ol-t-surface);
  color: var(--ol-t-fg);
  border: 1px solid var(--ol-t-code-border);
  border-radius: var(--ol-radius, 4px);
  padding: 10px 12px;
  overflow-x: auto;
}

.ol-editor .ol-content .ProseMirror pre code {
  background: none;
  padding: 0;
  border: 0;
  font-size: inherit;
}

.ol-editor .ol-t-comment { color: var(--ol-t-comment); font-style: italic; }
.ol-editor .ol-t-punctuation { color: var(--ol-t-punct); }
.ol-editor .ol-t-tag { color: var(--ol-t-tag); }
.ol-editor .ol-t-attr-name { color: var(--ol-t-attr); }
.ol-editor .ol-t-attr-value { color: var(--ol-t-value); }
.ol-editor .ol-t-string { color: var(--ol-t-string); }
.ol-editor .ol-t-keyword { color: var(--ol-t-keyword); }
.ol-editor .ol-t-literal { color: var(--ol-t-literal); }
.ol-editor .ol-t-number { color: var(--ol-t-number); }
.ol-editor .ol-t-function { color: var(--ol-t-function); }
.ol-editor .ol-t-operator { color: var(--ol-t-operator); }
.ol-editor .ol-t-selector { color: var(--ol-t-selector); }
.ol-editor .ol-t-property { color: var(--ol-t-property); }
.ol-editor .ol-t-doctype { color: var(--ol-t-comment); }
.ol-editor .ol-t-entity { color: var(--ol-t-entity); }
.ol-editor .ol-t-at-rule { color: var(--ol-t-keyword); }

/* Forced colours discards author colours entirely, which is the point of the
   mode. Italic comments still carry, so the one distinction that survives is
   kept rather than fought. */
@media (forced-colors: active) {
  .ol-editor [class*="ol-t-"] { color: CanvasText; }
  .ol-editor .ol-t-comment { color: GrayText; }
}

/* The source view overlay.
   A textarea cannot render coloured text, so a <pre> holding the highlighted
   copy sits exactly behind a textarea whose own text is transparent. Every
   metric that affects glyph position must match between the two or the caret
   drifts from the characters -- which is why font, size, line-height, padding,
   border, letter-spacing, tab-size and wrapping are all declared once here and
   inherited by both. */
.ol-editor .ol-src {
  position: relative;
  display: grid;
}

.ol-editor .ol-src > .ol-source,
.ol-editor .ol-src > .ol-src-view {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  /* Matches \`.ol-source\` in the core sheet: this is the editable region's
     boundary, so it takes the control token rather than the decorative one. */
  border: 1px solid var(--ol-border-strong);
  border-radius: 0 0 var(--ol-radius) var(--ol-radius);
  font-family: var(--ol-font-mono);
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: normal;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  overflow: auto;
  min-height: 12rem;
}

.ol-editor .ol-src > .ol-src-view {
  pointer-events: none;
  background: var(--ol-surface);
  color: var(--ol-text);
  z-index: 0;
}

.ol-editor .ol-src > .ol-source {
  z-index: 1;
  background: transparent;
  color: transparent;
  caret-color: var(--ol-text);
  resize: none;
}

/* Selection must stay visible even though the text itself is transparent. */
.ol-editor .ol-src > .ol-source::selection { background: var(--ol-surface-active); color: var(--ol-text); }
`
