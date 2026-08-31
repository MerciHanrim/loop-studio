import { describe, expect, it } from 'vitest'
import enCatalog from './locales/en'
import { validateCatalog, type CatalogLike } from './validate'

// docs/localization.md §L12 #1 + #8 — the pure catalog validator, and the
// "add a locale" smoke: a partial / broken `xx` catalog must fail loudly on
// EXACTLY its gaps, and nothing else.

const base: CatalogLike = { ...enCatalog }

const good: CatalogLike = Object.fromEntries(
  Object.entries(base).map(([k, v]) => [k, /\{/.test(v) ? v : `[${k}]`]),
)

describe('validateCatalog', () => {
  it('a shape-complete catalog has no problems', () => {
    expect(validateCatalog(base, 'xx', good)).toEqual([])
    expect(validateCatalog(base, 'en', base)).toEqual([]) // the real en catalog
  })

  it('flags a missing key', () => {
    const c = { ...good }
    delete c['toolbar.new']
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('missing key "toolbar.new"'))).toBe(true)
  })

  it('flags an extra key', () => {
    const c = { ...good, 'toolbar.bogus': 'x' }
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('extra key "toolbar.bogus"'))).toBe(true)
  })

  it('flags an empty translation', () => {
    const c = { ...good, 'toolbar.new': '' }
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('empty'))).toBe(true)
  })

  it('flags an ICU parse error', () => {
    const c = { ...good, 'playbar.step': 'step {n' }
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('parse error'))).toBe(true)
  })

  it('flags a plural block with no "other" arm (parser rejects it, or the explicit check does)', () => {
    const b2: CatalogLike = { m: '{n, plural, one {#} other {#}}' }
    const c2: CatalogLike = { m: '{n, plural, one {#}}' }
    const problems = validateCatalog(b2, 'xx', c2)
    expect(
      problems.some((p) => p.includes('has no "other" arm') || p.includes('parse error')),
    ).toBe(true)
  })

  it('flags an argument-name mismatch vs base', () => {
    const c = { ...good, 'playbar.step': 'step {count}' } // base is {n}
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('argument names'))).toBe(true)
  })

  it('flags an argument-KIND mismatch vs base (slot vs plural)', () => {
    const c = { ...good, 'playbar.step': '{n, plural, other {#단계}}' } // base {n} is a slot
    const problems = validateCatalog(base, 'xx', c)
    expect(problems.some((p) => p.includes('argument "n" is plural') && p.includes('slot'))).toBe(true)
  })

  it('flags rich-text tag syntax', () => {
    const c = { ...good, 'toolbar.new': 'New <b>graph</b>' }
    expect(validateCatalog(base, 'xx', c).some((p) => p.includes('rich-text tag'))).toBe(true)
  })
})
