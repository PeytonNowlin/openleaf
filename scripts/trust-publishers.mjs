#!/usr/bin/env node
/**
 * Configure npm trusted publishing on every publishable package, so
 * `.github/workflows/release.yml` can publish with no long-lived token.
 *
 * Trusted publishing is configured per package, and OpenLeaf has fifteen of
 * them. Doing that in the npmjs.com UI is fifteen identical form fills where
 * the only field anybody gets wrong -- the workflow FILENAME, not its path --
 * is the same in all fifteen. This is that, once, from one source of truth.
 *
 * The 2FA shape of it matters, and is the reason for the ordering below. The
 * first `npm trust` call triggers a two-factor challenge, and npm's web prompt
 * offers to skip 2FA for the next five minutes; taking that offer is what lets
 * the remaining calls through unattended. A read pass runs first so that window
 * is only ever spent on packages that actually need a write, and there is a
 * deliberate pause between writes because the registry rate-limits this
 * endpoint.
 *
 * Idempotent: a package already trusting this repository and workflow is
 * skipped, so re-running after a partial failure costs nothing and fixes only
 * what is left.
 *
 * Usage:
 *   node scripts/trust-publishers.mjs --dry-run    show the plan, change nothing
 *   node scripts/trust-publishers.mjs             configure what is missing
 */

import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { publishablePackages } from './dist-tags.mjs'

/*
 * The trust relationship, in one place.
 *
 * `WORKFLOW` is the filename alone. npm validates the OIDC claim against the
 * workflow's name, and `.github/workflows/release.yml` -- the path, the obvious
 * thing to type -- silently never matches, which surfaces later as a 404 on the
 * publish and reads like a broken token rather than a mistyped field.
 *
 * `--allow-publish` and NOT `--allow-stage-publish`: staged publishing exists
 * to defer a publish for a human to approve with 2FA, which is the opposite of
 * what this pipeline is for. Granting only what the weekly run uses means a
 * stolen OIDC claim cannot stage anything either.
 */
const REPO = 'PeytonNowlin/openleaf'
const WORKFLOW = 'release.yml'

/** Milliseconds between writes. The registry rate-limits this endpoint. */
const PAUSE = 2_000

const npm = (args) => execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Is this package already trusting the right repository and workflow?
 *
 * A read needs no 2FA, so this pass is free in the currency that is actually
 * scarce here -- the five-minute window. Any unreadable or unrecognised
 * response is reported as "not configured": re-writing a correct configuration
 * is harmless (a package holds one trusted publisher, so a write replaces
 * rather than duplicates), and skipping a missing one would fail the release.
 */
function alreadyTrusted(name) {
  let parsed
  try {
    parsed = JSON.parse(npm(['trust', 'list', name, '--json']))
  } catch {
    return false
  }
  const entries = Array.isArray(parsed) ? parsed : (parsed?.trustedPublishers ?? parsed?.results ?? [])
  return entries.some((entry) => {
    const blob = JSON.stringify(entry).toLowerCase()
    return blob.includes(REPO.toLowerCase()) && blob.includes(WORKFLOW.toLowerCase())
  })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const packages = publishablePackages()
  if (packages.length === 0) throw new Error('no publishable packages found')

  /*
   * Preflight the login, because the failure mode without it is a lie: an
   * unauthenticated `npm trust list` 401s, which the read pass cannot tell from
   * "no trusted publisher configured", so every package reports MISSING and
   * every write then fails the same way fifteen times over.
   */
  let who
  try {
    who = npm(['whoami']).trim()
  } catch {
    // A stack trace is the wrong shape for "go and log in", so this one exits
    // rather than throwing.
    console.error('Not logged in to npm. Run `npm login`, then re-run this script.')
    process.exitCode = 1
    return
  }
  console.log(`npm user: ${who}`)

  console.log(`checking ${packages.length} packages against ${REPO} / ${WORKFLOW}\n`)

  const pending = []
  for (const { name } of packages) {
    const ok = alreadyTrusted(name)
    console.log(`  ${ok ? 'ok      ' : 'MISSING '} ${name}`)
    if (!ok) pending.push(name)
  }

  if (pending.length === 0) {
    console.log('\nevery package already trusts this workflow')
    return
  }

  console.log(`\n${pending.length} to configure.`)
  if (dryRun) {
    for (const name of pending) {
      console.log(`  would run: npm trust github ${name} --repo ${REPO} --file ${WORKFLOW} --allow-publish --yes`)
    }
    console.log('\n--dry-run: nothing changed')
    return
  }

  console.log(
    'The first call will ask for 2FA. On the npm web prompt, take the option to\n' +
      `skip 2FA for five minutes -- the remaining ${pending.length - 1} then go through unattended.\n`,
  )

  const failed = []
  for (const [index, name] of pending.entries()) {
    if (index > 0) await sleep(PAUSE)
    process.stdout.write(`  ${name} ... `)
    try {
      npm(['trust', 'github', name, '--repo', REPO, '--file', WORKFLOW, '--allow-publish', '--yes'])
      console.log('configured')
    } catch (error) {
      console.log('FAILED')
      failed.push(`${name}: ${String(error.stderr ?? error.message).trim().split('\n').pop()}`)
    }
  }

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${pending.length} could not be configured:\n` +
        failed.map((f) => `  ${f}`).join('\n') +
        '\n\nRe-run to retry only these. If the failures are 2FA challenges, the\n' +
        'five-minute skip window expired; re-running opens a fresh one.',
    )
    process.exitCode = 1
    return
  }
  console.log(`\nall ${pending.length} configured. Verify with: npm trust list <package>`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
