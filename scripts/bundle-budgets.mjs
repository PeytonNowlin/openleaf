#!/usr/bin/env node
/**
 * Per-bundle gzip budgets, and the check that enforces them.
 *
 * This lives on its own so `pnpm verify` and the CI workflow measure the same
 * files against the same numbers. They used to each carry their own: CI
 * measured only `openleaf.min.js`, so an optional bundle could blow its budget,
 * fail locally and stay green on a remote runner -- the divergence a shared
 * gate exists to prevent.
 *
 * Run directly (`node scripts/bundle-budgets.mjs`) to build and check; import
 * `BUDGETS_KB` / `checkBundleSizes` to do it as part of a larger gate.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

/**
 * The plugin bundles were previously ungated, so they could grow without limit
 * while the gate stayed green -- which defeats the point of making them opt-in.
 */
export const BUDGETS_KB = {
  // Raised from 90 when alignment, colour and image upload landed. The colour
  // PICKER followed tables out into an opt-in bundle; what stayed is the part
  // core cannot delegate -- reading the `text-align` and `color` markup an
  // inherited archive already contains, which is the same reasoning that keeps
  // the table schema here while table editing is opt-in.
  'openleaf.min.js': 92,
  'openleaf-tables.min.js': 25,
  'openleaf-colour.min.js': 15,
  'openleaf-highlight.min.js': 15,
  'openleaf-import.min.js': 12,
  // Larger than the editor, which is exactly why it is a separate file.
  'openleaf-import-docx.min.js': 140,
  'openleaf-session.min.js': 10,
}

/** Short label for a bundle: `openleaf-tables.min.js` reads as `-tables`. */
function label(file) {
  return file.replace('openleaf', '').replace('.min.js', '') || 'core'
}

/**
 * Measure every bundle against its budget.
 *
 * Throws on the first bundle over budget. Returns a one-line summary so the
 * caller can print what the numbers actually were, not just that they passed.
 */
export function checkBundleSizes({ build = true } = {}) {
  const root = new URL('..', import.meta.url)
  // fileURLToPath, not `.pathname`: this repo's own path contains a space, and
  // a percent-encoded cwd is not a directory.
  if (build) execFileSync('node', ['demo/build.mjs'], { cwd: fileURLToPath(root), stdio: 'ignore' })

  const measured = []
  for (const [file, budget] of Object.entries(BUDGETS_KB)) {
    const kb = gzipSync(readFileSync(new URL(`demo/${file}`, root))).length / 1024
    if (kb > budget) {
      throw new Error(`${file} is ${kb.toFixed(1)} KB gzipped, over its ${budget} KB budget`)
    }
    measured.push(`${label(file)} ${kb.toFixed(1)}/${budget}`)
  }
  return measured.join(', ')
}

/** The human-readable list of budgets, for a step name. */
export function describeBudgets() {
  return Object.entries(BUDGETS_KB)
    .map(([name, kb]) => `${name} ${kb} KB`)
    .join(', ')
}

// Direct invocation: build, check, report, and fail the process on a breach.
// Compared as URLs because a raw `file://${argv[1]}` never matches a path with
// a space in it, which is how this silently did nothing the first time.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`gzipped: ${checkBundleSizes()}`)
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
