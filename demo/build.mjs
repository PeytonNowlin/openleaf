/**
 * Builds the distributable bundles.
 *
 *   openleaf.min.js         core: editor, paste normalizers, toolbar, dialogs,
 *                           and the table schema
 *   openleaf-tables.min.js  opt-in table editing
 *
 * The second bundle resolves ProseMirror and the OpenLeaf packages from the
 * runtime the first one publishes, rather than carrying its own copies. That is
 * what makes it ~13 KB instead of ~200 KB, and -- more importantly -- it keeps
 * exactly one schema on the page. Two schemas would mean a table node built by
 * the plugin is a different node type than the editor accepts, which fails in
 * ways nobody enjoys debugging.
 *
 * Everything here works from a fresh clone with no prior build. That is a
 * deliberate constraint, learned twice: a build script that quietly depends on
 * `dist/` existing passes on the machine that just built and fails on CI.
 */
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const src = (rel) => fileURLToPath(new URL(rel, import.meta.url))

// Copy the brand assets in beside index.html. demo/ is deployed verbatim as the
// site root, so keeping assets adjacent means the local page and the published
// page are the same file with the same paths.
mkdirSync(src('./assets'), { recursive: true })
for (const asset of ['openleaf-logo.png', 'openleaf-mark.png']) {
  cpSync(src(`../assets/${asset}`), src(`./assets/${asset}`))
}

/** Workspace packages resolved to TypeScript source, so no dist can go stale. */
const WORKSPACE_ALIASES = {
  '@openleaf/core': src('../packages/core/src/index.ts'),
  '@openleaf/paste': src('../packages/paste/src/index.ts'),
  '@openleaf/ui': src('../packages/ui/src/index.ts'),
  '@openleaf/plugins-table': src('../packages/plugins-table/src/index.ts'),
}

/** Modules the core bundle publishes and plugin bundles borrow. */
const SHARED = [
  '@openleaf/core',
  '@openleaf/paste',
  '@openleaf/ui',
  'prosemirror-commands',
  'prosemirror-history',
  'prosemirror-keymap',
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-transform',
  'prosemirror-view',
]

/**
 * Rewrite imports of shared modules to read from the host bundle's runtime.
 *
 * The shim is emitted as CommonJS -- `module.exports = ns` -- rather than as ESM
 * with a destructuring export. esbuild's interop then resolves every named
 * import as a property lookup on that object at runtime, so the export names
 * never need to be known at build time.
 *
 * The first attempt did enumerate them, by importing each package's built
 * `dist`. It worked locally and broke the deploy, because the Pages workflow
 * installs and then builds the bundle without running `pnpm -r build` -- the
 * exact build-order dependency this repo had already been bitten by once,
 * reintroduced from a different direction. Not needing the names is better than
 * remembering to build first.
 */
function shareRuntime(globalName) {
  const escaped = SHARED.map((m) => m.replace(/[/@]/g, '\\$&')).join('|')
  const filter = new RegExp(`^(${escaped})$`)

  return {
    name: 'share-runtime',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: 'shared-runtime',
      }))

      pluginBuild.onLoad({ filter: /.*/, namespace: 'shared-runtime' }, (args) => ({
        contents:
          `var host = globalThis.${globalName};\n` +
          `var ns = host && host.__runtime && host.__runtime[${JSON.stringify(args.path)}];\n` +
          `if (!ns) throw new Error(${JSON.stringify(
            `openleaf: ${args.path} is not on the host runtime. ` +
              'Load openleaf.min.js before this bundle.',
          )});\n` +
          `module.exports = ns;\n`,
        loader: 'js',
      }))
    },
  }
}

function report(label, file) {
  const raw = readFileSync(file)
  const gz = gzipSync(raw).length
  console.log(
    `${label.padEnd(24)} ${(raw.length / 1024).toFixed(1).padStart(7)} KB min` +
      `   ${(gz / 1024).toFixed(1).padStart(6)} KB gzip`,
  )
  return gz
}

/* ---- core bundle ---- */
const core = await build({
  entryPoints: [src('../packages/element/src/global.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'OpenLeaf',
  target: ['es2020'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf.min.js'),
  metafile: true,
  alias: WORKSPACE_ALIASES,
})
const coreGz = report('openleaf.min.js', src('./openleaf.min.js'))

/* ---- opt-in table bundle ---- */
await build({
  entryPoints: [src('./entry-tables.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-tables.min.js'),
  alias: { '@openleaf/plugins-table': WORKSPACE_ALIASES['@openleaf/plugins-table'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const tablesGz = report('openleaf-tables.min.js', src('./openleaf-tables.min.js'))

console.log(
  `\ncore is the budgeted bundle (${(coreGz / 1024).toFixed(1)} KB gzip). ` +
    `Tables add ${(tablesGz / 1024).toFixed(1)} KB, only for sites that load them.`,
)

/* ---- per-package attribution for the core bundle ---- */
if (process.argv.includes('--sizes')) {
  const out = Object.entries(core.metafile.outputs).find(([f]) => f.endsWith('openleaf.min.js'))
  const byPackage = new Map()
  for (const [input, meta] of Object.entries(out[1].inputs ?? {})) {
    const dep =
      /node_modules\/\.pnpm\/(?:@[^+]+\+)?([^@/]+)@/.exec(input) ??
      /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)
    const own = /packages\/([^/]+)\//.exec(input)
    const key = own ? `@openleaf/${own[1]}` : dep ? dep[1] : 'other'
    byPackage.set(key, (byPackage.get(key) ?? 0) + meta.bytesInOutput)
  }
  const rows = [...byPackage].sort((a, b) => b[1] - a[1])
  const ours = rows.filter(([n]) => n.startsWith('@openleaf/'))
  const total = rows.reduce((s, [, b]) => s + b, 0)
  const oursTotal = ours.reduce((s, [, b]) => s + b, 0)
  const width = Math.max(...rows.map(([n]) => n.length))
  console.log('\n  core bundle source breakdown (bytes in output, before gzip)')
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
