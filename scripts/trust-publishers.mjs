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
import { missingFromRegistry } from './registry-preflight.mjs'

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

/** A read. Output is captured, because the script parses it. Needs no 2FA. */
const npm = (args) => execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/*
 * A write. `stdio: 'inherit'`, and that is the whole point of a second helper.
 *
 * `npm trust` runs an interactive two-factor challenge: it prints a URL, waits
 * for you to approve in the browser, and reads the terminal. Captured stdio
 * gives it nothing to print to and nothing to read from, so every write fails
 * immediately -- with the reason buried in a pipe the script then summarised
 * into an unhelpful "FAILED". Inheriting the terminal lets npm run its own
 * prompt, and lets its own error text reach you unedited when one fails.
 */
const npmWrite = (args) => execFileSync('npm', args, { stdio: 'inherit' })

/**
 * Is this package already trusting the right repository and workflow?
 *
 * A read needs no 2FA, so this pass is free in the currency that is actually
 * scarce here -- the five-minute window.
 *
 * The match is a substring search over the raw response rather than a walk of a
 * parsed shape. The first version of this parsed `trustedPublishers`/`results`
 * arrays and found neither, so every package reported MISSING and a re-run
 * rewrote all fifteen configurations instead of the one that failed. A response
 * naming this repository and this workflow file is a configured package, and
 * that is true whatever npm wraps it in.
 */
function alreadyTrusted(name) {
  let raw
  try {
    raw = npm(['trust', 'list', name, '--json'])
  } catch {
    // Unreadable: report it as not configured. Re-writing a correct
    // configuration is harmless -- a package holds one trusted publisher, so a
    // write replaces rather than duplicates -- while skipping a missing one
    // would fail the release.
    return false
  }
  const blob = raw.toLowerCase()
  return blob.includes(REPO.toLowerCase()) && blob.includes(WORKFLOW.toLowerCase())
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

  /*
   * Which packages the registry has never seen. Shared with the release
   * workflow's preflight rather than reimplemented, because the fix and the
   * explanation should not drift between the two places that report it.
   */
  const unpublishable = new Set(missingFromRegistry(packages))

  const pending = []
  const unpublished = []
  for (const { name } of packages) {
    if (alreadyTrusted(name)) {
      console.log(`  ok        ${name}`)
    } else if (unpublishable.has(name)) {
      console.log(`  BOOTSTRAP ${name}  (not on the registry yet)`)
      unpublished.push(name)
    } else {
      console.log(`  MISSING   ${name}`)
      pending.push(name)
    }
  }

  /*
   * Named before anything is written, because it is the one failure here that a
   * re-run cannot fix. npm has nowhere to record a trusted publisher for a
   * package that does not exist, and the weekly release cannot create it either
   * -- its publish carries no token, and an OIDC publish of an unknown package
   * is exactly the handshake npm rejects. One manual publish breaks the cycle.
   */
  if (unpublished.length > 0) {
    console.log(
      `\n${unpublished.length} package(s) have never been published, so they cannot be` +
        '\ntrusted yet. Publish each one once, by hand, then re-run this script:\n' +
        unpublished
          .map((name) => `  pnpm --filter ${name} publish --access public --tag beta`)
          .join('\n') +
        '\n\nThat publish uses your own credentials and 2FA. It is the only publish' +
        '\nof its life that does; every release after it goes through the workflow.',
    )
  }

  if (pending.length === 0) {
    console.log(
      unpublished.length > 0
        ? '\nEverything that can be configured already is.'
        : '\nevery package already trusts this workflow',
    )
    process.exitCode = unpublished.length > 0 ? 1 : 0
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
    console.log(`\n--- ${name} (${index + 1}/${pending.length}) ---`)
    try {
      npmWrite(['trust', 'github', name, '--repo', REPO, '--file', WORKFLOW, '--allow-publish', '--yes'])
    } catch {
      // npm has already printed why, on the inherited stderr.
      failed.push(name)
    }
  }

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${pending.length} could not be configured:\n` +
        failed.map((f) => `  ${f}`).join('\n') +
        '\n\nnpm printed the reason above each failure. Re-run to retry only\n' +
        'these -- the read pass skips whatever did succeed. If the failures are\n' +
        '2FA challenges, the five-minute skip window expired and re-running\n' +
        'opens a fresh one.',
    )
    process.exitCode = 1
    return
  }
  console.log(`\nall ${pending.length} configured. Verify with: npm trust list <package>`)
  if (unpublished.length > 0) {
    console.error(
      `\nStill outstanding: ${unpublished.length} never-published package(s), listed above.` +
        '\nThe weekly release will fail until they exist on the registry.',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
