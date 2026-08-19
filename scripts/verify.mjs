#!/usr/bin/env node
/**
 * `pnpm verify` -- the full gate, run locally.
 *
 * This is the local equivalent of the CI workflow, which is manual-only while
 * the project is young. It runs CI's four checks in the same order and fails
 * the same way, so "it passes locally" and "it passes CI" mean the same thing.
 * If you change one, change the other. The two source guards below -- the
 * dist-dependency check and the schema-singleton check -- are local-only: they
 * read the tree rather than the build, so they cost nothing to run here.
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

// 5. Nothing outside core may import a schema instance.
//
//    `export const schema` was deleted rather than deprecated, because a
//    retained const typechecks and then fails in the field: a node built from
//    one schema instance is rejected by a document built from another. This
//    guard stops it creeping back in as an import somewhere.
const schemaGuardOk = step('no schema singleton outside core', () => {
  const offenders = []
  const roots = ['packages/element/src', 'packages/ui/src', 'packages/paste/src',
                 'packages/plugins-table/src', 'packages/plugins-highlight/src',
                 'packages/plugins-media/src']
  for (const root of roots) {
    let files
    try {
      files = readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (typeof file !== 'string' || !file.endsWith('.ts')) continue
      const text = readFileSync(new URL(`../${root}/${file}`, import.meta.url), 'utf8')
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
  return 'all resolve from state.schema or coreSchema()'
})

// 6. Bundle size. The "no build step" promise means integrators load this over
//    the wire, so the number is a feature and regressions should hurt.
//    Shared with the CI workflow via scripts/bundle-budgets.mjs, so the two
//    cannot measure different files against different numbers.
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

const allOk = typecheckOk && unitOk && browserOk && cleanBuildOk && schemaGuardOk && sizeOk
if (quick) {
  console.log(
    `  ${yellow('note')} --quick ran chromium only. Run plain \`pnpm verify\` before pushing.`,
  )
}
console.log(allOk ? `  ${green('everything passed')}\n` : `  ${red('gate failed')}\n`)
process.exit(allOk ? 0 : 1)
