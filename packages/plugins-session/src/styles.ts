/**
 * Styles for the find bar, status line, preview, and search hits.
 *
 * Registered through `registerStyles` so they apply under `style-src 'self'`
 * with no `'unsafe-inline'`. Namespaced under `.ol-` and themed through tokens.
 */

export const SESSION_CSS = `
.ol-editor .ol-find {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--openleaf-color-border, #d1d9e0);
  background: var(--openleaf-color-toolbar, var(--openleaf-color-surface, #fff));
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
  color: var(--openleaf-color-text, #1f2328);
}
.ol-editor .ol-find[hidden] { display: none; }
.ol-editor .ol-find label { display: grid; gap: 2px; font-weight: 500; }
.ol-editor .ol-find input[type="search"],
.ol-editor .ol-find input[type="text"] {
  box-sizing: border-box;
  min-width: 10rem;
  padding: 4px 8px;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: var(--ol-surface, var(--openleaf-color-surface, #fff));
  color: inherit;
  font: inherit;
}
.ol-editor .ol-find .ol-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 400;
  padding-bottom: 4px;
}
.ol-editor .ol-find button {
  box-sizing: border-box;
  padding: 4px 10px;
  margin: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-editor .ol-find button:focus-visible {
  outline: 2px solid var(--ol-focus, var(--openleaf-color-focus, #0969da));
  outline-offset: 1px;
}
.ol-editor .ol-find-count {
  min-width: 7rem;
  padding-bottom: 6px;
  opacity: .8;
}
.ol-editor .ol-status {
  padding: 4px 10px 6px;
  border-top: 1px solid var(--openleaf-color-border, #d1d9e0);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: .85em;
  color: var(--openleaf-color-muted, #59636e);
}
/* A match was indicated by background tint alone, at 1.36-1.63:1 -- which fails
   1.4.11 and, being colour-only, 1.4.1 as well. Every hit now carries an
   outline, dashed for the rest and solid-and-thicker for the current one, so
   "matched" and "you are here" are told apart by shape and not only by opacity.
   The flat colour before each \`color-mix\` is a fallback, not a second opinion:
   an engine that cannot parse the mix drops that declaration and keeps this one,
   rather than rendering the hits with no background at all. */
.ol-editor .ol-find-hit {
  background: #dbe9ff;
  background: color-mix(in srgb, var(--ol-accent, var(--openleaf-color-accent, #0550ae)) 22%, transparent);
  outline: 1px dashed var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  outline-offset: 1px;
}
.ol-editor .ol-find-hit-current {
  background: #a9c9f5;
  background: color-mix(in srgb, var(--ol-accent, var(--openleaf-color-accent, #0550ae)) 40%, transparent);
  outline: 2px solid var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  outline-offset: 1px;
}
@media (forced-colors: active) {
  .ol-editor .ol-find-hit { outline: 1px dashed CanvasText; background: transparent; }
  .ol-editor .ol-find-hit-current { outline: 2px solid Highlight; }
}
/* Reads the internal \`--ol-*\` tokens first now that the dialog is mounted
   inside the editor host: those resolve the dark palette that \`theme="dark"\`
   installs, which the public names alone never see. The \`--openleaf-*\` names
   remain the fallback for anything rendered outside a host. */
.ol-session-dialog {
  box-sizing: border-box;
  max-width: min(28rem, calc(100vw - 2rem));
  padding: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 6px));
  background: var(--ol-surface, var(--openleaf-color-surface, #fff));
  color: var(--ol-text, var(--openleaf-color-text, #1f2328));
  font-family: var(--ol-font, var(--openleaf-font, system-ui, -apple-system, sans-serif));
  font-size: var(--ol-font-size, var(--openleaf-font-size, 14px));
}
.ol-session-dialog::backdrop { background: rgb(0 0 0 / 40%); }
.ol-session-dialog form, .ol-session-dialog h2 { margin: 0; }
.ol-session-dialog h2 { font-size: 1.1em; padding: 16px 16px 0; }
.ol-session-dialog p, .ol-session-dialog .ol-hint { margin: 8px 16px 0; }
.ol-session-dialog .ol-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
}
.ol-session-dialog button {
  box-sizing: border-box;
  padding: 6px 12px;
  margin: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-session-dialog button[value="ok"] {
  border-color: var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  background: var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  color: var(--ol-surface, var(--openleaf-color-surface, #fff));
}
.ol-session-dialog button:focus-visible {
  outline: var(--ol-focus-width, 2px) solid var(--ol-focus, var(--openleaf-color-focus, #0969da));
  outline-offset: 1px;
}
.ol-preview-dialog { max-width: min(48rem, calc(100vw - 2rem)); }
.ol-preview-frame {
  display: block;
  width: min(44rem, 80vw);
  height: min(28rem, 60vh);
  margin: 0 16px;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  /* Stays white: the frame renders the author's document as a reader will see
     it, and repainting that in the editor's palette would be a lie. */
  background: #fff;
}
.ol-session-dialog .ol-stats { margin: 0 16px 8px; padding-inline-start: 1.2em; }
.ol-session-dialog .ol-danger {
  border-color: var(--ol-danger, #cf222e);
  background: var(--ol-danger, #cf222e);
  color: var(--ol-surface, var(--openleaf-color-surface, #fff));
}
`
