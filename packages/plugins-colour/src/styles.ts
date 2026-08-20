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
  /* An outline, so white-on-white is still a visible swatch -- but a solid one
     for the same reason as \`.ol-swatch\` below: at 25% alpha this composited over
     the bar's own fill and reached 1.83:1 when that fill was white, which is the
     one case the outline exists for. */
  box-shadow: inset 0 0 0 1px var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
}
/* The \`--ol-*\` tokens first, because the popover is a child of the editor host
   and those resolve the dark palette that \`theme="dark"\` installs; the public
   \`--openleaf-*\` names are the fallback for anything rendered outside it. */
.ol-color-pop {
  box-sizing: border-box;
  width: 246px;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 6px));
  background: var(--ol-surface, var(--openleaf-color-surface, #fff));
  color: var(--ol-text, var(--openleaf-color-text, #1f2328));
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
  /* Only consulted where the popover API is missing; in the top layer the
     z-index is irrelevant, which is the whole reason to prefer it. */
  z-index: var(--openleaf-z-index, 1);
}
.ol-color-pop[hidden] { display: none; }
/* The grid holds rows and the rows hold cells, because a row role needs a real
   element to sit on. Nested grids rather than display:contents, which has a
   history of dropping the element out of the accessibility tree -- the one thing
   this structure exists to add.

   6px of gap, not 4, so the focus ring has surface on both sides rather than
   only its inner one; the popover widens by the same 14px so the swatches stay
   exactly the size they were (23.5px, and 29.5px centre to centre, which clears
   SC 2.5.8's 24px spacing exception). */
.ol-color-grid { display: grid; gap: 6px; }
.ol-color-row {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
}
.ol-color-status { margin: 0 0 6px; font-size: .85em; opacity: .8; }
/* The border is the only thing that makes a swatch a control: its fill is the
   value, not the affordance, and for White the fill is the popover's own
   background. An ALPHA border cannot do that job -- \`rgb(0 0 0 / 20%)\`
   composites over each swatch's own fill, so the edge colour is different for
   every swatch and lands between 1.61:1 (White) and 21:1 (Black), with 10 of the
   32 below 3:1. Raising the alpha does not fix it either: alpha is proportional,
   so anything dark enough to delimit White erases the edge of Black. A solid,
   fill-independent colour is the only shape of answer that works, and this one
   clears 3:1 on a light popover (4.55:1) and a dark one (4.16:1) alike. */
.ol-swatch {
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: 3px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.ol-swatch:hover { transform: scale(1.12); }
/* Focus and selection are different questions and now answer in different
   properties. They were both \`outline\` at the same 0-2-0 specificity, so the
   later selection rule won -- and picker.ts focuses the already-selected swatch
   when the picker opens, which meant opening it produced no visual change at
   all. Selection takes box-shadow; focus keeps outline to itself.

   \`outline-offset: 2px\` inside a 4px grid gap also drew the ring hard against
   the neighbouring swatch, where a blue ring on a blue neighbour is 1.00:1. The
   ring now sits in a 2px band of popover surface (>=5.19:1 in every palette) and
   the grid gap is 6px so there is still surface on its far side. */
.ol-swatch:focus-visible {
  outline: 2px solid var(--ol-focus, var(--openleaf-color-focus, #0969da));
  outline-offset: 2px;
}
.ol-swatch[aria-selected="true"] {
  box-shadow:
    0 0 0 1px var(--ol-surface, var(--openleaf-color-surface, #fff)),
    0 0 0 3px var(--ol-text, var(--openleaf-color-text, #1f2328));
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
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: 3px;
  background: none;
}
.ol-color-clear {
  padding: 4px 8px;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ol-color-clear:focus-visible, .ol-color-custom input:focus-visible {
  outline: 2px solid var(--ol-focus, var(--openleaf-color-focus, #0969da));
  outline-offset: 1px;
}
/* Forced-colours mode paints over background-color, so the swatches lose their
   only visual difference. The name on every button is what keeps the control
   usable there; the border keeps the grid readable as a grid. */
@media (forced-colors: active) {
  .ol-swatch { border: 1px solid ButtonBorder; }
  /* box-shadow is discarded in this mode, so selection cannot ride on it here
     and is re-expressed as a thicker border -- which leaves `outline` free for
     focus, the same separation as above. Previously both were `outline` and the
     selection rule won, so the focused swatch was indistinguishable. */
  .ol-swatch[aria-selected="true"] { border: 3px solid ButtonText; box-shadow: none; }
  .ol-swatch:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
}
@media (prefers-reduced-motion: reduce) {
  .ol-swatch:hover { transform: none; }
}
`
