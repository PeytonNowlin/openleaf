export const INSERT_CSS = `
.ol-insert-grid {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(8, 2rem);
  gap: 2px;
  padding: 8px;
  max-height: 16rem;
  overflow: auto;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 6px);
  background: var(--openleaf-color-surface, #fff);
  color: var(--openleaf-color-text, #1f2328);
  font: 16px/1.2 var(--openleaf-font, system-ui, sans-serif);
  z-index: var(--openleaf-z-popover, 40);
}
.ol-insert-grid button {
  box-sizing: border-box;
  width: 2rem; height: 2rem; margin: 0; padding: 0;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.ol-insert-grid button:hover, .ol-insert-grid button:focus-visible {
  border-color: var(--openleaf-color-accent, #0550ae);
  outline: none;
}
.ol-img-resize { position: relative; display: inline-block; max-width: 100%; }
.ol-img-resize img { display: block; max-width: 100%; height: auto; }
.ol-img-handle {
  position: absolute; right: 0; bottom: 0;
  width: 12px; height: 12px; margin: 0; padding: 0;
  border: 1px solid var(--openleaf-color-accent, #0550ae);
  background: var(--openleaf-color-surface, #fff);
  cursor: nwse-resize;
}
@media print {
  .ol-pagebreak, hr.ol-pagebreak { break-after: page; page-break-after: always; border: 0; }
}
`
