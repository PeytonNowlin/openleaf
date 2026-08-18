// Produces the single-file drop-in: the artifact that makes the
// "no build step required" promise true for CMS integrators.
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const src = (rel) => fileURLToPath(new URL(rel, import.meta.url))

// Copy the brand assets in beside index.html. demo/ is deployed verbatim as the
// site root, so keeping assets adjacent means the local page and the published
// page are the same file with the same paths -- nothing is rewritten at deploy
// time and nothing can differ between what was tested and what ships.
mkdirSync(src('./assets'), { recursive: true })
for (const asset of ['openleaf-logo.png', 'openleaf-mark.png']) {
  cpSync(src(`../assets/${asset}`), src(`./assets/${asset}`))
}

const result = await build({
  entryPoints: [src('../packages/element/src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'OpenLeaf',
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
    '@openleaf/ui': src('../packages/ui/src/index.ts'),
  },
})

const out = Object.entries(result.metafile.outputs).find(([f]) => f.endsWith('openleaf.min.js'))
console.log(`openleaf.min.js  ${(out[1].bytes / 1024).toFixed(1)} KB minified`)

// Per-package attribution.
//
// The aggregate gate only says whether the bundle fits. It cannot say WHICH
// feature spent the budget, so a regression only surfaces when whatever ships
// last turns the gate red -- and the blame lands on the wrong change. This
// breaks the total down by source package so the cost of tables, alignment or
// colours is visible as it lands.
if (process.argv.includes('--sizes')) {
  const byPackage = new Map()
  for (const [input, meta] of Object.entries(out[1].inputs ?? {})) {
    // pnpm stores dependencies under node_modules/.pnpm/<name>@<version>/...,
    // so the plain node_modules pattern collapses every dependency into
    // ".pnpm". Match the real package name first.
    const dep =
      /node_modules\/\.pnpm\/(?:@[^+]+\+)?([^@/]+)@/.exec(input) ??
      /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)
    const own = /packages\/([^/]+)\//.exec(input)
    const key = own ? `@openleaf/${own[1]}` : (dep ? dep[1] : 'other')
    byPackage.set(key, (byPackage.get(key) ?? 0) + meta.bytesInOutput)
  }

  const rows = [...byPackage].sort((a, b) => b[1] - a[1])
  const ours = rows.filter(([name]) => name.startsWith('@openleaf/'))
  const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0)
  const oursTotal = ours.reduce((sum, [, bytes]) => sum + bytes, 0)

  const width = Math.max(...rows.map(([name]) => name.length))
  console.log('\n  source breakdown (bytes in output, before gzip)')
  console.log('  ' + '-'.repeat(width + 14))
  for (const [name, bytes] of rows) {
    console.log(`  ${name.padEnd(width)}  ${(bytes / 1024).toFixed(1).padStart(8)} KB`)
  }
  console.log('  ' + '-'.repeat(width + 14))
  console.log(
    `  OpenLeaf code is ${(oursTotal / 1024).toFixed(1)} KB of ${(total / 1024).toFixed(1)} KB` +
      ` (${Math.round((oursTotal / total) * 100)}%); the rest is the ProseMirror engine.`,
  )
}
