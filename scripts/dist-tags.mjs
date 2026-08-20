#!/usr/bin/env node
/**
 * Point every published package's `latest` and `beta` dist-tags at the version
 * in this working tree.
 *
 * This exists because `npm publish --tag beta` sets exactly one tag, and npm
 * only assigns `latest` implicitly on a package's FIRST publish. The result,
 * discovered after 0.1.0-beta.1 shipped: nine of ten packages still had
 * `latest` pinned to 0.1.0-beta.0, so a plain `npm install @openleaf-editor/element`
 * -- the command anybody types who does not read as far as the `@beta` suffix --
 * installed a build with no `registerImageUploader`, an API the README documents
 * with a code sample. Handing somebody a missing export is a worse first
 * impression than any argument about whether `latest` should track a
 * pre-release.
 *
 * So it should, until 1.0. There is no stable line to protect yet, and a
 * `latest` frozen at the oldest pre-release is strictly worse for every reader
 * than one that tracks the newest.
 *
 * Idempotent, so re-running after a partial failure is safe.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every publishable workspace package, with the version it currently declares. */
export function publishablePackages() {
  const found = []
  for (const dir of readdirSync(join(root, 'packages'))) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (manifest.private || !manifest.name || !manifest.version) continue
    found.push({ name: manifest.name, version: manifest.version })
  }
  return found
}

const TAGS = ['latest', 'beta']

function main() {
  const packages = publishablePackages()
  if (packages.length === 0) throw new Error('no publishable packages found')

  const versions = new Set(packages.map((p) => p.version))
  if (versions.size !== 1) {
    // All packages share one version by design -- they are released together and
    // the README tells people to keep them aligned. A split here means a bump
    // was applied to some and not others, and tagging that would publish the
    // inconsistency to the registry.
    throw new Error(
      `packages disagree on version (${[...versions].join(', ')}); ` +
        'fix the bump before moving dist-tags',
    )
  }

  const dryRun = process.argv.includes('--dry-run')
  const otp = process.argv.find((a) => a.startsWith('--otp='))

  /*
   * Only the tags that are actually wrong get written.
   *
   * Every `npm dist-tag add` is a separate authenticated call, and on an account
   * with 2FA each one can demand a fresh one-time password -- so a run that
   * blindly writes all 30 dies part-way through when the code expires, leaving
   * half the registry on the old version. Reading the current tags first needs no
   * auth at all and usually cuts the writes to a handful, which is the difference
   * between finishing inside one code's lifetime and not.
   *
   * `--otp=` is passed through for the same reason: it lets one code cover the
   * whole run instead of npm prompting per package.
   */
  const pending = []
  for (const { name, version } of packages) {
    let current = {}
    try {
      current = JSON.parse(
        execFileSync('npm', ['view', name, 'dist-tags', '--json'], { encoding: 'utf8' }),
      )
    } catch {
      // Unpublished, or the registry is unreachable. Fall through and let the
      // write report the real error rather than guessing here.
    }
    for (const tag of TAGS) {
      if (current[tag] === version) continue
      pending.push({ name, version, tag, from: current[tag] ?? '(unset)' })
    }
  }

  if (pending.length === 0) {
    console.log(`every dist-tag already points at ${packages[0].version}`)
    return
  }

  console.log(`${pending.length} dist-tag(s) to move:`)
  for (const { name, tag, from, version } of pending) {
    console.log(`  ${name}: ${tag} ${from} -> ${version}`)
  }

  /*
   * One failure does not abandon the rest.
   *
   * On an account with 2FA, npm's browser auth grants a code good for a single
   * operation, so the second write in a run asks again -- and if that prompt
   * times out, throwing here would leave the remaining packages untouched with
   * no record of which. Each write is attempted, failures are collected, and the
   * exit code still reports them. Re-running then picks up exactly what is left,
   * because the pending list is read from the registry each time.
   */
  const failed = []
  for (const { name, version, tag } of pending) {
    const args = ['dist-tag', 'add', `${name}@${version}`, tag]
    if (otp) args.push(otp)
    if (dryRun) {
      console.log(`would run: npm ${args.join(' ')}`)
      continue
    }
    try {
      execFileSync('npm', args, { stdio: 'inherit' })
    } catch {
      failed.push(`${name} ${tag}`)
    }
  }

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${pending.length} could not be moved:\n` +
        failed.map((f) => `  ${f}`).join('\n') +
        '\n\nRe-run to retry only these. An npm automation token in\n' +
        '`//registry.npmjs.org/:_authToken` is exempt from 2FA and does the lot\n' +
        'in one pass.',
    )
    process.exitCode = 1
    return
  }
  console.log(`\nall ${pending.length} dist-tag(s) moved to ${packages[0].version}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
