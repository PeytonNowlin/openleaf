/**
 * Rebuild the browser bundle before the e2e suite runs, and refuse a server
 * that is serving a different checkout.
 *
 * This lives in `globalSetup` rather than in `webServer.command` because
 * `command` only runs when Playwright *starts* a server. With
 * `reuseExistingServer` on locally, a run that found anything already listening
 * on 4173 skipped the build entirely and tested whatever bundle that server
 * happened to be serving. `globalSetup` runs unconditionally, so reuse stays
 * fast without being unsound.
 *
 * Rebuilding is not sufficient on its own. `serve.mjs` resolves its root from
 * its own location, so a reused server started from ANOTHER checkout keeps
 * serving that checkout's files however thoroughly this one is rebuilt -- and a
 * suite passing against a different working tree entirely is the first of the
 * three false greens that motivated this. So the served tree is identified
 * before anything else: a token is written into this checkout and read back
 * over HTTP. Only a server rooted here can return it.
 *
 * The check goes through the real serving path rather than asking the server to
 * describe itself, which is what makes it work against a server started from an
 * older checkout that has never heard of this check.
 *
 * Playwright starts `webServer` plugins before global setup, so the server is
 * already up by the time this runs. That ordering is harmless for the rebuild
 * too: `serve.mjs` reads each file from disk per request, and no test runs until
 * this function has returned.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FullConfig } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
/** Gitignored. Written and removed within this function. */
const STAMP = '.e2e-checkout-stamp'

function baseUrl(config: FullConfig): string {
  const configured = config.webServer?.url
  if (configured) return new URL(configured).origin
  return `http://localhost:${process.env['PORT'] ?? 4173}`
}

async function assertServesThisCheckout(config: FullConfig): Promise<void> {
  const base = baseUrl(config)
  const token = randomUUID()
  const stamp = join(ROOT, STAMP)
  writeFileSync(stamp, token)
  try {
    const response = await fetch(`${base}/${STAMP}`)
    const served = response.ok ? (await response.text()).trim() : null
    if (served === token) return
    const port = new URL(base).port || '80'
    throw new Error(
      `The server on ${base} is not serving this checkout.\n\n` +
        'Playwright reuses an existing server outside CI, and that server resolves its\n' +
        "root from its own location -- so it is serving another working tree's bundle, and\n" +
        'rebuilding this one changes nothing it returns. A suite that passes against a\n' +
        'different checkout is worse than a failing one, because it looks like success.\n\n' +
        'Stop it and let Playwright start its own:\n' +
        `  lsof -ti:${port} | xargs -r kill\n`,
    )
  } finally {
    rmSync(stamp, { force: true })
  }
}

export default async function setup(config: FullConfig): Promise<void> {
  await assertServesThisCheckout(config)
  // Inherited stdio, so a build failure is readable in the test output rather
  // than a swallowed exit code. execFileSync throws on a non-zero exit, which
  // fails the run before a single test can pass against a stale artifact.
  execFileSync(process.execPath, ['demo/build.mjs'], { cwd: ROOT, stdio: 'inherit' })
}
