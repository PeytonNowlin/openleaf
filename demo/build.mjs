// Produces the single-file drop-in: the artifact that makes the
// "no build step required" promise true for CMS integrators.
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const src = (rel) => fileURLToPath(new URL(rel, import.meta.url))

const result = await build({
  entryPoints: [src('../packages/element/src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Openleaf',
  target: ['es2020'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf.min.js'),
  metafile: true,
  alias: {
    // Resolve the workspace package to its TypeScript SOURCE rather than to
    // its built `dist/`. Two reasons, both learned the hard way:
    //
    //  1. No build ordering. `node demo/build.mjs` works on a fresh clone
    //     without `pnpm -r build` first. CI hit exactly this: the browser job
    //     installs and goes straight to the e2e suite, so dist did not exist
    //     and esbuild could not resolve @openleaf/core.
    //  2. No stale artifacts. Bundling source makes it impossible to ship or
    //     test against a dist that is older than the code.
    '@openleaf/core': src('../packages/core/src/index.ts'),
    '@openleaf/paste': src('../packages/paste/src/index.ts'),
  },
})

const out = Object.entries(result.metafile.outputs).find(([f]) => f.endsWith('openleaf.min.js'))
console.log(`openleaf.min.js  ${(out[1].bytes / 1024).toFixed(1)} KB minified`)
