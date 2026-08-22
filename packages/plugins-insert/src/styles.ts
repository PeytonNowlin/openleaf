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
/*
 * Both hidden states are restated here, because the rules that implement them
 * belong to the user agent while the display:grid above belongs to this sheet --
 * and an author declaration beats a UA one whatever its specificity. Without
 * these the grid is permanently displayed, and since the popover attribute also
 * carries UA position:fixed, inset:0 and margin:auto, what an author saw was an
 * emoji panel floating in the middle of the page on load, following the scroll.
 *
 * The attribute selector on the second rule matters: on a browser without
 * popover support the grid carries no such attribute and lives in the toolbar,
 * where a bare :not(:popover-open) would match forever and hide it for good.
 */
.ol-insert-grid[hidden] { display: none; }
.ol-insert-grid[popover]:not(:popover-open) { display: none; }
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
.ol-img-resize :is(img, video) { display: block; max-width: 100%; height: auto; }
/* The video is a preview, not a player: without this the engine's native media
   chrome eats the click and the node can never be selected -- in Firefox for the
   whole element, so the player could be inserted and never edited again. Stored
   HTML is serialized from the node, so the real page is unaffected. */
.ol-img-resize video { pointer-events: none; }

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
