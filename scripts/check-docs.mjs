#!/usr/bin/env node

/**
 * Guard the small set of documents that form OpenLeaf's public integration
 * entry point. This stays deliberately narrower than a general Markdown linter:
 * it checks discoverability, local targets, published package coverage, the
 * event contract that integrations depend on, and the measured size figures
 * that otherwise drift in prose.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  BUDGETS_KB,
  sizeClaimToleranceKb,
  measureBundleSizes,
} from './bundle-budgets.mjs'

const failures = []

// Resolved only when the gate runs. Vitest rewrites `import.meta.url` when it
// transforms this file, and `fileURLToPath` then throws "URL must be of scheme
// file" — which is why the claimMatches tests would not even load if this
// ran at module evaluation. Direct `node scripts/check-docs.mjs` is untransformed
// and the URL is a file: URL, as before.
const root = () => fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root(), path), 'utf8')

function requireText(text, expected, label) {
  if (!text.includes(expected)) failures.push(`${label} is missing ${JSON.stringify(expected)}`)
}

function checkLocalLinks(path, markdown) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#', 1)[0]
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue
    const absolute = resolve(root(), dirname(path), decodeURIComponent(target))
    if (!existsSync(absolute)) failures.push(`${path} links to missing local target ${target}`)
  }
}

/**
 * Whether a documented claim describes this measurement.
 *
 * Whole-number claims used to take a different path — `Math.round(measured)
 * === claimed` — and never consulted the tolerance. That is how a badge of
 * `123 KB` passed on a Node 26 workstation at 123.25 KB and failed on CI's
 * Node 22 at 123.6 KB, with no number both machines would accept. The
 * `integer` flag still shapes the *suggestion* in `expectedClaim`; the match
 * itself is the same 1% (floored at 0.1 KB) either way.
 */
export function claimMatches(claimed, measuredKb, integer) {
  // `integer` is the caller's spelling of the claim, not a different rule.
  // expectedClaim still uses it to prefer a whole-number suggestion.
  return Math.abs(claimed - measuredKb) <= sizeClaimToleranceKb(measuredKb)
}

/**
 * The number to put in the failure message, chosen so that writing it would
 * actually pass `claimMatches` on this measurement. Suggesting
 * `Math.round(measured)` unconditionally is how CI told people to write
 * `124 KB` for a 123.6 KB core — a number that then failed on the workstation
 * that still rounded to 123. A nearest whole that itself sits outside the
 * tolerance (a 5.6 KB bundle rounding to 6, past the 0.1 KB floor) falls
 * back to the one-decimal spelling, which is always within 0.05.
 */
export function expectedClaim(measuredKb, integer) {
  if (integer) {
    const nearest = Math.round(measuredKb)
    if (claimMatches(nearest, measuredKb, true)) {
      return `${nearest} KB (nearest whole)`
    }
  }
  return `${measuredKb.toFixed(1)} KB gzipped`
}

function checkMeasuredNumbers() {
  const needBuild = Object.keys(BUDGETS_KB).some((file) => !existsSync(join(root(), 'demo', file)))
  const rows = measureBundleSizes({ build: needBuild })
  const byFile = new Map(rows.map((row) => [row.file, row]))
  const byKey = new Map(rows.map((row) => [claimKey(row), row]))

  checkBudgetTable(read('docs/authoring-plugins.md'), byFile)
  checkDemoSizeClaims(read('demo/index.html'), byKey)
}

function claimKey(row) {
  return row.label.startsWith('-') ? row.label.slice(1) : row.label
}

function checkBudgetTable(markdown, byFile) {
  const block = markdown.match(/Gzipped, measured against budget:\n\n```\n([\s\S]*?)\n```/)
  if (!block) {
    failures.push('docs/authoring-plugins.md is missing the gzipped budget table in §4.5')
    return
  }

  const seen = new Set()
  for (const line of block[1].split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^(openleaf(?:-[a-z0-9]+)*\.min\.js)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*$/)
    if (!match) {
      failures.push(`docs/authoring-plugins.md budget table has an unreadable row: ${JSON.stringify(line)}`)
      continue
    }
    const [, file, claimedMeasured, claimedBudget] = match
    seen.add(file)
    const row = byFile.get(file)
    if (!row) {
      failures.push(`docs/authoring-plugins.md budget table lists unknown bundle ${file}`)
      continue
    }
    if (Number(claimedBudget) !== row.budget) {
      failures.push(
        `${file} budget in docs/authoring-plugins.md is ${claimedBudget}; BUDGETS_KB is ${row.budget}`,
      )
    }
    const claimed = Number(claimedMeasured)
    if (!claimMatches(claimed, row.kb, !claimedMeasured.includes('.'))) {
      failures.push(
        `${file} in docs/authoring-plugins.md claims ${claimedMeasured} KB; measured ${row.kb.toFixed(1)} KB gzipped`,
      )
    }
  }

  for (const file of Object.keys(BUDGETS_KB)) {
    if (!seen.has(file)) failures.push(`docs/authoring-plugins.md budget table is missing ${file}`)
  }
}

function checkDemoSizeClaims(html, byKey) {
  const requiredKeys = ['core', 'tables', 'colour', 'insert', 'highlight', 'import', 'import-docx']
  const seen = new Set()
  const open = /<([a-zA-Z0-9]+)([^>]*\sdata-openleaf-size=["']([a-z0-9-]+)["'][^>]*)>/g
  let match
  while ((match = open.exec(html))) {
    const tag = match[1]
    const key = match[3]
    const innerStart = match.index + match[0].length
    const close = html.indexOf(`</${tag}>`, innerStart)
    if (close < 0) {
      failures.push(`demo/index.html data-openleaf-size="${key}" is missing a closing </${tag}>`)
      continue
    }
    const inner = html.slice(innerStart, close)
    const number = inner.match(/(\d+(?:\.\d+)?)\s*KB/)
    if (!number) {
      failures.push(`demo/index.html data-openleaf-size="${key}" has no "N KB" claim to check`)
      continue
    }
    seen.add(key)
    const row = byKey.get(key)
    if (!row) {
      failures.push(
        `demo/index.html data-openleaf-size="${key}" is not a budgeted bundle (expected ${[...byKey.keys()].join(', ')})`,
      )
      continue
    }
    const claimed = Number(number[1])
    const integer = !number[1].includes('.')
    if (!claimMatches(claimed, row.kb, integer)) {
      failures.push(
        `demo/index.html data-openleaf-size="${key}" claims ${number[0]}; measured ${row.kb.toFixed(1)} KB gzipped. Use ${expectedClaim(row.kb, integer)}`,
      )
    }
  }

  for (const key of requiredKeys) {
    if (!seen.has(key)) {
      failures.push(
        `demo/index.html is missing data-openleaf-size="${key}" so the checker cannot tell which number is which`,
      )
    }
  }
}

/**
 * Size figures in authoring-plugins.md and demo/index.html used to be prose.
 * The budgets gate already weighed every file; nothing asked whether the
 * written number was that weight. A 100-byte wobble is not a failure — a
 * claim that no longer describes the measurement is.
 */
function run() {
  const guide = read('docs/integrating-openleaf.md')
  const readme = read('README.md')
  const api = read('docs/api-reference.md')
  const llms = read('demo/llms.txt')

  checkLocalLinks('README.md', readme)
  checkLocalLinks('docs/integrating-openleaf.md', guide)

  requireText(readme, 'docs/integrating-openleaf.md', 'README.md')
  requireText(
    llms,
    'https://raw.githubusercontent.com/PeytonNowlin/openleaf/main/docs/integrating-openleaf.md',
    'demo/llms.txt',
  )
  requireText(api, '| `openleaf:change` | `{ value: string }`', 'docs/api-reference.md')
  requireText(api, '`openleaf:change` is composed', 'docs/api-reference.md')
  requireText(api, 'textarea is marked dirty and written within a short', 'docs/api-reference.md')

  const pluginPackages = readdirSync(join(root(), 'packages'))
    .filter((name) => name.startsWith('plugins-') && existsSync(join(root(), 'packages', name, 'package.json')))
    .map((name) => `@openleaf-editor/${name}`)
  for (const packageName of pluginPackages) {
    requireText(guide, packageName, 'docs/integrating-openleaf.md')
  }

  const requiredLlmsTargets = [
    'README.md',
    'SECURITY.md',
    'docs/api-reference.md',
    'packages/react/README.md',
    'packages/vue/README.md',
    'packages/angular/README.md',
  ]
  for (const target of requiredLlmsTargets) {
    if (!existsSync(join(root(), target))) failures.push(`llms.txt target is missing locally: ${target}`)
    requireText(llms, `/main/${target}`, 'demo/llms.txt')
  }

  checkMeasuredNumbers()

  if (failures.length > 0) {
    console.error(`Documentation checks FAILED (${failures.length}):`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log(
    `Documentation checks passed: integration entry points, ${pluginPackages.length} plugins, ` +
      'local links, the change-event contract, and measured size claims.',
  )
}

// Compared as URLs because a raw `file://${argv[1]}` never matches a path with
// a space in it, which is how this silently did nothing the first time. The
// guard is also why the tests can import `claimMatches` without running the
// whole docs gate (and without paying for a bundle build).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
}
