import { describe, expect, it } from 'vitest'
import {
  arrowCatalogViolations,
  arrowCensus,
  requiredArrowGlyph,
  type ArrowCatalogInput,
  type LocaleFacts,
} from './arrowContract'

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
    // `{name} → … → {name}` — the SAME unit twice in one value, which is the case
    // presence-checking could not see
    { unit: 'graph-relation', keys: ['regExpr.row.cycle'], occurrences: { 'regExpr.row.cycle': 2 } },
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
    // ONE defect, several reasons: the count is wrong AND the value carries the
    // arrow pointing the other way. The distinct key is the contract.
    expect([...new Set(asArabic.violations.map((v) => v.key))]).toEqual(['share.tooLarge'])
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
    expect([...new Set(r.violations.map((v) => v.unit))]).toEqual(['graph-relation'])
    expect(r.violations[0].want).toBe('→')
  })

  it('a mirroring key that carries BOTH characters is still a violation', () => {
    const half = { 'share.tooLarge': 'ملف ← تصدير → ', 'regExpr.row.cycle': '{name} → … → {name}' }
    expect([...new Set(arrowCatalogViolations(AR, half, INPUT).violations.map((v) => v.key))]).toEqual([
      'share.tooLarge',
    ])
  })

  it('the same catalogue under the PSEUDO rtl locale passes untouched', () => {
    // ar-XB ships en verbatim on purpose; holding it to an Arabic rule would fail a
    // locale for being exactly what it was built to be
    expect(arrowCatalogViolations(AR_XB, english, INPUT).violations).toEqual([])
  })
})

describe('the conditional key', () => {
  it('is ignored when the translation uses no arrow at all', () => {
    const cat = { ...{ 'share.tooLarge': 'ملف ←', 'regExpr.row.cycle': '{name} → … → {name}' }, 'import.qs.sources.excel': 'إكسل' }
    const r = arrowCatalogViolations(AR, cat, INPUT)
    expect(r.violations).toEqual([])
  })

  it('applies its unit rule as soon as the translation DOES use one', () => {
    const cat = {
      'share.tooLarge': 'ملف ←',
      'regExpr.row.cycle': '{name} → … → {name}',
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

// ── the OCCURRENCE axis ─────────────────────────────────────────────────────
//
// Presence was the rule until C3.5 and it could not see any of these. MEASURED
// against the real tree first: flipping only the SECOND `→` of the cycle row to
// `←` left `check-arrow-direction` green.

describe('every glyph occurrence, not just the first', () => {
  const ok = {
    'share.tooLarge': 'ملف ← تصدير',
    'regExpr.row.cycle': '— دورة: {name} → … → {name}',
  }

  it('the baseline passes, so each case below differs by one glyph', () => {
    expect(arrowCatalogViolations(AR, ok, INPUT).violations).toEqual([])
    expect(arrowCatalogViolations(AR, ok, INPUT).occurrences).toBe(3)
  })

  it('flipping only the SECOND glyph of a KEEP unit is a violation', () => {
    const bad = { ...ok, 'regExpr.row.cycle': '— دورة: {name} → … ← {name}' }
    const r = arrowCatalogViolations(AR, bad, INPUT)
    expect(r.violations.map((v) => v.key)).toContain('regExpr.row.cycle')
    expect(r.violations.some((v) => v.reason.includes('expected 2'))).toBe(true)
    expect(r.violations.some((v) => v.reason.includes('the other way'))).toBe(true)
  })

  it('REMOVING one of the two is a violation', () => {
    const bad = { ...ok, 'regExpr.row.cycle': '— دورة: {name} → {name}' }
    const r = arrowCatalogViolations(AR, bad, INPUT)
    expect(r.violations.some((v) => v.reason.includes('expected 2 `→`, found 1'))).toBe(true)
  })

  it('ADDING a third is a violation', () => {
    const bad = { ...ok, 'regExpr.row.cycle': '— دورة: {name} → … → … → {name}' }
    const r = arrowCatalogViolations(AR, bad, INPUT)
    expect(r.violations.some((v) => v.reason.includes('expected 2 `→`, found 3'))).toBe(true)
  })

  it('an arrow of a unit that does NOT govern the key is a violation too', () => {
    // `▸` belongs to submenu-disclosure, which governs nothing here — an arrow
    // nobody ruled on, inside a value the contract already covers
    const bad = { ...ok, 'share.tooLarge': 'ملف ← تصدير ▸' }
    const r = arrowCatalogViolations(AR, { ...bad }, { ...INPUT, units: { ...UNITS, 'submenu-disclosure': { verdict: 'mirror' as const, ltr: '▸', rtl: '◂' } } })
    expect(r.violations.some((v) => v.unit === '(any)')).toBe(true)
  })

  it('the two axes are different numbers, and the result reports both', () => {
    const r = arrowCatalogViolations(AR, ok, INPUT)
    expect(r.checked, '(unit, key) pairs').toBe(2)
    expect(r.occurrences, 'glyph occurrences').toBe(3)
  })
})

// ── the GLOBAL census ───────────────────────────────────────────────────────
//
// `arrowCatalogViolations` is per-key: it answers "is each key the manifest names
// correct", and its occurrence total is a sum over the MANIFEST. That total cannot
// see an arrow added to a key nobody ruled on, which is the one failure the shape
// of a per-key contract guarantees it will miss. `arrowCensus` walks the catalogue
// instead, so `unclaimed 0` is a statement about every string in it.

describe('arrowCensus', () => {
  const ok = {
    'share.tooLarge': 'ملف ← تصدير',
    'regExpr.row.cycle': '— دورة: {name} → … → {name}',
    'language.arabic': 'العربية',
  }

  it('attributes every occurrence, and claims nothing that is not there', () => {
    const c = arrowCensus(AR, ok, INPUT)
    expect(c.claimed, 'one menu-path plus two graph-relation').toBe(3)
    expect(c.unclaimed).toEqual([])
    expect(c.multiplyClaimed).toEqual([])
  })

  it('an arrow in a key NO unit governs is UNCLAIMED', () => {
    const c = arrowCensus(AR, { ...ok, 'language.arabic': 'العربية →' }, INPUT)
    expect(c.unclaimed).toEqual([{ key: 'language.arabic', glyph: '→' }])
  })

  it('an arrow that merely LOOKS locale-correct is still unclaimed', () => {
    // `←` is what a mirroring unit wants under `ar`, so a reviewer skimming for
    // "wrong-way arrows" would pass this. Governance is the question, not direction.
    const c = arrowCensus(AR, { ...ok, 'language.arabic': 'العربية ←' }, INPUT)
    expect(c.unclaimed).toEqual([{ key: 'language.arabic', glyph: '←' }])
  })

  it('a SECOND glyph beyond the declared occurrences is unclaimed', () => {
    const c = arrowCensus(AR, { ...ok, 'regExpr.row.cycle': '{name} → … → … → {name}' }, INPUT)
    expect(c.unclaimed).toEqual([{ key: 'regExpr.row.cycle', glyph: '→' }])
    expect(c.claimed).toBe(3)
  })

  it('two units of one key requiring the SAME glyph is reported, not silently merged', () => {
    // the real manifest has no such pair (before issue #298 `share.tooLarge` took
    // `←` from menu-path and a disclosure glyph from a second unit; the disclosure
    // is an icon now) — and this asserts the census would SAY so rather than
    // attributing one glyph twice
    const ambiguous: ArrowCatalogInput = {
      ...INPUT,
      catalog: [...INPUT.catalog, { unit: 'graph-relation', keys: ['share.tooLarge'] }],
    }
    const c = arrowCensus(EN, { ...ok, 'share.tooLarge': 'File → Export' }, ambiguous)
    expect(c.multiplyClaimed.map((m) => m.key)).toEqual(['share.tooLarge'])
    expect(c.multiplyClaimed[0].units.sort()).toEqual(['graph-relation', 'menu-path'])
  })
})
