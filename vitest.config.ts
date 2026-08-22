import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Round-trip fidelity is a pure HTML-string transform, so jsdom is
    // legitimate here. Selection, IME, clipboard and mobile keyboard
    // behaviour are NOT tested here -- those live in Playwright, in real
    // browsers, because jsdom does not model them faithfully.
    environment: 'jsdom',
    include: ['packages/*/test/**/*.test.ts'],
    // Not because any test here is slow -- the whole docx suite runs in under
    // 200ms on a developer machine. Two guards in this suite are deliberately
    // adversarial and synchronous: `parseHtml` at extreme depth and sanitize's
    // 20000-level input each block a worker for ~30 seconds on a two-core CI
    // runner. Being synchronous they outrun their own timeout, but they starve
    // every *asynchronous* test co-scheduled beside them, and those failed at
    // exactly 5000ms having done no work at all. The default turns a busy
    // runner into a red build; this is the ceiling a genuine hang still hits.
    testTimeout: 60_000,
  },
})
