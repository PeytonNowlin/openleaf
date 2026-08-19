/**
 * Write the picker's stylesheet as a file the published package can export.
 *
 * The same arrangement as `@openleaf-editor/ui`, and for the same reason: the CSS
 * lives as a string so the constructable-stylesheet path and the linked-file path
 * cannot drift, and this copies that one string into `dist/openleaf-colour.css`
 * after `tsc`.
 *
 * The linked file exists for the case `registerStyles` cannot serve: a browser
 * with no `adoptedStyleSheets`, where it warns and injects nothing rather than
 * falling back to a `<style>` element that a strict CSP would eat silently. Its
 * warning names the UI package's stylesheet, which does not contain these rules --
 * so without this file, that deployment gets an unstyled colour grid and a pointer
 * to the wrong place.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COLOUR_CSS } from '../dist/styles.js'

const css = COLOUR_CSS.trim()
if (!css.startsWith('.ol-color')) {
  throw new Error('emit-css: expected COLOUR_CSS to start with .ol-color')
}

const out = fileURLToPath(new URL('../dist/openleaf-colour.css', import.meta.url))
writeFileSync(out, css + '\n')
console.log(`openleaf-colour.css  ${(Buffer.byteLength(css + '\n') / 1024).toFixed(1)} KB`)
