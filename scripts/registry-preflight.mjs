#!/usr/bin/env node
/**
 * Every publishable package must already exist on the registry.
 *
 * Trusted publishing is per-package configuration, so npm has nowhere to record
 * one for a package it has never seen -- and an OIDC publish of an unknown
 * package is exactly the handshake npm rejects, answered with the same opaque
 * 404 it returns for a genuinely broken trust relationship. A new package
 * therefore needs one manual publish before the release workflow can ever
 * publish it.
 *
 * `@openleaf-editor/content-policy` is how that was learned: added three hours
 * after 0.1.0-beta.2 shipped, so it has no registry entry, and its trust setup
 * failed with a 404 indistinguishable from a misconfiguration.
 *
 * Twenty seconds of registry reads turns that into a message naming the package
 * and the fix. The release workflow runs this before the gate, so the failure
 * costs a minute rather than arriving half way through a publish.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { publishablePackages } from './dist-tags.mjs'

/** Package names that the registry does not know, in declaration order. */
export function missingFromRegistry(packages = publishablePackages()) {
  const missing = []
  for (const { name } of packages) {
    try {
      execFileSync('npm', ['view', name, 'version'], { stdio: 'ignore' })
    } catch {
      // A 404 and an unreachable registry look the same here. Both are worth
      // stopping a release for, so neither is special-cased.
      missing.push(name)
    }
  }
  return missing
}

function main() {
  const packages = publishablePackages()
  if (packages.length === 0) throw new Error('no publishable packages found')

  const missing = missingFromRegistry(packages)
  if (missing.length === 0) {
    console.log(`all ${packages.length} packages exist on the registry`)
    return
  }

  console.error(
    `${missing.length} of ${packages.length} package(s) have never been published, so a\n` +
      'release cannot publish them -- trusted publishing has no configuration to\n' +
      'attach to a package the registry does not know:\n' +
      missing.map((name) => `  ${name}`).join('\n') +
      '\n\nPublish each once by hand, then run scripts/trust-publishers.mjs:\n' +
      missing.map((name) => `  pnpm --filter ${name} publish --access public --tag beta`).join('\n') +
      '\n\nThat publish uses your own credentials and 2FA. It is the only publish of\n' +
      'its life that does; every release after it goes through the workflow.',
  )
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
