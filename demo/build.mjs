/**
 * Builds the distributable bundles.
 *
 *   openleaf.min.js         core: editor, paste normalizers, toolbar, dialogs
 *   openleaf-tables.min.js  opt-in table editing
 *
 * The second bundle resolves ProseMirror and the OpenLeaf packages from the
 * runtime the first one publishes, rather than carrying its own copies. That is
 * what makes it ~25 KB instead of ~200 KB, and -- more importantly -- it keeps
 * exactly one schema on the page. Two schemas would mean a table node built by
 * the plugin is a different node type than the one the editor accepts, which
 * fails in ways nobody enjoys debugging.
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const src = (rel) => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Resolve shared modules the way the plugin package sees them.
 *
 * pnpm's strict layout means the repo root cannot reach `prosemirror-state`;
 * only packages that declare it can. Resolving from the plugin's own
 * package.json gets the same copy the bundle will link against, rather than
 * requiring the root to declare dependencies it does not use.
 */
const requireFromPlugin = createRequire(src('../packages/plugins-table/package.json'))

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
 * Export names are enumerated by importing the real module at build time rather
 * than being maintained by hand, so adding an export upstream cannot silently
 * leave a plugin importing `undefined`.
 */
function shareRuntime(globalName) {
  return {
    name: 'share-runtime',
    setup(pluginBuild) {
      const filter = new RegExp(`^(${SHARED.map((m) => m.replace(/[/@]/g, '\\$&')).join('|')})$`)

      pluginBuild.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: 'shared-runtime',
      }))

      pluginBuild.onLoad({ filter: /.*/, namespace: 'shared-runtime' }, async (args) => {
        const resolved = WORKSPACE_ALIASES[args.path]
          ? distFor(args.path)
          : requireFromPlugin.resolve(args.path)
        const real = await import(pathToFileURL(resolved).href)
        // Only valid bare identifiers: a namespace import of a
        // CommonJS-interop module also exposes keys like `module.exports`,
        // which cannot appear in a destructuring export.
        const names = Object.keys(real).filter(
          (n) => n !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n),
        )
        return {
          contents:
            `const ns = globalThis.${globalName}.__runtime[${JSON.stringify(args.path)}];\n` +
            `if (!ns) throw new Error(${JSON.stringify(
              `openleaf: ${args.path} is not on the host runtime. Load openleaf.min.js before this bundle.`,
            )});\n` +
            `export default ns;\n` +
            (names.length ? `export const { ${names.join(', ')} } = ns;\n` : ''),
          loader: 'js',
        }
      })
    },
  }
}

/** Built output for a workspace package, used only to enumerate export names. */
function distFor(pkg) {
  const name = pkg.replace('@openleaf/', '')
  const path = src(`../packages/${name}/dist/index.js`)
  if (!existsSync(path)) {
    throw new Error(
      `demo/build.mjs: ${pkg} has not been built. The plugin bundle reads its ` +
        'export names from dist. Run `pnpm -r build` first.',
    )
  }
  return path
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
