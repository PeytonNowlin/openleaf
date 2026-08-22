/**
 * The port the harness server listens on, derived from the checkout path.
 *
 * A fixed port made the e2e suite single-occupancy. Every git worktree of this
 * repo resolved to the same address, so `reuseExistingServer` found a sibling
 * checkout's server and the guard in global-setup.ts -- correctly -- aborted the
 * run. The only workaround was `lsof -ti:4173 | xargs -r kill`, which
 * interrupts whoever else was mid-run. Deriving the port from the path removes
 * the contention instead of reporting it: a server on this checkout's port can
 * only have been started from this checkout.
 *
 * This does NOT replace that guard. Two unrelated paths can still hash into the
 * same slot, and a server started from an older checkout that predates this file
 * still listens on 4173 -- so the stamp check in global-setup.ts stays the thing
 * that makes serving the wrong bundle impossible rather than merely unlikely.
 *
 * `PORT` overrides the derivation for anyone who wants a predictable address
 * (`PORT=4173 pnpm test:e2e`). The config passes the resolved value down to
 * `serve.mjs` through `webServer.env`, so the server, the `baseURL` the tests
 * use, and the URL the stamp check probes cannot disagree.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/** This checkout's repo root, the same way serve.mjs resolves its own. */
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/**
 * 4173 through 4972: the old fixed port is still in range, so a single-checkout
 * setup keeps landing somewhere unremarkable, and 800 slots is far more than the
 * handful of worktrees anyone actually keeps open.
 */
export function portForCheckout(root: string): number {
  return 4173 + (createHash('sha256').update(root).digest().readUInt16BE(0) % 800)
}

function resolvePort(): number {
  const override = process.env['PORT']
  if (override === undefined || override === '') return portForCheckout(ROOT)
  const parsed = Number(override)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${JSON.stringify(override)}`)
  }
  return parsed
}

export const PORT = resolvePort()
export const BASE_URL = `http://localhost:${PORT}`
