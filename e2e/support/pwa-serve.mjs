// PWA E2E backend (playwright.pwa.config.ts webServer).
//
// Builds THREE independent `--mode pwa` generations up front —
//   dist-pwa-a  (stamp pwagenA)   dist-pwa-b (pwagenB)   dist-pwa-c (pwagenC)
// — then serves whichever one a test has selected, so the update tests never
// rebuild mid-run and are safe under retries / parallelism.
//
//   GET  /__gen           → the current generation letter
//   POST /__gen?to=a|b|c  → switch; subsequent requests serve that generation
//
// Every response is `cache-control: no-store` — the browser HTTP cache must
// never stand in for the service worker's cache (so a generation switch is
// seen immediately on `registration.update()`).

import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const PORT = 4174
const ORIGIN = `http://localhost:${PORT}`
const GENS = { a: 'dist-pwa-a', b: 'dist-pwa-b', c: 'dist-pwa-c' }
const STAMP = { a: 'pwagenA', b: 'pwagenB', c: 'pwagenC' }

for (const [g, dir] of Object.entries(GENS)) {
  console.log(`building ${dir} (stamp ${STAMP[g]}) …`)
  execSync(`npx vite build --mode pwa --outDir ${dir} --emptyOutDir`, {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, GITHUB_SHA: STAMP[g], PWA_TEST_ORIGIN: ORIGIN },
  })
}

let current = 'a'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN)

  if (url.pathname === '/__gen') {
    if (req.method === 'POST') {
      const to = url.searchParams.get('to')
      if (!GENS[to]) {
        res.writeHead(400).end('bad gen')
        return
      }
      current = to
      res.writeHead(200, { 'cache-control': 'no-store' }).end(current)
      return
    }
    res.writeHead(200, { 'cache-control': 'no-store' }).end(current)
    return
  }

  const dir = resolve(ROOT, GENS[current])
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html'
  let file = join(dir, rel)
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file')
  } catch {
    file = join(dir, 'index.html') // SPA / navigateFallback
  }
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(body)
})

// bind on all interfaces so BOTH http://localhost:4174 (the allowed test origin)
// and http://127.0.0.1:4174 (a NON-allowed origin, for the registration-gate
// test) reach the same content.
server.listen(PORT, () => console.log(`pwa-serve on ${ORIGIN} (and 127.0.0.1) — gen ${current}`))
