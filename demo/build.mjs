/**
 * Builds the distributable bundles.
 *
 *   openleaf.min.js         core: editor, paste normalizers, toolbar, dialogs,
 *                           and the table schema
 *   openleaf-tables.min.js  opt-in table editing
 *   openleaf-colour.min.js   opt-in colour picker
 *   openleaf-session.min.js  opt-in find, count, autosave, save, print, preview
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
for (const asset of [
  'openleaf-logo.png',
  'openleaf-logo-dark.png',
  'openleaf-mark.png',
  // Two encodings of the same three seconds, so the insert sample can show a
  // real multi-source player rather than describing one. Small enough to carry:
  // 13 KB each, a flat gradient that compresses to almost nothing.
  'sample-clip.webm',
  'sample-clip.mp4',
  'sample-poster.png',
  // The promo video, played by the "Watch it work" section. 1.4 MB, and the
  // page loads only its poster until someone presses play.
  'openleaf-promo.mp4',
  'openleaf-promo-poster.png',
]) {
  cpSync(src(`../assets/${asset}`), src(`./assets/${asset}`))
}

/** Workspace packages resolved to TypeScript source, so no dist can go stale. */
const WORKSPACE_ALIASES = {
  '@openleaf-editor/content-policy': src('../packages/content-policy/src/index.ts'),
  '@openleaf-editor/content-policy/css': src('../packages/content-policy/src/css.ts'),
  '@openleaf-editor/content-policy/elements': src('../packages/content-policy/src/elements.ts'),
  '@openleaf-editor/content-policy/embed': src('../packages/content-policy/src/embed.ts'),
  '@openleaf-editor/content-policy/url': src('../packages/content-policy/src/url.ts'),
  '@openleaf-editor/core': src('../packages/core/src/index.ts'),
  '@openleaf-editor/paste': src('../packages/paste/src/index.ts'),
  '@openleaf-editor/ui': src('../packages/ui/src/index.ts'),
  '@openleaf-editor/plugins-table': src('../packages/plugins-table/src/index.ts'),
  '@openleaf-editor/plugins-colour': src('../packages/plugins-colour/src/index.ts'),
  '@openleaf-editor/plugins-highlight': src('../packages/plugins-highlight/src/index.ts'),
  '@openleaf-editor/plugins-import': src('../packages/plugins-import/src/index.ts'),
  '@openleaf-editor/plugins-import-docx': src('../packages/plugins-import-docx/src/index.ts'),
  '@openleaf-editor/plugins-session': src('../packages/plugins-session/src/index.ts'),
  '@openleaf-editor/plugins-insert': src('../packages/plugins-insert/src/index.ts'),
  '@openleaf-editor/plugins-webmcp': src('../packages/plugins-webmcp/src/index.ts'),
}

/** Modules the core bundle publishes and plugin bundles borrow. */
const SHARED = [
  '@openleaf-editor/content-policy',
  '@openleaf-editor/core',
  '@openleaf-editor/paste',
  '@openleaf-editor/ui',
  'prosemirror-commands',
  'prosemirror-history',
  'prosemirror-keymap',
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-transform',
  'prosemirror-view',
  // Published by the import bundle rather than the core one, so a companion
  // bundle shares its converter registry instead of creating a second.
  '@openleaf-editor/plugins-import',
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
function shareRuntime(globalName, { except = [] } = {}) {
  // A bundle never borrows itself: the package that PUBLISHES an API must
  // contain it, not resolve it from the runtime it is about to populate.
  const shared = SHARED.filter((m) => !except.includes(m))
  const escaped = shared.map((m) => m.replace(/[/@]/g, '\\$&')).join('|')
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
  target: ['es2022'],
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
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-tables.min.js'),
  alias: { '@openleaf-editor/plugins-table': WORKSPACE_ALIASES['@openleaf-editor/plugins-table'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const tablesGz = report('openleaf-tables.min.js', src('./openleaf-tables.min.js'))

/* ---- opt-in colour bundle ---- */
await build({
  entryPoints: [src('./entry-colour.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-colour.min.js'),
  alias: { '@openleaf-editor/plugins-colour': WORKSPACE_ALIASES['@openleaf-editor/plugins-colour'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const colorGz = report('openleaf-colour.min.js', src('./openleaf-colour.min.js'))

/* ---- opt-in syntax highlighting bundle ---- */
await build({
  entryPoints: [src('./entry-highlight.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-highlight.min.js'),
  alias: { '@openleaf-editor/plugins-highlight': WORKSPACE_ALIASES['@openleaf-editor/plugins-highlight'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const highlightGz = report('openleaf-highlight.min.js', src('./openleaf-highlight.min.js'))

/* ---- opt-in file import bundle ---- */
await build({
  entryPoints: [src('./entry-import.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-import.min.js'),
  alias: { '@openleaf-editor/plugins-import': WORKSPACE_ALIASES['@openleaf-editor/plugins-import'] },
  plugins: [shareRuntime('OpenLeaf', { except: ['@openleaf-editor/plugins-import'] })],
})
const importGz = report('openleaf-import.min.js', src('./openleaf-import.min.js'))

/* ---- opt-in Word .docx bundle ----
   Its own file, and a big one. mammoth is larger than the whole editor, so a
   site that only imports HTML must not pay for it. */
await build({
  entryPoints: [src('./entry-import-docx.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-import-docx.min.js'),
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@openleaf-editor/plugins-import-docx': WORKSPACE_ALIASES['@openleaf-editor/plugins-import-docx'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const docxGz = report('openleaf-import-docx.min.js', src('./openleaf-import-docx.min.js'))

/* ---- opt-in session tools: find, count, autosave, save, print, preview ---- */
await build({
  entryPoints: [src('./entry-session.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-session.min.js'),
  alias: { '@openleaf-editor/plugins-session': WORKSPACE_ALIASES['@openleaf-editor/plugins-session'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const sessionGz = report('openleaf-session.min.js', src('./openleaf-session.min.js'))

/* ---- opt-in insert bundle ---- */
await build({
  entryPoints: [src('./entry-insert.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-insert.min.js'),
  alias: { '@openleaf-editor/plugins-insert': WORKSPACE_ALIASES['@openleaf-editor/plugins-insert'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const insertGz = report('openleaf-insert.min.js', src('./openleaf-insert.min.js'))

/* ---- opt-in agent tool surface (WebMCP) ----
   The smallest bundle here, and it should stay that way: no icons, no
   stylesheet, no dialogs, and nothing in it that an editor without an agent
   driving it ever runs. */
await build({
  entryPoints: [src('./entry-webmcp.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  outfile: src('./openleaf-webmcp.min.js'),
  alias: { '@openleaf-editor/plugins-webmcp': WORKSPACE_ALIASES['@openleaf-editor/plugins-webmcp'] },
  plugins: [shareRuntime('OpenLeaf')],
})
const webmcpGz = report('openleaf-webmcp.min.js', src('./openleaf-webmcp.min.js'))

console.log(
  `\ncore is the budgeted bundle (${(coreGz / 1024).toFixed(1)} KB gzip). ` +
    `Optional: tables ${(tablesGz / 1024).toFixed(1)} KB, colour ` +
    `${(colorGz / 1024).toFixed(1)} KB, highlighting ` +
    `${(highlightGz / 1024).toFixed(1)} KB, import ${(importGz / 1024).toFixed(1)} KB, ` +
    `Word .docx ${(docxGz / 1024).toFixed(1)} KB, session ${(sessionGz / 1024).toFixed(1)} KB, ` +
    `insert ${(insertGz / 1024).toFixed(1)} KB, WebMCP ${(webmcpGz / 1024).toFixed(1)} KB.`,
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
    const key = own ? `@openleaf-editor/${own[1]}` : dep ? dep[1] : 'other'
    byPackage.set(key, (byPackage.get(key) ?? 0) + meta.bytesInOutput)
  }
  const rows = [...byPackage].sort((a, b) => b[1] - a[1])
  const ours = rows.filter(([n]) => n.startsWith('@openleaf-editor/'))
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
