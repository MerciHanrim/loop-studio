import { describe, expect, it } from 'vitest'
import { arrowCatalogViolations, requiredArrowGlyph, type ArrowCatalogInput, type LocaleFacts } from './arrowContract'

// docs/localization.md §L9.3 — the arrow catalogue contract, tested against a locale
// that does not exist yet.
//
// THIS IS THE POINT OF THE FILE. No non-pseudo RTL catalogue is registered: the
// Arabic one is PR C, and `ar-XB` is a pseudo locale shipping `en` verbatim. So every
// locale the checker can reach today is one that CANNOT fail the mirrored-glyph rule,
// and a green run over them says nothing about whether registering `ar` will arm it.
//
// The rule is therefore a pure function, called here with a locale that looks like
// the real `ar`. If registering it would not demand the mirrored character, these
// tests fail now rather than the day the catalogue lands.

const UNITS = {
  'menu-path': { verdict: 'mirror' as const, ltr: '→', rtl: '←' },
  'graph-relation': { verdict: 'keep' as const, ltr: '→', rtl: '→' },
}

const INPUT: ArrowCatalogInput = {
  units: UNITS,
  catalog: [
    { unit: 'menu-path', keys: ['share.tooLarge'] },
    { unit: 'graph-relation', keys: ['regExpr.row.cycle'] },
  ],
  conditional: [{ unit: 'menu-path', key: 'import.qs.sources.excel' }],
}

const AR: LocaleFacts = { code: 'ar', direction: 'rtl', pseudo: false }
const AR_XB: LocaleFacts = { code: 'ar-XB', direction: 'rtl', pseudo: true }
const EN: LocaleFacts = { code: 'en', direction: 'ltr', pseudo: false }

describe('requiredArrowGlyph', () => {
  it('a mirroring unit takes the mirrored character for a real RTL reader', () => {
    expect(requiredArrowGlyph(UNITS['menu-path'], AR)).toBe('←')
    expect(requiredArrowGlyph(UNITS['menu-path'], EN)).toBe('→')
  })

  it('a KEEPING unit takes the same character for everyone', () => {
    // the case a translator is most likely to "fix": this arrow names the edge the
    // canvas draws, and the canvas does not mirror
    expect(requiredArrowGlyph(UNITS['graph-relation'], AR)).toBe('→')
    expect(requiredArrowGlyph(UNITS['graph-relation'], EN)).toBe('→')
  })

  it('a pseudo RTL locale takes the LTR character, because its catalogue is en verbatim', () => {
    expect(requiredArrowGlyph(UNITS['menu-path'], AR_XB)).toBe('→')
  })
})

describe('registering a real RTL locale ARMS the contract', () => {
  const english = {
    'share.tooLarge': 'Use File → Export instead',
    'regExpr.row.cycle': '— cycle: {name} → … → {name}',
  }

  it('the English catalogue passes as an LTR locale and FAILS as a real RTL one', () => {
    expect(arrowCatalogViolations(EN, english, INPUT).violations).toEqual([])

    // the same bytes, read as `ar`: the mirroring key is now wrong
    const asArabic = arrowCatalogViolations(AR, english, INPUT)
    expect(asArabic.violations.map((v) => v.key)).toEqual(['share.tooLarge'])
    expect(asArabic.violations[0].want).toBe('←')
  })

  it('a correctly mirrored Arabic catalogue passes', () => {
    const arabic = {
      'share.tooLarge': 'استخدم ملف ← تصدير بدلاً من ذلك',
      'regExpr.row.cycle': '— دورة: {name} → … → {name}',
    }
    expect(arrowCatalogViolations(AR, arabic, INPUT).violations).toEqual([])
  })

  it('mirroring the KEEPING unit is a violation, not a courtesy', () => {
    const overEager = {
      'share.tooLarge': 'ملف ← تصدير',
      'regExpr.row.cycle': '— دورة: {name} ← … ← {name}',
    }
    const r = arrowCatalogViolations(AR, overEager, INPUT)
    expect(r.violations.map((v) => v.unit)).toEqual(['graph-relation'])
    expect(r.violations[0].want).toBe('→')
  })

  it('a mirroring key that carries BOTH characters is still a violation', () => {
    const half = { 'share.tooLarge': 'ملف ← تصدير → ', 'regExpr.row.cycle': '{name} → {name}' }
    expect(arrowCatalogViolations(AR, half, INPUT).violations.map((v) => v.key)).toEqual(['share.tooLarge'])
  })

  it('the same catalogue under the PSEUDO rtl locale passes untouched', () => {
    // ar-XB ships en verbatim on purpose; holding it to an Arabic rule would fail a
    // locale for being exactly what it was built to be
    expect(arrowCatalogViolations(AR_XB, english, INPUT).violations).toEqual([])
  })
})

describe('the conditional key', () => {
  it('is ignored when the translation uses no arrow at all', () => {
    const cat = { ...{ 'share.tooLarge': 'ملف ←', 'regExpr.row.cycle': '{name} → {name}' }, 'import.qs.sources.excel': 'إكسل' }
    const r = arrowCatalogViolations(AR, cat, INPUT)
    expect(r.violations).toEqual([])
  })

  it('applies its unit rule as soon as the translation DOES use one', () => {
    const cat = {
      'share.tooLarge': 'ملف ←',
      'regExpr.row.cycle': '{name} → {name}',
      'import.qs.sources.excel': 'حفظ باسم → CSV',
    }
    const r = arrowCatalogViolations(AR, cat, INPUT)
    expect(r.violations.map((v) => v.key)).toEqual(['import.qs.sources.excel'])
    expect(r.violations[0].want).toBe('←')
  })
})

describe('a key the contract names and the catalogue lacks', () => {
  it('is reported as missing rather than passing silently', () => {
    const r = arrowCatalogViolations(EN, { 'share.tooLarge': 'File → Export' }, INPUT)
    expect(r.missing.map((m) => m.key)).toEqual(['regExpr.row.cycle'])
  })
})
