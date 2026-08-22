/**
 * Rebuild the browser bundle before the e2e suite runs.
 *
 * This lives in `globalSetup` rather than in `webServer.command` because
 * `command` only runs when Playwright *starts* a server. With
 * `reuseExistingServer` on locally, a run that found anything already listening
 * on 4173 skipped the build entirely and tested whatever bundle that server
 * happened to be serving -- which produced passing suites against another
 * checkout's bundle, and against pre-change bundles that made a fix look
 * verified when it was not. A stale-bundle pass is worse than a failure,
 * because it looks like success.
 *
 * `globalSetup` runs unconditionally, so reuse stays fast without being unsound.
 * Playwright starts `webServer` plugins before global setup, which is harmless:
 * `serve.mjs` reads each file from disk per request, and no test runs until this
 * function has returned.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

export default function buildBundle(): void {
  // Inherited stdio, so a build failure is readable in the test output rather
  // than a swallowed exit code. execFileSync throws on a non-zero exit, which
  // fails the run before a single test can pass against a stale artifact.
  execFileSync(process.execPath, ['demo/build.mjs'], { cwd: ROOT, stdio: 'inherit' })
}
