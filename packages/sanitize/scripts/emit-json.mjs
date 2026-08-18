/**
 * Emit the policy as plain JSON.
 *
 * The whole point of this package is that a PHP or Python service can enforce
 * the same rules as the editor. Those services cannot import a TypeScript
 * module, so the policy is written out as data they can read directly, and
 * checked into the published package rather than regenerated per consumer.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_POLICY } from '../dist/policy.js'

const out = fileURLToPath(new URL('../dist/allowlist.json', import.meta.url))
writeFileSync(out, JSON.stringify(DEFAULT_POLICY, null, 2) + '\n')
console.log(`allowlist.json  ${Object.keys(DEFAULT_POLICY.elements).length} elements`)
