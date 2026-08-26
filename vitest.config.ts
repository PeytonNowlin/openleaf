import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Round-trip fidelity is a pure HTML-string transform, so jsdom is
    // legitimate here. Selection, IME, clipboard and mobile keyboard
    // behaviour are NOT tested here -- those live in Playwright, in real
    // browsers, because jsdom does not model them faithfully.
    environment: 'jsdom',
    include: [
      'packages/*/test/**/*.test.ts',
      // Docs-gate predicates live in scripts/*.mjs; the tests that pin them
      // sit next to those files rather than inside a package.
      'scripts/**/*.test.ts',
    ],
  },
})
