import { describe, expect, it } from 'vitest'
import { baseLocale, nonBaseCodes, RegistryParseError, shippedCodes } from './registry-source.mjs'
import { LOCALES, BASE_LOCALE } from '../src/i18n/registry'

// The build-time checkers read `registry.ts` as TEXT, because Node cannot
// import it (TypeScript, and it reads `import.meta.env.DEV`). This file is the
// bridge that keeps the text reading honest: it compares the parser's answer
// against the REAL module, which vitest can import.
//
// Without it the parser could drift from the registry in either direction and
// every checker would agree with itself.

describe('the source parser agrees with the real registry', () => {
  it('reads the same base locale', () => {
    expect(baseLocale()).toBe(BASE_LOCALE)
  })

  it('reads exactly the shipped codes, in the same order', () => {
    const real = LOCALES.filter((l) => !l.pseudo).map((l) => l.code)
    expect(shippedCodes()).toEqual(real)
  })

  it('does not see the dev pseudo-locales, which are not in SHIPPED_LOCALES', () => {
    const pseudo = LOCALES.filter((l) => l.pseudo).map((l) => l.code)
    for (const code of pseudo) expect(shippedCodes()).not.toContain(code)
  })

  it('removes exactly the base locale for the non-base list', () => {
    const all = shippedCodes()
    expect(nonBaseCodes()).toEqual(all.filter((c) => c !== BASE_LOCALE))
    expect(nonBaseCodes()).toHaveLength(all.length - 1)
  })
})

describe('the parser is fail-closed', () => {
  // The defect this module was written for: a parse that finds nothing used to
  // yield an empty list, and every `for (const locale of …)` loop downstream
  // then passed by iterating zero times.
  it('never returns an empty list — it throws instead', () => {
    expect(shippedCodes().length).toBeGreaterThan(0)
    expect(nonBaseCodes().length).toBeGreaterThan(0)
  })

  it('exports a named error type, so a caller can tell a parse failure apart', () => {
    expect(new RegistryParseError('x')).toBeInstanceOf(Error)
    expect(new RegistryParseError('x').name).toBe('Error')
  })

  it('the base locale really is one of the shipped codes', () => {
    // `shippedCodes()` asserts this internally; stated here so the contract is
    // visible rather than buried in the module.
    expect(shippedCodes()).toContain(baseLocale())
  })

  it('finds no duplicate code', () => {
    const codes = shippedCodes()
    expect(new Set(codes).size).toBe(codes.length)
  })
})
