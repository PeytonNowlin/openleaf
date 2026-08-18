#!/usr/bin/env node
/**
 * `pnpm verify` -- the full gate, run locally.
 *
 * This is the local equivalent of the CI workflow, which is manual-only while
 * the project is young. It runs the same four checks in the same order and
 * fails the same way, so "it passes locally" and "it passes CI" mean the same
 * thing. If you change one, change the other.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * Per-bundle gzip budgets.
 *
 * The plugin bundle was previously ungated, so it could grow without limit while
 * the gate stayed green -- which defeats the point of making it opt-in.
 */
const BUDGETS_KB = {
  'openleaf.min.js': 90,
  'openleaf-tables.min.js': 25,
  'openleaf-highlight.min.js': 15,
}

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

// 1. Typecheck. Strict TypeScript across every package, which also regenerates
//    dist -- the only build the published packages ship.
const typecheckOk = step('typecheck (strict, all packages)', () => {
  run('pnpm', ['-r', 'build'])
})

// 2. Unit tests, including the round-trip fidelity corpora.
const unitOk = step('unit tests + round-trip fidelity', () => {
  run('pnpm', ['exec', 'vitest', 'run'])
})

// 3. Browser tests. Real engines, because selection, focus, clipboard and
//    composition do not exist in jsdom.
const browserOk = step(
  quick ? 'browser tests (chromium only)' : 'browser tests (chromium, firefox, webkit)',
  () => {
    run('pnpm', quick ? ['exec', 'playwright', 'test', '--project=chromium'] : ['exec', 'playwright', 'test'])
  },
)

// 4. The bundle build must not depend on anything having been built first.
//
//    This guard exists because the same bug shipped twice: `demo/build.mjs`
//    reading from `packages/*/dist` passes on a machine that just ran a build and
//    fails on a fresh checkout, which is exactly what CI is. `pnpm verify` cannot
//    catch it by running the build, because the typecheck step above has already
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

// 5. Bundle size. The "no build step" promise means integrators load this over
//    the wire, so the number is a feature and regressions should hurt.
const sizeOk = step(
  `bundle size budgets (${Object.entries(BUDGETS_KB).map(([n, k]) => `${n} ${k} KB`).join(', ')})`,
  () => {
    execFileSync('node', ['demo/build.mjs'], { cwd: ROOT, stdio: 'ignore' })
    const measured = []
    for (const [file, budget] of Object.entries(BUDGETS_KB)) {
      const raw = readFileSync(new URL(`../demo/${file}`, import.meta.url))
      const kb = gzipSync(raw).length / 1024
      if (kb > budget) {
        throw new Error(`${file} is ${kb.toFixed(1)} KB gzipped, over its ${budget} KB budget`)
      }
      measured.push(`${file.replace('openleaf', '').replace('.min.js', '') || 'core'} ${kb.toFixed(1)}/${budget}`)
    }
    return measured.join(', ')
  },
)

// Summary
const width = Math.max(...results.map((r) => r.name.length))
console.log(`\n${bold('  OpenLeaf verify')}`)
console.log(`  ${'-'.repeat(width + 26)}`)
for (const r of results) {
  const mark = r.ok ? green('pass') : red('FAIL')
  console.log(`  ${r.name.padEnd(width)}  ${mark}  ${dim(`${r.seconds}s`)}  ${r.note ? dim(r.note) : ''}`)
}
console.log(`  ${'-'.repeat(width + 26)}`)

const allOk = typecheckOk && unitOk && browserOk && cleanBuildOk && sizeOk
if (quick) {
  console.log(
    `  ${yellow('note')} --quick ran chromium only. Run plain \`pnpm verify\` before pushing.`,
  )
}
console.log(allOk ? `  ${green('everything passed')}\n` : `  ${red('gate failed')}\n`)
process.exit(allOk ? 0 : 1)
