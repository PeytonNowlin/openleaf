import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { INSERT_CSS } from '../dist/styles.js'

const css = INSERT_CSS.trim()
if (!css.startsWith('.ol-insert-grid')) {
  throw new Error('emit-css: expected INSERT_CSS to start with .ol-insert-grid')
}

const out = fileURLToPath(new URL('../dist/openleaf-insert.css', import.meta.url))
writeFileSync(out, css + '\n')
console.log(`openleaf-insert.css  ${(Buffer.byteLength(css + '\n') / 1024).toFixed(1)} KB`)
