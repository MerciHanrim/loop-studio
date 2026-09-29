import { describe, expect, it } from 'vitest'
import { FSI, LRI, PDI, isolateAuto, isolateLtr, stripBidiControls, unwrapIsolates } from './bidiIsolate'
import { bidiFindings, hasAnyBidiControl, isolatesIn } from './bidiControls'

// docs/localization.md §L9.4 — the producer half of bidi isolation.
//
// Every control here is ZERO-WIDTH. A failing assertion that prints the string
// prints nothing a reader can act on, so the fixtures are built from named code
// points and the assertions are made on code points and on the ANALYSIS
// functions in `./bidiControls`, never on how the string looks.

const RLM = String.fromCharCode(0x200f)
const LRM = String.fromCharCode(0x200e)
const RLO = String.fromCharCode(0x202e)
const RLI = String.fromCharCode(0x2067)

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

  it('an embedded override has no end at all — it is removed', () => {
    for (const ctrl of [RLO, RLM, LRM]) {
      const wrapped = isolateAuto('a' + ctrl + 'b')
      expect(wrapped).toBe(FSI + 'ab' + PDI)
      expect(hasAnyBidiControl(unwrapIsolates(wrapped))).toBe(false)
    }
  })

  it('an embedded opener without its closer is removed too', () => {
    const wrapped = isolateLtr('x' + RLI + 'y')
    expect(wrapped).toBe(LRI + 'xy' + PDI)
    expect(bidiFindings(wrapped)).toEqual([])
  })

  it('strips every control the policy names, and leaves ordinary text alone', () => {
    expect(stripBidiControls(LRM + RLM + RLO + FSI + LRI + RLI + PDI)).toBe('')
    expect(stripBidiControls(MIXED)).toBe(MIXED)
    expect(stripBidiControls('')).toBe('')
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

describe('idempotence and composition', () => {
  it('wrapping twice does not nest — the inner pair is stripped first', () => {
    const once = isolateAuto(ARABIC)
    const twice = isolateAuto(once)
    expect(twice).toBe(once)
    expect(isolatesIn(twice)).toEqual(['FSI'])
  })

  it('re-wrapping with the other helper replaces the kind rather than nesting', () => {
    const auto = isolateAuto(ID)
    expect(isolateLtr(auto)).toBe(LRI + ID + PDI)
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
