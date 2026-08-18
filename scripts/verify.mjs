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
const GZIP_BUDGET_KB = 90

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

// 4. Bundle size. The "no build step" promise means integrators load this over
//    the wire, so the number is a feature and regressions should hurt.
const sizeOk = step(`bundle size budget (${GZIP_BUDGET_KB} KB gzipped)`, () => {
  execFileSync('node', ['demo/build.mjs'], { cwd: ROOT, stdio: 'ignore' })
  const raw = readFileSync(new URL('../demo/openleaf.min.js', import.meta.url))
  const kb = gzipSync(raw).length / 1024
  if (kb > GZIP_BUDGET_KB) {
    throw new Error(`bundle is ${kb.toFixed(1)} KB gzipped, over the ${GZIP_BUDGET_KB} KB budget`)
  }
  return `${kb.toFixed(1)} KB gzipped of ${GZIP_BUDGET_KB} KB`
})

// Summary
const width = Math.max(...results.map((r) => r.name.length))
console.log(`\n${bold('  Openleaf verify')}`)
console.log(`  ${'-'.repeat(width + 26)}`)
for (const r of results) {
  const mark = r.ok ? green('pass') : red('FAIL')
  console.log(`  ${r.name.padEnd(width)}  ${mark}  ${dim(`${r.seconds}s`)}  ${r.note ? dim(r.note) : ''}`)
}
console.log(`  ${'-'.repeat(width + 26)}`)

const allOk = typecheckOk && unitOk && browserOk && sizeOk
if (quick) {
  console.log(
    `  ${yellow('note')} --quick ran chromium only. Run plain \`pnpm verify\` before pushing.`,
  )
}
console.log(allOk ? `  ${green('everything passed')}\n` : `  ${red('gate failed')}\n`)
process.exit(allOk ? 0 : 1)
