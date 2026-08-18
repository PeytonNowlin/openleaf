// Produces the single-file drop-in: the artifact that makes the
// "no build step required" promise true for CMS integrators.
import { build } from 'esbuild'

const result = await build({
  entryPoints: ['packages/element/src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Openleaf',
  target: ['es2020'],
  minify: true,
  sourcemap: true,
  outfile: 'demo/openleaf.min.js',
  metafile: true,
})

const out = result.metafile.outputs['demo/openleaf.min.js']
console.log(`openleaf.min.js  ${(out.bytes / 1024).toFixed(1)} KB minified`)
