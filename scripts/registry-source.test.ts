import { describe, expect, it } from 'vitest'
import {
  baseLocale,
  nonBaseCodes,
  parsePseudoText,
  pseudoCodes,
  pseudoMarkers,
  parseRegistryText,
  RegistryParseError,
  shippedCodes,
} from './registry-source.mjs'
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

// A bracket walk and a `code:` match are LEXICAL questions. Scanning raw text
// answers them wrongly the moment a comment or a string says something that
// looks like code — and the registry is full of prose about locales, so this is
// not hypothetical. Both cases below were MEASURED against the real registry
// before the masking existed: the comment was counted as an 18th locale, and
// the bracket in a string threw "array literal is not closed".
const FIXTURE = (body: string) => `
export const BASE_LOCALE_DECOY = 'zz' // code: 'decoy',
const SHIPPED_LOCALES: readonly LocaleEntry[] = [
${body}
]
export const BASE_LOCALE = 'en'
`

describe('the parser reads code, not prose', () => {
  const entry = (code: string, extra = '') => `  {\n    code: '${code}',\n${extra}  },`

  it('ignores a commented-out entry inside the array', () => {
    const r = parseRegistryText(FIXTURE([entry('en'), "  // code: 'xx',", entry('ko')].join('\n')))
    expect(r.shipped).toEqual(['en', 'ko'])
    expect(r.shipped).not.toContain('xx')
  })

  it('ignores a block comment that talks about a code', () => {
    const r = parseRegistryText(
      FIXTURE([entry('en'), "  /* an old entry:\n     code: 'yy',\n  */", entry('ko')].join('\n')),
    )
    expect(r.shipped).toEqual(['en', 'ko'])
  })

  it('survives an unbalanced bracket inside a string value', () => {
    // a real endonym could contain one; it must not end the array
    const r = parseRegistryText(FIXTURE([entry('en', "    nativeName: 'Bracket [ here',\n"), entry('ko')].join('\n')))
    expect(r.shipped).toEqual(['en', 'ko'])
  })

  it('survives a bracket inside a comment', () => {
    const r = parseRegistryText(FIXTURE([entry('en'), '  // a label like `Gold [pool-3]`', entry('ko')].join('\n')))
    expect(r.shipped).toEqual(['en', 'ko'])
  })

  it('does not take BASE_LOCALE from a commented-out declaration', () => {
    const r = parseRegistryText(FIXTURE([entry('en'), entry('ko')].join('\n')))
    expect(r.baseLocale).toBe('en')
  })

  // The two cases below matter because they prove the masking / parsing never
  // turns a broken registry into a quiet success. The MESSAGE is not the
  // contract — the throw is — so each asserts the error type as well.
  it('still throws when the array really is unclosed', () => {
    const broken = FIXTURE("  { code: 'en', },").replace(/\n\]/, '')
    expect(() => parseRegistryText(broken)).toThrow(RegistryParseError)
    // It must fail as a SYNTAX error, not later on a structural check.
    // `createSourceFile` recovers from a missing `]` and returns a usable tree;
    // this used to surface as "there are no non-base locales", which is a
    // fail-closed accident — the same recovery could have produced a tree that
    // read fine and was wrong.
    expect(() => parseRegistryText(broken)).toThrow(/not syntactically valid/)
  })

  it('still throws when every entry is commented out', () => {
    expect(() => parseRegistryText(FIXTURE("  // code: 'en',"))).toThrow(RegistryParseError)
    expect(() => parseRegistryText(FIXTURE("  // code: 'en',"))).toThrow(/empty array/)
  })

  // The case that sent this module to the real parser. A hand-rolled scan has
  // to tell a regex from a division, and a regex body may contain `//`, `/*`,
  // `[` and `]` — each of which the scan would act on.
  it('is not confused by a regex literal containing comment and bracket characters', () => {
    const noisy = `const RE = /[/*]|\\/\\/|[[\\]]/g\n`
    const r = parseRegistryText(
      noisy + FIXTURE("  { code: 'en', },\n  { code: 'ko', },"),
    )
    expect(r.shipped).toEqual(['en', 'ko'])
  })

  it('is not confused by a template literal with an interpolation', () => {
    const noisy = 'const T = `a ${1 + 1} [ // not a comment`\n'
    const r = parseRegistryText(noisy + FIXTURE("  { code: 'en', },\n  { code: 'ko', },"))
    expect(r.shipped).toEqual(['en', 'ko'])
  })

  it('refuses an element shape it cannot read, rather than returning fewer locales', () => {
    const spread = FIXTURE("  { code: 'en', },\n  ...MORE_LOCALES,")
    expect(() => parseRegistryText(spread)).toThrow(/not an object literal/)
  })

  it('refuses a second SHIPPED_LOCALES declaration instead of picking one', () => {
    const twice = FIXTURE("  { code: 'en', },\n  { code: 'ko', },") +
      "\nconst SHIPPED_LOCALES: readonly LocaleEntry[] = []\n"
    expect(() => parseRegistryText(twice)).toThrow(/declared 2 times/)
  })

  it('reports a syntax error as a parse diagnostic, with a position', () => {
    const broken = FIXTURE("  { code: 'en' ,,, },")
    expect(() => parseRegistryText(broken)).toThrow(/not syntactically valid/)
    expect(() => parseRegistryText(broken)).toThrow(/at \d+:\d+/)
  })

  it('refuses a spread that could overwrite `code` at runtime', () => {
    // the spread comes AFTER `code`, so a static read would report 'ko' while
    // the program might not
    const shadowed = FIXTURE("  { code: 'en', },\n  { code: 'ko', ...OVERRIDES },")
    expect(() => parseRegistryText(shadowed)).toThrow(/contains a spread/)
  })

  it('refuses an entry with two `code` properties', () => {
    const twoCodes = FIXTURE("  { code: 'en', },\n  { code: 'ko', code: 'ja' },")
    expect(() => parseRegistryText(twoCodes)).toThrow(/2 `code` properties/)
  })

  it('refuses shorthand and computed `code`, which hide the value', () => {
    expect(() => parseRegistryText(FIXTURE("  { code: 'en', },\n  { code },"))).toThrow(
      /not a plain/,
    )
    expect(() => parseRegistryText(FIXTURE("  { code: 'en', },\n  { ['co'+'de']: 'ko' },"))).toThrow(
      /has no `code` property/,
    )
  })

  it('does not count a same-named local inside a function as a declaration', () => {
    const withLocal =
      FIXTURE("  { code: 'en', },\n  { code: 'ko', },") +
      "\nfunction helper() {\n  const SHIPPED_LOCALES = []\n  const BASE_LOCALE = 'zz'\n  return [SHIPPED_LOCALES, BASE_LOCALE]\n}\n"
    const r = parseRegistryText(withLocal)
    expect(r.shipped).toEqual(['en', 'ko'])
    expect(r.baseLocale).toBe('en')
  })
})

// ── the DEV-only pseudo-locale readers ──────────────────────────────────────
// `pseudoCodes()` / `pseudoMarkers()` decide what must be byte-absent from every
// production artefact, so a silent mis-read here would make
// `check-no-pseudo-locales.mjs` pass for the wrong reason. Each refusal below is
// exercised on a FIXTURE rather than by editing the real registry: a test that has
// to mutate `registry.ts` cannot run in parallel and cannot show a case the
// registry does not happen to contain.

const SHIPPED_ONE = [
  "  {",
  "    code: 'en',",
  "    englishName: 'English',",
  "    nativeName: 'English',",
  "  },",
].join('\n')

/** a registry text with a `devPseudoLocales` function of the given shape */
const PSEUDO_FIXTURE = (fnBody: string) => `
const SHIPPED_LOCALES: readonly LocaleEntry[] = [
${SHIPPED_ONE}
]
export const BASE_LOCALE = 'en'
function devPseudoLocales(): readonly LocaleEntry[] {
${fnBody}
}
`

const GOOD_ENTRIES = [
  "  return [",
  "    { code: 'en-XA', englishName: 'Pseudo (QA)', nativeName: 'Pseudo (QA)' },",
  "    { code: 'ar-XB', englishName: 'Pseudo RTL (QA)', nativeName: 'Pseudo RTL (QA)' },",
  "  ]",
].join('\n')
const GATE = '  if (!import.meta.env.DEV) return []'

describe('the pseudo-locale readers', () => {
  it('reads both codes and both visible names, de-duplicated', () => {
    const r = parsePseudoText(PSEUDO_FIXTURE([GATE, GOOD_ENTRIES].join('\n')))
    expect(r.codes).toEqual(['en-XA', 'ar-XB'])
    // the two names appear twice each in the source (englishName + nativeName)
    expect(r.markers).toEqual(['Pseudo RTL (QA)', 'Pseudo (QA)', 'ar-XB', 'en-XA'])
  })

  it('refuses a registry whose DEV gate has been removed', () => {
    // the one edit that would make every downstream byte check pass while the
    // pseudo-locales actually ship
    expect(() => parsePseudoText(PSEUDO_FIXTURE(GOOD_ENTRIES))).toThrow(/import\.meta\.env\.DEV/)
  })

  it('refuses a gate that returns something other than an empty array', () => {
    const weak = '  if (!import.meta.env.DEV) return SOMETHING'
    expect(() => parsePseudoText(PSEUDO_FIXTURE([weak, GOOD_ENTRIES].join('\n')))).toThrow(
      /import\.meta\.env\.DEV/,
    )
  })

  it('refuses two returns that both carry entries', () => {
    const two = [GATE, "  if (x) return [{ code: 'en-XA' }]", GOOD_ENTRIES].join('\n')
    expect(() => parsePseudoText(PSEUDO_FIXTURE(two))).toThrow(/not statically one array/)
  })

  it('refuses a spread inside a pseudo entry', () => {
    const spread = [GATE, "  return [{ ...base, code: 'en-XA' }]"].join('\n')
    expect(() => parsePseudoText(PSEUDO_FIXTURE(spread))).toThrow(/spread/)
  })

  it('refuses a pseudo code that a shipped locale also uses', () => {
    const clash = [GATE, "  return [{ code: 'en', englishName: 'Nope', nativeName: 'Nope' }]"].join('\n')
    expect(() => parsePseudoText(PSEUDO_FIXTURE(clash))).toThrow(/also appear in SHIPPED_LOCALES/)
  })

  it('refuses a marker a SHIPPED locale shares, because checking it would fail every build', () => {
    const shippedNamedPseudo = `
const SHIPPED_LOCALES: readonly LocaleEntry[] = [
  { code: 'en', englishName: 'Pseudo (QA)', nativeName: 'English' },
]
export const BASE_LOCALE = 'en'
function devPseudoLocales(): readonly LocaleEntry[] {
${GATE}
${GOOD_ENTRIES}
}
`
    expect(() => parsePseudoText(shippedNamedPseudo)).toThrow(/also used by a SHIPPED locale/)
  })

  it('refuses entries with no visible name at all', () => {
    const nameless = [GATE, "  return [{ code: 'en-XA' }]"].join('\n')
    expect(() => parsePseudoText(PSEUDO_FIXTURE(nameless))).toThrow(/englishName/)
  })

  it('agrees with the real registry', () => {
    const real = LOCALES.filter((l) => l.pseudo)
    expect(pseudoCodes()).toEqual(real.map((l) => l.code))
    for (const l of real) {
      expect(pseudoMarkers()).toContain(l.code)
      expect(pseudoMarkers()).toContain(l.englishName)
      expect(pseudoMarkers()).toContain(l.nativeName)
    }
    // and never a shipped locale's own name
    for (const l of LOCALES.filter((x) => !x.pseudo)) {
      expect(pseudoMarkers()).not.toContain(l.code)
      expect(pseudoMarkers()).not.toContain(l.englishName)
    }
  })
})
