import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkLock, checkNobleUse, checkPackage } from './share-crypto-noble.mjs'

// Issue #301 — the one exception to "no cryptography library", on made-up
// facts. Each counter-example must fail; the real repository must pass.

const GOOD_IMPORT = "import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'\nexport const h = (b) => nobleSha256(b)\n"
const PROTECTED = "import { base64urlEncode } from './share'\nexport const seal = () => base64urlEncode(new Uint8Array(1))\n"
const SHARE = 'export const base64urlEncode = (b) => String(b.length)\n'

/** a repository that holds the exception: override any file by path */
function sources(over = {}) {
  const base = {
    'src/model/workspace.ts': GOOD_IMPORT,
    'src/model/revision.ts': "import { h } from './workspace'\nexport const d = (b) => h(b)\n",
    'src/model/shareProtected.ts': PROTECTED,
    'src/model/share.ts': SHARE,
    'src/model/other.ts': 'export const x = 1\n',
    'src/model/other.test.ts': "import { x } from './other'\nexport const y = x\n",
    'e2e/some.spec.ts': 'export const z = 1\n',
  }
  return Object.entries({ ...base, ...over }).map(([rel, text]) => ({ rel, text }))
}
const PKG = (deps = { '@noble/hashes': '2.4.0', react: '^19.0.0' }, dev = {}) => ({ dependencies: deps, devDependencies: dev })
const LOCK = (extra = {}, noble = { version: '2.4.0', license: 'MIT' }) => ({
  packages: { '': { dependencies: { '@noble/hashes': '2.4.0' } }, 'node_modules/react': { version: '19.0.0' }, 'node_modules/@noble/hashes': noble, ...extra },
})

describe('the exception holds as written', () => {
  it('package, lockfile and sources pass', () => {
    expect(checkPackage(PKG())).toEqual([])
    expect(checkLock(LOCK())).toEqual([])
    expect(checkNobleUse(sources())).toEqual([])
  })

  // the real repository is checked by `npm run check:share-crypto` itself,
  // which runs these three functions over every source, the package file and
  // the lockfile (and runs in CI's checks job); it is not repeated here
  it('the real package files pass', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    expect(checkPackage(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))).toEqual([])
    expect(checkLock(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')))).toEqual([])
  })
})

describe('package.json', () => {
  it.each([['2.4.1'], ['^2.4.0'], ['~2.4.0'], ['2.x'], ['latest']])('another version (%s) fails', (v) => {
    expect(checkPackage(PKG({ '@noble/hashes': v })).join()).toMatch(/exactly 2\.4\.0/)
  })
  it('as a devDependency it fails', () => {
    expect(checkPackage(PKG({}, { '@noble/hashes': '2.4.0' })).join()).toMatch(/only in dependencies/)
  })
  it.each([['@noble/ciphers'], ['@noble/curves'], ['tweetnacl'], ['crypto-js'], ['node-forge']])('another cryptography library (%s) still fails', (name) => {
    expect(checkPackage(PKG({ '@noble/hashes': '2.4.0', [name]: '1.0.0' })).join()).toMatch(/looks like a cryptography library/)
  })
})

describe('package-lock.json', () => {
  it('another version fails', () => {
    expect(checkLock(LOCK({}, { version: '2.4.1' })).join()).toMatch(/not 2\.4\.0/)
  })
  it('a dependency of its own fails', () => {
    expect(checkLock(LOCK({}, { version: '2.4.0', dependencies: { 'some-dep': '1.0.0' } })).join()).toMatch(/must depend on nothing/)
  })
  it('a second @noble package fails', () => {
    expect(checkLock(LOCK({ 'node_modules/@noble/curves': { version: '2.0.0' } })).join()).toMatch(/exactly one @noble package/)
  })
  it('a nested copy fails', () => {
    expect(checkLock(LOCK({ 'node_modules/x/node_modules/@noble/hashes': { version: '1.8.0' } })).join()).toMatch(/exactly one @noble package/)
  })
  it('the root asking for another version fails', () => {
    const lock = LOCK()
    lock.packages[''].dependencies['@noble/hashes'] = '^2.4.0'
    expect(checkLock(lock).join()).toMatch(/the root names/)
  })
})

describe('the one import', () => {
  it.each([["'@noble/hashes/sha3.js'"], ["'@noble/hashes/utils.js'"], ["'@noble/hashes'"], ["'@noble/hashes/sha2'"]])('another noble path (%s) fails', (p) => {
    const text = `import { sha256 } from ${p}\n`
    expect(checkNobleUse(sources({ 'src/model/workspace.ts': text })).join()).toMatch(/only `import \{ sha256 \}/)
  })
  it.each([
    ['another name as well', "import { sha256, sha512 } from '@noble/hashes/sha2.js'\n"],
    ['another name instead', "import { sha224 } from '@noble/hashes/sha2.js'\n"],
    ['a namespace import', "import * as noble from '@noble/hashes/sha2.js'\n"],
    ['a default import', "import noble from '@noble/hashes/sha2.js'\n"],
    ['a re-export', "export { sha256 } from '@noble/hashes/sha2.js'\n"],
    ['a dynamic import', "export const m = import('@noble/hashes/sha2.js')\n"],
  ])('%s fails', (_label, text) => {
    expect(checkNobleUse(sources({ 'src/model/workspace.ts': text })).length).toBeGreaterThan(0)
  })
  it('importing it twice fails', () => {
    expect(checkNobleUse(sources({ 'src/model/workspace.ts': GOOD_IMPORT + "import { sha256 as again } from '@noble/hashes/sha2.js'\n" })).join()).toMatch(/imported 2 times/)
  })
  it.each([['src/model/other.ts'], ['src/components/Thing.tsx'], ['src/model/other.test.ts'], ['e2e/some.spec.ts'], ['scripts/tool.mjs']])('an import from %s fails', (rel) => {
    expect(checkNobleUse(sources({ [rel]: "import { sha256 } from '@noble/hashes/sha2.js'\n" })).join()).toMatch(/only src\/model\/workspace\.ts may use/)
  })
})

describe('protected links stay Web Crypto only', () => {
  it('a direct noble import in the module fails', () => {
    const text = PROTECTED + "import { sha256 } from '@noble/hashes/sha2.js'\n"
    expect(checkNobleUse(sources({ 'src/model/shareProtected.ts': text })).join()).toMatch(/shareProtected\.ts.*Web Crypto only/)
  })
  it('importing the workspace hash wrapper fails', () => {
    const text = PROTECTED + "import { sha256Js } from './workspace'\nexport const k = sha256Js(new Uint8Array(1))\n"
    const out = checkNobleUse(sources({ 'src/model/shareProtected.ts': text })).join('\n')
    expect(out).toMatch(/shareProtected\.ts -> src\/model\/workspace\.ts: reaches a hash that is not Web Crypto/)
    expect(out).toMatch(/names sha256Js/)
  })
  it('reaching it through another module fails', () => {
    const share = "import { sha256Hex } from './workspace'\nexport const base64urlEncode = (b) => sha256Hex(b)\n"
    expect(checkNobleUse(sources({ 'src/model/share.ts': share })).join()).toMatch(/shareProtected\.ts -> src\/model\/share\.ts -> src\/model\/workspace\.ts/)
  })
  it('reaching the revision digests fails', () => {
    const text = PROTECTED + "import { digestOfCanonical } from './revision'\n"
    expect(checkNobleUse(sources({ 'src/model/shareProtected.ts': text })).join()).toMatch(/revision\.ts: reaches a hash/)
  })
  it('a module that does not parse is never reported as clean', () => {
    expect(checkNobleUse(sources({ 'src/model/shareProtected.ts': 'import { from \n' })).join()).toMatch(/did not parse cleanly/)
  })
})
