/**
 * Static server for the promo capture.
 *
 * Serves the repo root (so the demo bundles and brand assets load from the real
 * built artifacts) plus this promo directory under /promo. Kept out of the repo
 * so recording a video never adds files to the project tree.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMO = fileURLToPath(new URL('.', import.meta.url))
const REPO = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT ?? 4890)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const root = rel.startsWith('/promo') ? PROMO : REPO
    const file = join(root, rel.startsWith('/promo') ? rel.slice('/promo'.length) : rel)
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, () => console.log(`promo server on http://localhost:${PORT}`))
