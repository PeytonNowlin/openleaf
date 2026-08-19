/**
 * Write the session stylesheet as a file the published package can export.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SESSION_CSS } from '../dist/styles.js'

const css = SESSION_CSS.trim()
if (!css.startsWith('.ol-editor .ol-find')) {
  throw new Error('emit-css: expected SESSION_CSS to start with .ol-editor .ol-find')
}

const out = fileURLToPath(new URL('../dist/openleaf-session.css', import.meta.url))
writeFileSync(out, css + '\n')
console.log(`openleaf-session.css  ${(Buffer.byteLength(css + '\n') / 1024).toFixed(1)} KB`)
