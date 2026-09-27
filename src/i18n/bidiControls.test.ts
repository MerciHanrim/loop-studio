import { describe, expect, it } from 'vitest'
import { bidiFindings, hasAnyBidiControl, isolatesIn, ISOLATE_OPENERS, PDI } from './bidiControls'
import { LOCALES } from './registry'

// docs/localization.md §L9.4 — the catalog-wide bidi-control contract.
//
// The rule is NOT "never". It is:
//
//   • every shipped catalog today: zero controls, enforced exhaustively here;
//   • Arabic, when it lands: zero by DEFAULT, with a per-key allowlist;
//   • an allowlisted key may carry ISOLATES ONLY, correctly paired;
//   • LRM / RLM / ALM and the deprecated embeddings are refused everywhere,
//     including Arabic. That is this repo's CATALOG policy, not a claim about
//     Unicode: the platform emits these constantly (`Intl.NumberFormat('ar')`
//     wraps negatives and percentages in LRM) and a render layer may produce
//     them freely. What is refused is a TRANSLATOR typing one into a catalog
//     value, because none of them has an end — the effect runs past the value
//     into whatever the page renders next, which a catalog cannot know;
//   • a key earns its place on the list by a RENDER MEASUREMENT showing that no
//     element-level `dir` can fix it — i.e. RTL prose and an LTR token share
//     one attribute value. Not by a translator's preference.
//
// The list is empty today and the Arabic catalog does not exist, so the
// interesting half has nothing to read. As in `arPlural.test.ts`, the checker
// is exercised on fixtures every run so it is never unproven, and the
// registry sweep below is exhaustive over what DOES exist.

/** Keys allowed to carry a PAIRED isolate.
 *
 *  Empty on purpose: nothing has earned a place yet, and an entry added without
 *  a measurement is how a list like this becomes a rubber stamp.
 *
 *  An entry states WHICH locales, WHICH isolate, and WHERE the measurement that
 *  justifies it lives. `evidence` is a test title or a docs section id — the
 *  thing a later reader follows to see why markup could not do the job. The
 *  fields below are all required and all checked; there is deliberately no
 *  length rule on `rationale`, because a character count cannot tell a reason
 *  from a sentence. */
type IsolateAllowance = {
  locales: readonly string[]
  /** which opener this key needs — an entry may not quietly widen to all three */
  isolate: 'LRI' | 'RLI' | 'FSI'
  /** test title or docs section that holds the render measurement */
  evidence: string
  /** one line: what breaks without it */
  rationale: string
}

const ISOLATE_ALLOWLIST: Record<string, IsolateAllowance> = {}

const shipped = LOCALES.filter((l) => !l.pseudo)
const LRI = [...ISOLATE_OPENERS.keys()][0]!
const FSI = [...ISOLATE_OPENERS.keys()][2]!

describe('no shipped catalog carries a bidi control', () => {
  for (const l of shipped) {
    it(`${l.code} — every value is free of directional controls`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      const dirty: string[] = []
      for (const [key, value] of Object.entries(cat)) {
        if (!hasAnyBidiControl(value)) continue
        const allowed = ISOLATE_ALLOWLIST[key]
        const isolates = isolatesIn(value)
        if (
          allowed?.locales.includes(l.code) &&
          bidiFindings(value).length === 0 &&
          isolates.every((n) => n === allowed.isolate)
        ) {
          continue
        }
        dirty.push(`${key}: ${bidiFindings(value).map((f) => `${f.kind} ${f.name}@${f.at}`).join(', ') || 'isolate, not allowlisted'}`)
      }
      expect(dirty, `${l.code} has bidi controls in catalog text`).toEqual([])
    })
  }

  it('the allowlist names only keys that exist, so it cannot rot', async () => {
    const keys = Object.keys((await shipped[0]!.catalog()) as Record<string, string>)
    for (const key of Object.keys(ISOLATE_ALLOWLIST)) {
      expect(keys, `allowlisted key \`${key}\` is not in the catalog`).toContain(key)
    }
  })

  it('every allowlist entry is complete — locale, isolate, evidence, rationale', () => {
    const codes = new Set(LOCALES.map((l) => l.code))
    for (const [key, entry] of Object.entries(ISOLATE_ALLOWLIST)) {
      expect(entry.locales.length, `${key}: name the locales this applies to`).toBeGreaterThan(0)
      for (const c of entry.locales) expect(codes, `${key}: unknown locale ${c}`).toContain(c)
      expect(['LRI', 'RLI', 'FSI'], `${key}: name one isolate`).toContain(entry.isolate)
      expect(entry.evidence.trim(), `${key}: cite the test or docs section`).not.toBe('')
      expect(entry.rationale.trim(), `${key}: say what breaks without it`).not.toBe('')
    }
  })
})

describe('the checker, exercised on fixtures', () => {
  const AR = String.fromCodePoint(0x627, 0x644, 0x642, 0x64a, 0x645, 0x629)

  it('says nothing about ordinary text', () => {
    expect(bidiFindings('Monte Carlo {pct}%')).toEqual([])
    expect(bidiFindings(AR + ' 25%')).toEqual([])
    expect(hasAnyBidiControl(AR)).toBe(false)
  })

  it('refuses an LRM — the scopeless mark a workaround reaches for first', () => {
    const v = AR + ' ' + String.fromCharCode(0x200e) + '1-3'
    expect(bidiFindings(v)).toEqual([{ kind: 'banned', name: 'LRM', at: 7 }])
  })

  it('refuses the deprecated embeddings too', () => {
    for (const [cp, name] of [
      [0x202a, 'LRE'],
      [0x202b, 'RLE'],
      [0x202d, 'LRO'],
      [0x202e, 'RLO'],
      [0x202c, 'PDF'],
    ] as const) {
      expect(bidiFindings(String.fromCharCode(cp)).map((f) => f.name)).toEqual([name])
    }
  })

  it('accepts a correctly paired isolate', () => {
    const v = AR + ' ' + LRI + '1, all, 2D6, 1-3, 25%' + PDI
    expect(bidiFindings(v)).toEqual([])
    expect(isolatesIn(v)).toEqual(['LRI'])
  })

  it('refuses an isolate that is never closed — the half-applied fix', () => {
    const v = AR + ' ' + LRI + '1-3'
    expect(bidiFindings(v).map((f) => f.kind)).toEqual(['unpaired-open'])
  })

  it('refuses a stray PDI with nothing open', () => {
    expect(bidiFindings(AR + PDI).map((f) => f.kind)).toEqual(['unpaired-close'])
  })

  it('handles nesting, so a wrapped token inside a wrapped clause still pairs', () => {
    const v = FSI + AR + ' ' + LRI + '2D6' + PDI + ' ' + AR + PDI
    expect(bidiFindings(v)).toEqual([])
    expect(isolatesIn(v).sort()).toEqual(['FSI', 'LRI'])
  })

  it('reports a banned mark even when the isolates around it are well formed', () => {
    const v = LRI + '1-3' + String.fromCharCode(0x200f) + PDI
    expect(bidiFindings(v).map((f) => f.name)).toEqual(['RLM'])
  })

  it('counts offsets in code units so a message can point at the character', () => {
    const v = 'ab' + String.fromCharCode(0x200e)
    expect(bidiFindings(v)[0]!.at).toBe(2)
  })
})
