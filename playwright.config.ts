import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests for <openleaf-editor>.
 *
 * These run in real browsers because the things that break editors do not
 * exist in jsdom: selection, focus, composition events, clipboard, and the
 * differences between Chromium's, Gecko's and WebKit's contenteditable
 * behaviour. A green jsdom suite tells you almost nothing about whether an
 * editor works.
 *
 * All three engines run by default. WebKit is not optional -- it is Safari
 * and every iOS browser, and it is historically where selection bugs live.
 */
export default defineConfig({
  testDir: 'packages/element/test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    // Traces make a failed selection bug diagnosable instead of a mystery.
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    // Rebuild the bundle first, so the tests can never pass against a stale
    // artifact -- which would make them worse than no tests at all.
    command: 'node demo/build.mjs && node packages/element/test/e2e/serve.mjs',
    url: 'http://localhost:4173/packages/element/test/e2e/harness.html',
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
  },
})
