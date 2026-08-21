#!/usr/bin/env node
/**
 * Every published entry point must be importable with no DOM present.
 *
 * Node is the SSR environment: there is no `window`, no `document`, no
 * `navigator`. A browser-facing package that touches any of them at module
 * scope -- a top-level `document.createElement`, a `matchMedia` probe, a
 * `new ResizeObserver` -- throws the moment Next.js, Nuxt or Angular Universal
 * imports it on the server. That failure is invisible to the rest of the gate:
 * jsdom gives vitest a DOM and Playwright gives the e2e suite a real one.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. It does not import `packages/<name>/dist/index.js` by file path. That was
 *    the previous shape and it proved nothing about what npm actually ships:
 *    a file path bypasses `exports`, so a broken export map, a subpath that
 *    points at a file the build never emits, or a package renamed in
 *    `package.json` all resolve fine locally and 404 for an integrator. Every
 *    target here is imported by *package specifier* through a node_modules
 *    tree, exactly as a consumer resolves it.
 *
 * 2. It does not hardcode a package list. It walks `packages/`, reads each
 *    `exports` map, and checks every subpath in it, so a package or subpath
 *    added tomorrow is covered without anyone remembering to come back here.
 *
 * Non-JavaScript export targets (CSS, JSON) cannot be imported without an
 * import attribute, so those are asserted to exist on disk instead -- an
 * export map entry pointing at a file the build does not emit is the same bug.
 *
 * Requires a build first: `pnpm -r build`. `pnpm verify` runs it in order.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = join(ROOT, 'packages')

/** Collect every published target from every workspace package. */
function collectTargets() {
  const jsTargets = []
  const fileTargets = []

  for (const dir of readdirSync(PACKAGES).sort()) {
    const manifestPath = join(PACKAGES, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.private) continue

    const { name } = manifest

    // `main` and `types` are what a bundler on an older resolver reads. They
    // are not import targets, but they must point at files that exist.
    for (const field of ['main', 'types', 'module']) {
      if (typeof manifest[field] === 'string') {
        fileTargets.push({ label: `${name} (${field})`, path: join(PACKAGES, dir, manifest[field]) })
      }
    }

    const exportsMap = manifest.exports
    if (!exportsMap) {
      throw new Error(`${name} publishes no "exports" map; every published package needs one`)
    }

    for (const [subpath, entry] of Object.entries(exportsMap)) {
      const specifier = subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`
      // An entry is either a bare path or a conditions object; the "import"
      // condition is the one an ESM consumer -- and an SSR runtime -- takes.
      const target = typeof entry === 'string' ? entry : (entry.import ?? entry.default)
      if (typeof target !== 'string') {
        throw new Error(`${specifier} has no "import" or "default" condition in its exports map`)
      }
      const file = join(PACKAGES, dir, target)

      if (/\.(js|mjs|cjs)$/.test(target)) {
        jsTargets.push({ specifier, file })
      } else {
        fileTargets.push({ label: specifier, path: file })
      }

      // The types condition ships alongside; a dangling one breaks every
      // consumer with `"moduleResolution": "bundler"` or `"node16"`.
      if (typeof entry === 'object' && typeof entry.types === 'string') {
        fileTargets.push({ label: `${specifier} (types)`, path: join(PACKAGES, dir, entry.types) })
      }
    }
  }

  return { jsTargets, fileTargets }
}

/**
 * Build a throwaway node_modules tree that links the workspace packages under
 * their published names, so `import('@openleaf-editor/core')` resolves the way
 * it would for someone who ran `npm install`. The packages' own dependencies
 * still resolve from their real location, because Node resolves through the
 * symlink to the real path before looking for node_modules.
 */
function createResolutionRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'openleaf-ssr-'))
  const scope = join(dir, 'node_modules', '@openleaf-editor')
  mkdirSync(scope, { recursive: true })

  for (const pkgDir of readdirSync(PACKAGES)) {
    const manifestPath = join(PACKAGES, pkgDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const { name, private: isPrivate } = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (isPrivate || !name?.startsWith('@openleaf-editor/')) continue
    symlinkSync(resolve(PACKAGES, pkgDir), join(scope, name.slice('@openleaf-editor/'.length)), 'dir')
  }

  // The importer has to live inside the tree for bare specifiers to resolve
  // from it. It is the only reason this file exists.
  const probe = join(dir, 'probe.mjs')
  writeFileSync(probe, 'export const load = (specifier) => import(specifier)\n')
  return { dir, probe }
}

const { jsTargets, fileTargets } = collectTargets()
const failures = []

for (const { label, path } of fileTargets) {
  if (!existsSync(path)) {
    failures.push(`${label}: exports map points at ${path.slice(ROOT.length)}, which does not exist`)
  }
}

const { dir, probe } = createResolutionRoot()
try {
  const { load } = await import(pathToFileURL(probe).href)
  for (const { specifier } of jsTargets) {
    try {
      await load(specifier)
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      failures.push(`${specifier}: ${message}`)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`SSR imports FAILED (${failures.length} of ${jsTargets.length + fileTargets.length} targets):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\nIf this is a new failure, something now touches the DOM at module scope.')
  console.error('Move it into a function, or behind a `typeof document === "undefined"` guard.')
  process.exit(1)
}

console.log(
  `SSR imports passed: ${jsTargets.length} entry points imported by package specifier, ` +
    `${fileTargets.length} asset and type targets resolved.`,
)
