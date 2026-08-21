/**
 * Write the editor stylesheet as a file the published package can export.
 *
 * Styles live as a string in `css.ts` so the constructable-stylesheet path and
 * the linked-file path cannot drift. This copies that string into
 * `dist/openleaf.css` after `tsc`, which is what
 * `@openleaf-editor/ui/openleaf.css` points at.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSS } from '../dist/css.js'

const css = CSS.trim()
if (!css.startsWith('.ol-editor')) {
  throw new Error('emit-css: expected CSS to start with .ol-editor')
}

const out = fileURLToPath(new URL('../dist/openleaf.css', import.meta.url))
writeFileSync(out, css + '\n')
console.log(`openleaf.css  ${(Buffer.byteLength(css + '\n') / 1024).toFixed(1)} KB`)
