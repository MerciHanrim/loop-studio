import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sliceKeys } from './catalog-source.mjs'
import en from '../src/i18n/locales/en'
import enUi from '../src/i18n/locales/en/ui'
import enCanvas from '../src/i18n/locales/en/canvas'
import enInspector from '../src/i18n/locales/en/inspector'
import enTemplates from '../src/i18n/locales/en/templates'
import enDataImport from '../src/i18n/locales/en/dataImport'

// `check-i18n.mjs` reads each catalog slice as TEXT to answer one question the
// merged object cannot: is a key declared in more than one domain file? This is
// the bridge that keeps that text reading honest — it compares the parser's
// answer against the REAL modules, which vitest can import.
//
// It exists because the previous reader was a regex, `/^\s*'([a-zA-Z][\w.]*)'\s*:/gm`,
// and `\w` excludes `-`. MEASURED: 806 of 852 base keys matched and 46 did not
// — every `import.issue.*`, `import.parseErrorKind.*`, `import.commitError.*`
// and `import.refreshIssue.*` code. Those 46 sat outside the duplication guard
// while it printed "no cross-file duplication", so the sentence was true of a
// subset and stated of the whole.

const SLICES = {
  ui: enUi,
  canvas: enCanvas,
  inspector: enInspector,
  templates: enTemplates,
  dataImport: enDataImport,
} as const

const dir = resolve(import.meta.dirname, '../src/i18n/locales/en')

describe('sliceKeys reads the real slices exactly', () => {
  for (const [name, mod] of Object.entries(SLICES)) {
    it(`${name}: the parsed key list equals the imported module's own keys`, () => {
      const parsed = sliceKeys(join(dir, `${name}.ts`))
      expect(parsed).toEqual(Object.keys(mod))
    })
  }

  it('the five slices together are the whole base catalog, with nothing declared twice', () => {
    const all = Object.keys(SLICES).flatMap((n) => sliceKeys(join(dir, `${n}.ts`)))
    expect(new Set(all).size, 'a key declared in two slices').toBe(all.length)
    expect(all.slice().sort()).toEqual(Object.keys(en).sort())
  })

  it('sees the hyphenated keys the old regex could not', () => {
    // the specific regression: `\w` has no `-`
    const all = Object.keys(SLICES).flatMap((n) => sliceKeys(join(dir, `${n}.ts`)))
    const hyphenated = all.filter((k) => k.includes('-'))
    expect(hyphenated.length, 'the base catalog should still contain hyphenated keys').toBeGreaterThan(0)
    expect(hyphenated).toContain('import.issue.empty-key')
    // and they are part of the same set the catalog exposes
    for (const k of hyphenated) expect(en).toHaveProperty([k])
  })
})

describe('it fails CLOSED — every malformed slice throws rather than returning fewer keys', () => {
  let tmp: string
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'slice-'))
  })
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  const write = (name: string, text: string): string => {
    const p = join(tmp, name)
    writeFileSync(p, text, 'utf8')
    return p
  }

  it('accepts a well-formed slice, INCLUDING a hyphenated key', () => {
    const p = write('good.ts', "const ui = { 'a.b': 'x', 'a-b': 'y' } as const\nexport default ui\n")
    expect(sliceKeys(p)).toEqual(['a.b', 'a-b'])
  })

  // `createSourceFile` RECOVERS from a syntax error instead of throwing, so
  // without an explicit `parseDiagnostics` check these would return a partial
  // key list and read as success.
  it('refuses a slice that does not parse', () => {
    const p = write('unbalanced.ts', "const ui = {{ 'a': 'x' } as const\nexport default ui\n")
    expect(() => sliceKeys(p)).toThrow(/does not parse/)
  })

  it('refuses a slice with a stray token', () => {
    const p = write('stray.ts', "const ui = { 'a': 'x', ] } as const\nexport default ui\n")
    expect(() => sliceKeys(p)).toThrow(/does not parse/)
  })

  it('refuses a slice that declares zero keys', () => {
    const p = write('empty-obj.ts', 'const ui = {} as const\nexport default ui\n')
    expect(() => sliceKeys(p)).toThrow(/zero keys/)
  })

  it('refuses an empty file', () => {
    const p = write('empty.ts', '')
    expect(() => sliceKeys(p)).toThrow(/empty/)
  })

  it('refuses a slice with no default export', () => {
    const p = write('noexport.ts', "const ui = { 'a': 'x' } as const\nexport const other = ui\n")
    expect(() => sliceKeys(p)).toThrow(/no `export default`/)
  })

  it('refuses a default export that is a call, not an object', () => {
    const p = write('call.ts', 'const f = () => ({})\nexport default f()\n')
    expect(() => sliceKeys(p)).toThrow(/not an object literal/)
  })

  it('refuses a default export naming something that is not an object literal', () => {
    const p = write('nonobj.ts', "const s = 'text'\nexport default s\n")
    expect(() => sliceKeys(p)).toThrow(/does not resolve to an object literal/)
  })

  it('refuses a spread, which would hide keys from a source reader', () => {
    const p = write('spread.ts', "const base = { 'a': 'x' }\nconst ui = { ...base, 'b': 'y' } as const\nexport default ui\n")
    expect(() => sliceKeys(p)).toThrow(/spread/)
  })

  it('refuses a file that cannot be read at all', () => {
    expect(() => sliceKeys(join(tmp, 'does-not-exist.ts'))).toThrow(/cannot be read/)
  })
})
