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
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: var(--openleaf-color-surface, #fff);
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
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-editor .ol-find button:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
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
.ol-editor .ol-find-hit {
  background: color-mix(in srgb, var(--openleaf-color-accent, #0550ae) 22%, transparent);
}
.ol-editor .ol-find-hit-current {
  background: color-mix(in srgb, var(--openleaf-color-accent, #0550ae) 40%, transparent);
  outline: 1px solid var(--openleaf-color-accent, #0550ae);
}
@media (forced-colors: active) {
  .ol-editor .ol-find-hit { outline: 1px dashed CanvasText; background: transparent; }
  .ol-editor .ol-find-hit-current { outline: 2px solid Highlight; }
}
.ol-session-dialog {
  box-sizing: border-box;
  max-width: min(28rem, calc(100vw - 2rem));
  padding: 0;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 6px);
  background: var(--openleaf-color-surface, #fff);
  color: var(--openleaf-color-text, #1f2328);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
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
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-session-dialog button[value="ok"] {
  border-color: var(--openleaf-color-accent, #0550ae);
  background: var(--openleaf-color-accent, #0550ae);
  color: #fff;
}
.ol-session-dialog button:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
  outline-offset: 1px;
}
.ol-preview-dialog { max-width: min(48rem, calc(100vw - 2rem)); }
.ol-preview-frame {
  display: block;
  width: min(44rem, 80vw);
  height: min(28rem, 60vh);
  margin: 0 16px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  background: #fff;
}
.ol-session-dialog .ol-stats { margin: 0 16px 8px; padding-inline-start: 1.2em; }
.ol-session-dialog .ol-danger {
  border-color: #cf222e;
  background: #cf222e;
  color: #fff;
}
`
