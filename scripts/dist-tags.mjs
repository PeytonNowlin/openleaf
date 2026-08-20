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
  for (const { name, version } of packages) {
    for (const tag of TAGS) {
      const args = ['dist-tag', 'add', `${name}@${version}`, tag]
      if (dryRun) {
        console.log(`would run: npm ${args.join(' ')}`)
        continue
      }
      execFileSync('npm', args, { stdio: 'inherit' })
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
