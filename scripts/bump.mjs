#!/usr/bin/env node
/**
 * Move every publishable package to the next version, and roll the changelog's
 * `## Unreleased` section into a dated entry for it.
 *
 * This is the one step of a release that cannot be a shell one-liner, because
 * two things have to move together or the release is wrong:
 *
 *   - All fifteen manifests. They share one version by design -- the README
 *     tells people to keep them aligned and `dist-tags.mjs` refuses to move a
 *     tag when they disagree -- so a bump applied to some and not others is not
 *     a partial release, it is a broken one.
 *   - `CHANGELOG.md`. A version published with its notes still sitting under
 *     `## Unreleased` is a version nobody can read the diff of, and the roll is
 *     exactly the step a human forgets: 0.1.0-beta.2 shipped with no `v` tag at
 *     all, which is the same class of omission one step further along.
 *
 * Internal dependency ranges are deliberately NOT touched. They are
 * `workspace:*` and `workspace:^`, and pnpm rewrites those to the concrete
 * version at publish time. Editing them here would fight that and leave the
 * working tree unable to resolve itself.
 *
 * Usage:
 *   node scripts/bump.mjs                      next prerelease (beta.N -> beta.N+1)
 *   node scripts/bump.mjs --version=0.2.0      an explicit version
 *   node scripts/bump.mjs --dry-run            print the plan, write nothing
 *   node scripts/bump.mjs --date=2026-08-24    override the changelog date (UTC today)
 *
 * Prints `version=<new>` last, and appends the same line to `$GITHUB_OUTPUT`
 * when set, so the release workflow does not have to parse anything else.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { publishablePackages } from './dist-tags.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

/**
 * The next prerelease after `current`.
 *
 * Only the `X.Y.Z-beta.N` shape is handled, and anything else is an error
 * rather than a guess. Deciding on the maintainer's behalf whether the version
 * after `0.1.0` is `0.1.1-beta.0` or `0.2.0-beta.0` is a judgement about what
 * changed, and a cron job does not get to make it -- when the line moves, the
 * release is dispatched by hand with `--version=`.
 */
export function nextPrerelease(current) {
  const match = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(current)
  if (!match) {
    throw new Error(
      `cannot infer the next version after ${current}: only X.Y.Z-beta.N is inferred. ` +
        'Pass --version=<explicit> (and expect to decide the changelog heading too).',
    )
  }
  return `${match[1]}-beta.${Number(match[2]) + 1}`
}

/** The single version every package agrees on, or an error naming the split. */
export function currentVersion(packages) {
  const versions = new Set(packages.map((p) => p.version))
  if (versions.size !== 1) {
    throw new Error(
      `packages disagree on version (${[...versions].join(', ')}); ` +
        'fix that by hand before bumping -- a bump on top of a split hides it',
    )
  }
  return [...versions][0]
}

/**
 * Replace the version in one manifest's text, without reformatting the rest.
 *
 * `JSON.parse` then `JSON.stringify` would rewrite key order, indentation and
 * the trailing newline of fifteen files on every release, burying the one line
 * that changed in noise. The match is anchored to the exact old version so a
 * manifest that has somehow already been bumped fails loudly instead of
 * silently matching some other `"version"` deeper in the file.
 */
function replaceVersion(text, from, to, label) {
  const pattern = new RegExp(`("version"\\s*:\\s*")${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`)
  const matches = text.match(new RegExp(pattern.source, 'g')) ?? []
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one "version": "${from}", found ${matches.length}`)
  }
  return text.replace(pattern, `$1${to}$2`)
}

/**
 * Turn `## Unreleased` into `## <version> - <date>` and open a fresh empty
 * `## Unreleased` above it.
 *
 * An `## Unreleased` with no entries under it is a hard error. The gate proves
 * the code works; it cannot prove anybody wrote down what changed, and a
 * release whose notes read "0.1.0-beta.4 - (nothing)" is worse than no release
 * that week. The workflow skips weeks with no commits before it ever gets here,
 * so reaching this error means commits landed and nobody documented them.
 */
export function rollChangelog(markdown, version, date) {
  const heading = '## Unreleased'
  const start = markdown.indexOf(`${heading}\n`)
  if (start === -1) throw new Error(`CHANGELOG.md has no "${heading}" heading`)

  const bodyStart = start + heading.length + 1
  const nextHeading = markdown.indexOf('\n## ', bodyStart)
  const body = markdown.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading)
  if (body.trim() === '') {
    throw new Error(
      'CHANGELOG.md "## Unreleased" is empty. Commits landed since the last release ' +
        'without an entry describing them; write one, then re-run the release.',
    )
  }

  return (
    markdown.slice(0, start) + `${heading}\n\n## ${version} - ${date}\n` + markdown.slice(bodyStart)
  )
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  const packages = publishablePackages()
  if (packages.length === 0) throw new Error('no publishable packages found')

  const from = currentVersion(packages)
  const to = argOf('version') ?? nextPrerelease(from)
  if (to === from) throw new Error(`--version=${to} is already the current version`)
  // UTC, to match the dates already in CHANGELOG.md and to keep a release that
  // runs near midnight from being dated by the runner's timezone.
  const date = argOf('date') ?? new Date().toISOString().slice(0, 10)

  console.log(`${from} -> ${to}  (${packages.length} packages, changelog dated ${date})`)

  const writes = []
  for (const { name } of packages) {
    const dir = name.replace('@openleaf-editor/', '')
    const path = join(ROOT, 'packages', dir, 'package.json')
    const text = readFileSync(path, 'utf8')
    writes.push([path, replaceVersion(text, from, to, name)])
  }

  const changelogPath = join(ROOT, 'CHANGELOG.md')
  writes.push([changelogPath, rollChangelog(readFileSync(changelogPath, 'utf8'), to, date)])

  if (dryRun) {
    console.log('--dry-run: nothing written')
  } else {
    for (const [path, text] of writes) writeFileSync(path, text)
  }

  // Last line, and the workflow's only contract with this script.
  console.log(`version=${to}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${to}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
