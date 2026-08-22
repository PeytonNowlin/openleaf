/**
 * Minimal static server for the browser test harness.
 *
 * Deliberately real HTTP rather than `file://` or `page.setContent()`:
 * WebKit restricts several APIs under `file://`, and setContent-based tests
 * quietly diverge from how the bundle is actually loaded by a CMS. This is
 * a script tag served over HTTP, which is the real integration.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
// Playwright passes the port it derived for this checkout (port.ts) through
// `webServer.env`, so the two cannot drift. 4173 is only the fallback for
// starting this server by hand, and a hand-started server on it will be refused
// by the stamp check of any checkout whose derived port is something else.
const PORT = Number(process.env['PORT'] ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // normalize() collapses `..` so a request cannot escape the repo root.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(ROOT, rel)
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})

server.listen(PORT, () => console.log(`harness server on http://localhost:${PORT}`))
