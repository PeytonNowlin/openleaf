import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, PORT } from './packages/element/test/e2e/port.js'

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

/**
 * The one spec that needs a browser flag.
 *
 * WebMCP is a Chromium blink feature that is off by default, so the tools are
 * registered with nothing unless the browser is launched with it on. It gets
 * its own project rather than a launch argument on `chromium`, because turning
 * an experimental feature on for the whole suite changes the browser every
 * other test is asserting against.
 *
 * The three engine projects have to ignore it explicitly: the `testMatch`
 * below is repo-wide, so without that they would each pick the spec up and run
 * it in a browser that has no such API.
 */
const FLAGGED = '**/webmcp-registration.spec.ts'

export default defineConfig({
  testDir: 'packages/element/test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Traces make a failed selection bug diagnosable instead of a mystery.
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: FLAGGED },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: FLAGGED },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: FLAGGED },
    {
      name: 'chromium-webmcp',
      testMatch: FLAGGED,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--enable-blink-features=WebMCP'] },
      },
    },
  ],

  // The rebuild is HERE and not in `webServer.command`, so the tests can never
  // pass against a stale artifact -- which would make them worse than no tests
  // at all. `command` only runs when Playwright starts a server, so with
  // `reuseExistingServer` on it used to be skipped entirely by any run that
  // found something already listening on the port. See global-setup.ts.
  globalSetup: './packages/element/test/e2e/global-setup.ts',

  // The port is per checkout (see port.ts), so `reuseExistingServer` can only
  // ever find a server started from this working tree -- worktrees no longer
  // take the address away from each other. `env` hands the resolved port to
  // `serve.mjs` so it cannot fall back to its own default and listen elsewhere.
  webServer: {
    command: 'node packages/element/test/e2e/serve.mjs',
    url: `${BASE_URL}/packages/element/test/e2e/harness.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
  },
})
