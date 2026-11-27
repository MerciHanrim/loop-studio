import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #625 item 2 — scripts that `import` a .ts file run only where Node strips
// TypeScript types without a flag: from 22.18.0 on the 22 line (Node's release
// notes and the history table of its TypeScript docs). Measured on 2026-11-27:
// the five such check scripts pass on 22.18.0 and fail on 22.17.1 with
// ERR_UNKNOWN_FILE_EXTENSION. So the `engines` floor must not be lower.

const ROOT = resolve(import.meta.dirname, '..')
const TYPE_STRIPPING_FROM = [22, 18, 0]
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))

/** the lowest version a `>=x.y.z` range allows */
const floorOf = (range) => {
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '')
  return m ? m.slice(1).map(Number) : null
}
const atLeast = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** scripts (not tests) that import a .ts file, statically or through a path ending in .ts */
const tsImporters = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
  .filter((f) => /from\s+['"][^'"]+\.ts['"]|import\([^)]*\.ts\b/.test(readFileSync(join(ROOT, 'scripts', f), 'utf8')))

describe('the Node floor (#625 item 2)', () => {
  it('the scripts that import .ts files are the ones measured', () => {
    expect(tsImporters.sort()).toEqual(['check-arrow-direction.mjs', 'check-i18n.mjs', 'check-icons.mjs', 'check-mobile-query.mjs', 'check-snapshot-policy.mjs'])
  })

  it('engines allows no Node that cannot run them: the floor is 22.18.0 or later', () => {
    const floor = floorOf(pkg.engines?.node)
    expect(floor, pkg.engines?.node).not.toBeNull()
    expect(atLeast(floor, TYPE_STRIPPING_FROM), `engines.node ${pkg.engines.node}`).toBeGreaterThanOrEqual(0)
  })

  it('the lock file records the same engines for the package itself', () => {
    expect(lock.packages[''].engines).toEqual(pkg.engines)
  })
})
