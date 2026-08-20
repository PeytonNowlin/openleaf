#!/usr/bin/env node

/** Published browser-facing entry points must still be importable during SSR. */
const packages = ['element', 'react', 'vue']

for (const name of packages) {
  try {
    await import(`../packages/${name}/dist/index.js`)
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new Error(`SSR import failed for @openleaf-editor/${name}: ${message}`, { cause: error })
  }
}

console.log(`SSR imports passed: ${packages.join(', ')}`)
