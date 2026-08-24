export const INSERT_CSS = `
.ol-insert-grid {
  box-sizing: border-box;
  display: grid;
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
 * popover support the grid carries no such attribute and lives on the host,
 * where a bare :not(:popover-open) would match forever and hide it for good.
 */
.ol-insert-grid[hidden] { display: none; }
.ol-insert-grid[popover]:not(:popover-open) { display: none; }
/*
 * Must match GLYPH_COLUMNS in glyphs.ts: the keyboard model steps by this
 * width, and a CSS-only column count would let arrows land in a different
 * cell than the one the reader announced.
 */
.ol-insert-row {
  display: grid;
  grid-template-columns: repeat(8, 2rem);
  gap: 2px;
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
.ol-img-resize :is(img, video) { display: block; max-width: 100%; height: auto; }
/* The video is a preview, not a player: without this the engine's native media
   chrome eats the click and the node can never be selected -- in Firefox for the
   whole element, so the player could be inserted and never edited again. Stored
   HTML is serialized from the node, so the real page is unaffected. */
.ol-img-resize video { pointer-events: none; }
/* ...until the author asks for one. The node view puts this class on a single
   selected video and takes it off when the selection moves on, so at most one
   player is live at a time. Specificity, not !important: one class more than the
   rule above, and after it. */
.ol-img-resize.ol-media-live video { pointer-events: auto; }

/* The activation gesture: our button, not the engine's -- Firefox routes the
   whole of a <video controls> into its native chrome, so a listener on the
   element never hears the pointerdown. Present only while the node is selected,
   so the first click on a video is still the one that selects it. */
.ol-media-play {
  box-sizing: border-box;
  position: absolute;
  inset: 0;
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px; height: 44px; padding: 0;
  border: 2px solid var(--openleaf-color-surface, #fff);
  border-radius: 50%;
  background: var(--openleaf-color-accent, #0550ae);
  color: var(--openleaf-color-surface, #fff);
  cursor: pointer;
}
/* The same trap as the insert grid above: display:flex here is an author
   declaration and the UA's display:none for [hidden] is not, so without this
   the button would sit on every video, selected or not. */
.ol-media-play[hidden] { display: none; }
.ol-media-play:focus-visible {
  outline: 2px solid var(--openleaf-color-accent, #0550ae);
  outline-offset: 3px;
}
/* A border triangle: no font can be relied on for a play glyph. */
.ol-media-play::before {
  content: "";
  width: 0; height: 0;
  margin-left: 4px;
  border-left: 13px solid currentColor;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
}

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
