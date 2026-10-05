// Issue #301 — `npm run licenses:update`: rewrite licenses/third-party-manifest.json
// from three real builds (web, portable, PWA), offline. Review the diff before
// committing it: every line of it is a change in what Loop Studio ships.
// Each build writes its own section; the builds go to a scratch folder under
// node_modules/.tmp so the normal dist folders are left alone.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const scratch = path.join(ROOT, 'node_modules', '.tmp', 'third-party-notices')
const env = { ...process.env, THIRD_PARTY_NOTICES_UPDATE: '1' }
delete env.CF_PAGES_BRANCH // the plain web build must not turn into the PWA one
for (const [flavour, mode] of [['web', 'production'], ['portable', 'portable'], ['pwa', 'pwa']]) {
  const r = spawnSync(process.execPath, [vite, 'build', '--mode', mode, '--outDir', path.join(scratch, flavour), '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`\nlicenses:update - the ${flavour} build failed; the manifest may be partly updated. Fix the problem above and run it again.`)
    process.exit(r.status ?? 1)
  }
}
console.log('\nlicenses/third-party-manifest.json is up to date. Review `git diff licenses/` before committing.')
