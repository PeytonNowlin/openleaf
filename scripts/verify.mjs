#!/usr/bin/env node
/**
 * `pnpm verify` -- the gate. This file IS the gate.
 *
 * CI does not reimplement these steps; `.github/workflows/ci.yml` shells out to
 * `node scripts/verify.mjs --quick` on every push and pull request, and to the
 * plain three-engine form nightly. That is deliberate: the previous arrangement
 * listed the steps in both places and they drifted -- CI grew a step named
 * "Typecheck" that ran `pnpm -r build`, which does not typecheck a single test
 * file. Adding a step here adds it to CI, and there is no second list to forget.
 *
 * The only difference between local and CI is `--quick`, which runs chromium
 * alone instead of all three engines. Run plain `pnpm verify` before pushing.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkBundleSizes, describeBudgets } from './bundle-budgets.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = new Set(process.argv.slice(2))
const quick = args.has('--quick')

/** ANSI helpers, disabled when not writing to a terminal. */
const tty = process.stdout.isTTY
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s)
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s)
const yellow = (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s)

const results = []

function step(name, fn) {
  const started = Date.now()
  process.stdout.write(`${dim('▸')} ${name} ${dim('...')}\n`)
  let ok = false
  let note = ''
  try {
    note = fn() ?? ''
    ok = true
  } catch (error) {
    note = error instanceof Error ? error.message.split('\n')[0] : String(error)
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name, ok, note, seconds })
  return ok
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited ${result.status}`)
}

// 1. Build. Each package's own build script, which regenerates dist -- the only
//    build the published packages ship -- and for several of them also emits
//    CSS or JSON that `tsc` knows nothing about.
//
//    This step used to be labelled "typecheck". It was not one: each package's
//    tsconfig is `include: ["src"]`, so building every package leaves every test
//    file unchecked. A real TS2379 sat in a test file while this reported green.
const buildOk = step('build (all packages, emits dist)', () => {
  run('pnpm', ['-r', 'build'])
})

// 2. Typecheck, for real: `tsc -b` over the package projects plus
//    `tsc -p tsconfig.tests.json`, which is the only thing that ever type checks
//    a test file. Nothing else in this gate reads that project.
const typecheckOk = step('typecheck (strict, src and tests)', () => {
  run('pnpm', ['typecheck'])
})

// 3. Unit tests, including the round-trip fidelity corpora.
const unitOk = step('unit tests + round-trip fidelity', () => {
  run('pnpm', ['exec', 'vitest', 'run'])
})

// 4. Browser tests. Real engines, because selection, focus, clipboard and
//    composition do not exist in jsdom.
const browserOk = step(
  quick ? 'browser tests (chromium only)' : 'browser tests (chromium, firefox, webkit)',
  () => {
    run('pnpm', quick ? ['exec', 'playwright', 'test', '--project=chromium'] : ['exec', 'playwright', 'test'])
  },
)

// 5. The bundle build must not depend on anything having been built first.
//
//    This guard exists because the same bug shipped twice: `demo/build.mjs`
//    reading from `packages/*/dist` passes on a machine that just ran a build and
//    fails on a fresh checkout, which is exactly what CI is. `pnpm verify` cannot
//    catch it by running the build, because the build step above has already
//    created dist by then -- so the invariant is asserted directly instead.
const cleanBuildOk = step('bundle build has no dist dependency', () => {
  const script = readFileSync(new URL('../demo/build.mjs', import.meta.url), 'utf8')
  const offenders = script
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\/dist\b/.test(line) && !line.trimStart().startsWith('*'))
  if (offenders.length > 0) {
    throw new Error(
      'demo/build.mjs reads from a built dist/, which breaks a fresh checkout: ' +
        offenders.map(([n, l]) => `line ${n}: ${l.trim()}`).join('; '),
    )
  }
  return 'resolves workspace packages from source'
})

// 6. Nothing outside core may import a schema instance.
//
//    `export const schema` was deleted rather than deprecated, because a
//    retained const typechecks and then fails in the field: a node built from
//    one schema instance is rejected by a document built from another. This
//    guard stops it creeping back in as an import somewhere.
//
//    The directory list used to be a literal array of seven paths, which had
//    already fallen behind the tree -- plugins-colour, plugins-import,
//    plugins-import-docx, sanitize, content-policy and the three framework
//    wrappers were all unguarded, as was every test/ directory. It walks
//    `packages/` now, so a package added tomorrow is guarded on the day it
//    lands rather than the day someone remembers this file.
const schemaGuardOk = step('no schema singleton outside core', () => {
  const offenders = []
  const roots = []
  for (const pkg of readdirSync(new URL('../packages', import.meta.url))) {
    if (pkg === 'core') continue
    for (const sub of ['src', 'test']) roots.push(`packages/${pkg}/${sub}`)
  }
  let scanned = 0
  for (const root of roots) {
    let files
    try {
      files = readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (typeof file !== 'string' || !/\.(ts|tsx|mts)$/.test(file)) continue
      const text = readFileSync(new URL(`../${root}/${file}`, import.meta.url), 'utf8')
      scanned += 1
      text.split('\n').forEach((line, i) => {
        if (/^import .*\bschema\b.*from ['"]@openleaf-editor\/core['"]/.test(line)) {
          offenders.push(`${root}/${file}:${i + 1}`)
        }
      })
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      'these import a schema instance from core; use state.schema or coreSchema(): ' +
        offenders.join(', '),
    )
  }
  return `${scanned} files across every package's src and test`
})

// 7. Every published entry point still imports with no DOM present, by package
//    specifier rather than by file path, so the exports map is exercised too.
//    See scripts/ssr-imports.mjs for why both halves of that matter.
const ssrOk = step('SSR imports (every published entry point)', () => {
  run('node', ['scripts/ssr-imports.mjs'])
})

// 8. Bundle size. The "no build step" promise means integrators load this over
//    the wire, so the number is a feature and regressions should hurt.
const sizeOk = step(`bundle size budgets (${describeBudgets()})`, () => checkBundleSizes())

// Summary
const width = Math.max(...results.map((r) => r.name.length))
console.log(`\n${bold('  OpenLeaf verify')}`)
console.log(`  ${'-'.repeat(width + 26)}`)
for (const r of results) {
  const mark = r.ok ? green('pass') : red('FAIL')
  console.log(`  ${r.name.padEnd(width)}  ${mark}  ${dim(`${r.seconds}s`)}  ${r.note ? dim(r.note) : ''}`)
}
console.log(`  ${'-'.repeat(width + 26)}`)

const allOk =
  buildOk && typecheckOk && unitOk && browserOk && cleanBuildOk && schemaGuardOk && ssrOk && sizeOk
if (quick) {
  console.log(
    `  ${yellow('note')} --quick ran chromium only. Run plain \`pnpm verify\` before pushing.`,
  )
}
console.log(allOk ? `  ${green('everything passed')}\n` : `  ${red('gate failed')}\n`)
process.exit(allOk ? 0 : 1)
