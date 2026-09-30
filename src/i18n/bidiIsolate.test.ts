import { describe, expect, it } from 'vitest'
import { FSI, LRI, PDI, isolateAuto, isolateLtr, stripBidiControls, unwrapIsolates } from './bidiIsolate'
import { bidiFindings, hasAnyBidiControl, isolatesIn } from './bidiControls'

// docs/localization.md §L9.4 — the producer half of bidi isolation.
//
// Every control here is ZERO-WIDTH. A failing assertion that prints the string
// prints nothing a reader can act on, so the fixtures are built from named code
// points and the assertions are made on code points and on the ANALYSIS
// functions in `./bidiControls`, never on how the string looks.

// the three families, kept apart on purpose — they do NOT behave alike
const LRM = String.fromCharCode(0x200e) // strong mark, no scope
const RLM = String.fromCharCode(0x200f) // strong mark, no scope
const RLE = String.fromCharCode(0x202b) // explicit formatting, ended by PDF
const RLO = String.fromCharCode(0x202e) // explicit formatting, ended by PDF
const PDF = String.fromCharCode(0x202c) // the terminator for RLE/LRE/RLO/LRO
const RLI = String.fromCharCode(0x2067) // isolate, ended by PDI

// NOT direction: these must survive untouched
const ZWJ = String.fromCharCode(0x200d)
const ZWNJ = String.fromCharCode(0x200c)
const FATHA = String.fromCharCode(0x064e) // Arabic combining mark
const SHADDA = String.fromCharCode(0x0651) // Arabic combining mark

// real text, not lorem: an Arabic frame name and a spreadsheet header
const ARABIC = 'مبيعات'
const LATIN = 'Q1 Sales'
const MIXED = 'مبيعات Q1'
const ID = 'param_7'

describe('the wrapped value is bounded, and nothing else is', () => {
  it('isolateAuto wraps with FSI … PDI', () => {
    expect(isolateAuto(ARABIC)).toBe(FSI + ARABIC + PDI)
    expect(isolateAuto(LATIN)).toBe(FSI + LATIN + PDI)
  })

  it('isolateLtr wraps with LRI … PDI, because the direction is known', () => {
    expect(isolateLtr(ID)).toBe(LRI + ID + PDI)
  })

  it('produces exactly one balanced isolate — no unpaired control', () => {
    for (const v of [ARABIC, LATIN, MIXED, ID, '0', '-1', '(draft)']) {
      for (const wrapped of [isolateAuto(v), isolateLtr(v)]) {
        expect(bidiFindings(wrapped), v).toEqual([])
        expect(isolatesIn(wrapped).length, v).toBe(1)
      }
    }
    expect(isolatesIn(isolateAuto(ARABIC))).toEqual(['FSI'])
    expect(isolatesIn(isolateLtr(ID))).toEqual(['LRI'])
  })

  it('does not change the text a reader sees', () => {
    for (const v of [ARABIC, LATIN, MIXED, ID]) {
      expect(unwrapIsolates(isolateAuto(v))).toBe(v)
      expect(unwrapIsolates(isolateLtr(v))).toBe(v)
    }
  })
})

describe('a value cannot escape or close the isolate from the inside', () => {
  // This is the whole reason the value is stripped first. Without it the
  // helpers would return a string that LOOKS wrapped and is not bounded.

  it('an embedded PDI would close the isolate early — it is removed', () => {
    const hostile = 'abc' + PDI + 'def'
    const wrapped = isolateAuto(hostile)
    expect(wrapped).toBe(FSI + 'abcdef' + PDI)
    expect(bidiFindings(wrapped)).toEqual([])
    expect(isolatesIn(wrapped)).toEqual(['FSI'])
    // The failure this prevents: in the naive form the value's own PDI closes
    // the FSI after `abc`, so `def` is outside the isolate and the TRAILING PDI
    // has nothing left to close. The finding's offset is incidental; that the
    // string ends up with an unpaired closer is the point.
    const naive = FSI + hostile + PDI
    expect(isolatesIn(naive)).toEqual(['FSI'])
    const unpaired = bidiFindings(naive).filter((f) => f.kind === 'unpaired-close')
    expect(unpaired).toHaveLength(1)
    expect(unpaired[0]!.name).toBe('PDI')
  })

  it('a strong MARK is removed — it steers the neutrals around it, and the FSI', () => {
    // LRM/RLM/ALM open no scope at all. They are removed because they are
    // strong: one leading the value would decide the FSI's direction instead of
    // the value's own first real character.
    for (const ctrl of [LRM, RLM]) {
      const wrapped = isolateAuto('a' + ctrl + 'b')
      expect(wrapped).toBe(FSI + 'ab' + PDI)
      expect(hasAnyBidiControl(unwrapIsolates(wrapped))).toBe(false)
    }
  })

  it('an explicit FORMATTING pair is removed — its scope ends at PDF, not PDI', () => {
    // RLE/RLO are not closed by our PDI, so an unterminated one would run to
    // the end of the paragraph, past everything this isolate bounds.
    for (const open of [RLE, RLO]) {
      expect(isolateAuto('a' + open + 'b')).toBe(FSI + 'ab' + PDI)
      expect(isolateAuto('a' + open + 'b' + PDF + 'c')).toBe(FSI + 'abc' + PDI)
    }
  })

  it('an embedded opener without its closer is removed too', () => {
    const wrapped = isolateLtr('x' + RLI + 'y')
    expect(wrapped).toBe(LRI + 'xy' + PDI)
    expect(bidiFindings(wrapped)).toEqual([])
  })

  it('strips every control the policy names, and leaves ordinary text alone', () => {
    expect(stripBidiControls(LRM + RLM + RLO + PDF + FSI + LRI + RLI + PDI)).toBe('')
    expect(stripBidiControls(MIXED)).toBe(MIXED)
    expect(stripBidiControls('')).toBe('')
  })
})

describe('what is NOT a direction control survives untouched', () => {
  // Stripping is scoped to bidi FORMATTING and CONTROL characters. A joiner
  // shapes the letters and a combining mark is part of the word; removing
  // either would change the text a reader sees, which this must never do.

  it('keeps ZWJ and ZWNJ', () => {
    for (const j of [ZWJ, ZWNJ]) {
      expect(stripBidiControls('a' + j + 'b')).toBe('a' + j + 'b')
      expect(isolateAuto('a' + j + 'b')).toBe(FSI + 'a' + j + 'b' + PDI)
    }
  })

  it('keeps Arabic combining marks, and the wrapped value round-trips exactly', () => {
    const vocalised = 'مُعَامِل' // carries its own combining marks
    const built = 'ب' + FATHA + 'ا' + SHADDA
    for (const v of [vocalised, built]) {
      expect(stripBidiControls(v)).toBe(v)
      expect(isolateAuto(v)).toBe(FSI + v + PDI)
      expect(unwrapIsolates(isolateAuto(v))).toBe(v)
    }
  })

  it('a combining mark survives even beside a control that does not', () => {
    const v = 'ب' + FATHA + LRM + 'ا'
    expect(isolateAuto(v)).toBe(FSI + 'ب' + FATHA + 'ا' + PDI)
  })
})

describe('an inert value is returned unchanged, so emptiness stays testable', () => {
  it('empty stays empty', () => {
    expect(isolateAuto('')).toBe('')
    expect(isolateLtr('')).toBe('')
  })

  it('whitespace-only stays whitespace-only', () => {
    // a caller may be testing the rendered value for emptiness; a blank cell
    // must not become a two-character string
    for (const v of [' ', '   ', '\t', '\n']) {
      expect(isolateAuto(v)).toBe(v)
      expect(isolateLtr(v)).toBe(v)
    }
  })

  it('a value that is ONLY controls collapses to empty, not to a bare pair', () => {
    expect(isolateAuto(LRM + RLM)).toBe('')
    expect(isolateLtr(PDI)).toBe('')
  })

  it('a single character is still wrapped — inert means empty, not short', () => {
    expect(isolateAuto('7')).toBe(FSI + '7' + PDI)
    expect(isolateLtr('x')).toBe(LRI + 'x' + PDI)
  })
})

describe('idempotence is PER MODE, not per helper', () => {
  // Re-applying the SAME mode is a no-op; re-applying the OTHER mode is a
  // change of kind, not a nesting. Stating it as one "wrapping twice does
  // nothing" rule would be false for the cross case.

  it('isolateAuto over an FSI pair returns it unchanged', () => {
    const once = isolateAuto(ARABIC)
    expect(isolateAuto(once)).toBe(once)
    expect(isolatesIn(isolateAuto(once))).toEqual(['FSI'])
  })

  it('isolateLtr over an LRI pair returns it unchanged', () => {
    const once = isolateLtr(ID)
    expect(isolateLtr(once)).toBe(once)
    expect(isolatesIn(isolateLtr(once))).toEqual(['LRI'])
  })

  it('the WRONG kind of existing wrapper is cleaned out and re-wrapped as asked', () => {
    // FSI pair asked for ltr -> LRI pair, one level deep
    expect(isolateLtr(isolateAuto(ID))).toBe(LRI + ID + PDI)
    // LRI pair asked for auto -> FSI pair
    expect(isolateAuto(isolateLtr(ARABIC))).toBe(FSI + ARABIC + PDI)
    // and an RLI pair, which neither helper produces, is also just input
    expect(isolateAuto(RLI + ARABIC + PDI)).toBe(FSI + ARABIC + PDI)
  })

  it('every result has EXACTLY ONE outer pair and ZERO inner controls', () => {
    const inputs = [
      ARABIC,
      MIXED,
      ID,
      isolateAuto(ARABIC),
      isolateLtr(ID),
      RLI + MIXED + PDI,
      'a' + PDI + 'b',
      LRM + ARABIC,
      RLO + LATIN + PDF,
    ]
    for (const v of inputs) {
      for (const [name, wrapped] of [
        ['auto', isolateAuto(v)],
        ['ltr', isolateLtr(v)],
      ] as const) {
        expect(bidiFindings(wrapped), `${name}: ${JSON.stringify(v)}`).toEqual([])
        expect(isolatesIn(wrapped), `${name}: ${JSON.stringify(v)}`).toHaveLength(1)
        // the interior carries no control of its own
        const inner = wrapped.slice(1, -1)
        expect(hasAnyBidiControl(inner), `${name}: inner of ${JSON.stringify(v)}`).toBe(false)
      }
    }
  })

  it('two wrapped values concatenated stay two separate pairs', () => {
    const joined = isolateAuto(ARABIC) + ' · ' + isolateAuto(LATIN)
    expect(bidiFindings(joined)).toEqual([])
    expect(isolatesIn(joined)).toEqual(['FSI', 'FSI'])
    // the separator is OUTSIDE both isolates, so the sentence keeps it
    expect(unwrapIsolates(joined)).toBe(ARABIC + ' · ' + LATIN)
  })
})

describe('the catalog boundary', () => {
  it('these helpers add controls to a VALUE, never to a catalog message', async () => {
    // the shipped catalogs carry zero bidi controls and that must stay true;
    // this file exists to put one around a render argument instead
    const ar = (await import('./locales/ar')).default as unknown as Record<string, string>
    const dirty = Object.entries(ar).filter(([, v]) => hasAnyBidiControl(v))
    expect(dirty.map(([k]) => k)).toEqual([])
  })
})
