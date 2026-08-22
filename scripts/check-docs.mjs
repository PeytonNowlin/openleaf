#!/usr/bin/env node

/**
 * Guard the small set of documents that form OpenLeaf's public integration
 * entry point. This stays deliberately narrower than a general Markdown linter:
 * it checks discoverability, local targets, published package coverage, and the
 * event contract that integrations depend on.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const failures = []

const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const guide = read('docs/integrating-openleaf.md')
const readme = read('README.md')
const api = read('docs/api-reference.md')
const llms = read('demo/llms.txt')

function requireText(text, expected, label) {
  if (!text.includes(expected)) failures.push(`${label} is missing ${JSON.stringify(expected)}`)
}

function checkLocalLinks(path, markdown) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#', 1)[0]
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue
    const absolute = resolve(ROOT, dirname(path), decodeURIComponent(target))
    if (!existsSync(absolute)) failures.push(`${path} links to missing local target ${target}`)
  }
}

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

const pluginPackages = readdirSync(join(ROOT, 'packages'))
  .filter((name) => name.startsWith('plugins-') && existsSync(join(ROOT, 'packages', name, 'package.json')))
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
  if (!existsSync(join(ROOT, target))) failures.push(`llms.txt target is missing locally: ${target}`)
  requireText(llms, `/main/${target}`, 'demo/llms.txt')
}

if (failures.length > 0) {
  console.error(`Documentation checks FAILED (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `Documentation checks passed: integration entry points, ${pluginPackages.length} plugins, ` +
    'local links, and the change-event contract.',
)
