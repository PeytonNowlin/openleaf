/**
 * Styles for the colour controls.
 *
 * Registered through `registerStyles` from `@openleaf-editor/ui`, which means one
 * constructable stylesheet and no `<style>` injection -- the middle tier that
 * fails silently under the strict CSPs this project exists to serve.
 *
 * Everything is namespaced under `.ol-` and every colour is a token with a
 * fallback, so a host that themes the editor themes the picker with it and one
 * that does not still gets something legible.
 */
export const COLOUR_CSS = `
.ol-color { display: inline-flex; }
.ol-editor .ol-color-trigger {
  position: relative;
  flex-direction: column;
  gap: 2px;
}
.ol-editor .ol-color-bar {
  display: block;
  width: 16px;
  height: 3px;
  border-radius: 1px;
  /* An outline, so white-on-white is still a visible swatch. */
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%);
}
.ol-color-pop {
  box-sizing: border-box;
  width: 232px;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 6px);
  background: var(--openleaf-color-surface, #fff);
  color: var(--openleaf-color-text, #1f2328);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
  /* Only consulted where the popover API is missing; in the top layer the
     z-index is irrelevant, which is the whole reason to prefer it. */
  z-index: var(--openleaf-z-index, 1);
}
.ol-color-pop[hidden] { display: none; }
.ol-color-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.ol-swatch {
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid rgb(0 0 0 / 20%);
  border-radius: 3px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.ol-swatch:hover { transform: scale(1.12); }
.ol-swatch:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
  outline-offset: 2px;
}
.ol-swatch[aria-pressed="true"] {
  outline: 2px solid var(--openleaf-color-text, #1f2328);
  outline-offset: 1px;
}
.ol-color-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.ol-color-custom { display: inline-flex; align-items: center; gap: 6px; }
.ol-color-custom input {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: 3px;
  background: none;
}
.ol-color-clear {
  padding: 4px 8px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-color-clear:focus-visible, .ol-color-custom input:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
  outline-offset: 1px;
}
/* Forced-colours mode paints over background-color, so the swatches lose their
   only visual difference. The name on every button is what keeps the control
   usable there; the border keeps the grid readable as a grid. */
@media (forced-colors: active) {
  .ol-swatch { border: 1px solid ButtonBorder; }
  .ol-swatch[aria-pressed="true"] { outline: 2px solid Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  .ol-swatch:hover { transform: none; }
}
`
