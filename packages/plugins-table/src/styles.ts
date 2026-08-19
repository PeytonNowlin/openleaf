/**
 * Styles for the insert grid and the table context menu.
 *
 * Registered through `registerStyles` so they ride the same constructable
 * stylesheet path as the toolbar -- no `<style>` injection, which a strict CSP
 * would block silently.
 */

export const TABLE_UI_CSS = `
.ol-table-grid { display: inline-flex; }
.ol-table-pop, .ol-table-menu {
  box-sizing: border-box;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 6px);
  background: var(--openleaf-color-surface, #fff);
  color: var(--openleaf-color-text, #1f2328);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
  z-index: var(--openleaf-z-index, 1);
}
.ol-table-pop[hidden], .ol-table-menu[hidden] { display: none; }
.ol-table-pop-status {
  margin: 0 0 6px;
  font-size: .9em;
  opacity: .8;
  text-align: center;
}
.ol-table-size { display: grid; gap: 2px; }
.ol-table-size-row { display: flex; gap: 2px; }
.ol-table-size-cell {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: 2px;
  background: var(--openleaf-color-surface, #fff);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.ol-table-size-cell[aria-pressed="true"] {
  background: var(--openleaf-color-surface-active, #dbe9ff);
  border-color: var(--openleaf-color-accent, #0550ae);
}
.ol-table-size-cell:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
  outline-offset: 1px;
}
.ol-table-menu {
  min-width: 12rem;
  padding: 4px;
}
.ol-table-menu-group + .ol-table-menu-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--openleaf-color-border, #d1d9e0);
}
.ol-table-menu-item {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--openleaf-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.ol-table-menu-item:hover, .ol-table-menu-item:focus-visible {
  background: var(--openleaf-color-surface-hover, #f0f1f3);
}
.ol-table-menu-item:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da);
  outline-offset: -2px;
}
.ol-table-menu-item[aria-disabled="true"] {
  opacity: .55;
  cursor: default;
}
@media (forced-colors: active) {
  .ol-table-size-cell { border: 1px solid ButtonBorder; }
  .ol-table-size-cell[aria-pressed="true"] { outline: 2px solid Highlight; }
}
`
