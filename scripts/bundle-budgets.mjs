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
  //
  // Raised from 92 when insert/structure nodes (figure, details, allowlisted
  // media, heading ids) landed in the base schema, and again when table
  // captions, colgroup and cell style joined it. All of them have to live in
  // core or inherited markup degrades to an uneditable atom -- a caption core
  // cannot read is a caption it deletes.
  //
  // Raised again for editor chrome: menubar, context menus, floating toolbars,
  // help, visual aids, autolink and i18n. The framework wrappers are separate
  // packages and do not land in this file.
  //
  // Raised to 108 for typography: font family and size, line height, indent,
  // direction, language, sub/superscript and list styles. Same reasoning as
  // every rise before it -- these are marks and attributes in the storage
  // format, so an inherited `<font face>` or `<span style="font-family">` stays
  // editable text instead of becoming an opaque preserved atom. The toolbar
  // controls for them are the integrator's choice, not extra weight here.
  //
  // Raised again for the typography toolbar: three preset selects, indent and
  // outdent, and a generic `type: 'select'` in place of the block-type special
  // case. Controls rather than storage format this time, but they are the
  // controls for a format core already had, and the default bar is where an
  // author looks for them.
  //
  // 110 against a measured 107.7: the headroom is deliberate. A budget that
  // passes by tens of bytes fails on the next contributor's unrelated patch --
  // 108 left three hundred bytes, which is that trap rather than a limit.
  //
  // Raised for the accessibility and correctness series. What bought the bytes,
  // in the order it landed: visible focus indicators and the contrast fixes
  // (a second border token, the forced-colours block, the menu focus ring), a
  // keyboard-operable overflow panel that holds the real controls instead of
  // clones, the preservation-layer drop lists, and the per-keystroke work.
  //
  // None of it is storage format this time, which is a change from every rise
  // above -- it is the editor being operable without a mouse and legible at the
  // contrast ratios WCAG asks for. That is not decoration to be traded against
  // a number, so the number moved.
  //
  // Note es2022 (#74) gave 1.6 KB back first, so this rise is smaller than the
  // work in it; the series is a net +6.7 over 108, not over 110.
  //
  // 118 against a measured 114.7, which is the same ~3 KB of deliberate
  // headroom the paragraph above argues for: enough that the next unrelated
  // patch does not fail on it, not so much that a real regression hides in it.
  //
  // 121 against a measured 117.3, restoring that headroom rather than buying
  // room for anything new. The 2.6 KB since the line above is a long tail with
  // no single cause: ~1.5 KB is media editing (#101) -- the insert-media
  // commands, reading a selected player back out, and converting a player page
  // to the embed URL the allowlist accepts -- and the rest is the correctness
  // series either side of it, of which the `<source>` srcset policy (#100) and
  // the skin-styles and content-CSS scoping fixes (#96, #97) are the largest.
  //
  // Worth stating plainly, because 118 minus 117.3 is seven hundred bytes and
  // this file has been in that trap before: at that margin the gate stops
  // measuring this project's growth and starts failing on whatever unrelated
  // patch happens to arrive next, which is how a budget teaches people to raise
  // it without reading it.
  'openleaf.min.js': 121,
  'openleaf-tables.min.js': 25,
  'openleaf-colour.min.js': 15,
  'openleaf-highlight.min.js': 15,
  'openleaf-import.min.js': 12,
  // Larger than the editor, which is exactly why it is a separate file.
  'openleaf-import-docx.min.js': 140,
  // 9.2/10 after find/replace and the announcement work. The tightest budget in
  // the tree; raise it deliberately rather than shaving the feature if it goes.
  'openleaf-session.min.js': 10,
  'openleaf-insert.min.js': 20,
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
