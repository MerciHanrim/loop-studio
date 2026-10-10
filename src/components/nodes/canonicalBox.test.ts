import { describe, expect, it } from 'vitest'
import type { LoopNode } from '../../model/types'
import { canonicalBox, legacyCanonicalBoxBeforeOutlineContainment, textWidthBound, titleLines } from './canonicalBox'
import LEGACY from '../../../test/fixtures/legacy-canonical-boxes.json'
import eqDoc from '../../../test/fixtures/templates-before-step4/equilibrium.json'
import dlDoc from '../../../test/fixtures/templates-before-step4/deadlock.json'
import coffeeDoc from '../../../test/fixtures/templates-before-step4/coffee-roastery.json'
import gachaDoc from '../../../test/fixtures/templates-before-step4/gacha-banner-zones.json'
import mmoDoc from '../../../test/fixtures/templates-before-step4/mmo-progression.json'
import { MAX_NODE_H, OUTLINE_DEPTH, portInsetFraction } from './silhouette'

// issue #344 §DL2.1 — the canonical box: from the document alone, an upper
// bound of the drawn box in every language (checked against every bundled
// Template × 18 languages in the browser: 0 under-covers)

const node = (type: string, data: Record<string, unknown>) => ({ id: 'n', type, position: { x: 0, y: 0 }, data: { kind: type, ...data } }) as unknown as LoopNode

describe('canonicalBox', () => {
  it('keeps the kind minimum and maximum widths', () => {
    expect(canonicalBox(node('pool', { label: 'A', initial: 0 })).w).toBe(118)
    expect(canonicalBox(node('gate', { label: 'A', distribution: '' })).w).toBe(134)
    expect(canonicalBox(node('register', { label: 'R', expr: 'x'.repeat(200) })).w).toBe(260)
  })

  it('gives a wrapped title the full title box', () => {
    const one = canonicalBox(node('pool', { label: 'Gold', initial: 0 }))
    const wrapped = canonicalBox(node('pool', { label: 'Gekaufte Nahrung (Einheiten)', initial: 0 }))
    expect(titleLines('Gekaufte Nahrung (Einheiten)').length).toBeGreaterThan(1)
    // #337: the chip + the full title box, and on each side the Pool's slant
    // where it reaches furthest in over the stack plus the 8 px clearance (25)
    expect(wrapped.w).toBe(14 + 135 + 25 + 25)
    expect(wrapped.h).toBeGreaterThan(one.h)
  })

  it('#337: a width-parametric kind keeps room for its fixed-depth outline on both sides', () => {
    // the Converter's waist is 8 + 16 px in on each side, plus the 8 px clearance
    const conv = canonicalBox(node('converter', { label: 'Gekaufte Nahrung (Einheiten)', mode: 'pullAny' }))
    expect(conv.w).toBeGreaterThanOrEqual(14 + 135 + 2 * (8 + 16 + 8))
    // a Parameter keeps its padding rule
    expect(canonicalBox(node('parameter', { label: 'A', value: 1 })).w).toBe(118)
  })

  it('wraps by the strictest UI language rule (Korean keeps words whole)', () => {
    // breakable between any two hangul under `normal`; whole words under `keep-all`
    expect(titleLines('카페리테일원두수요량카페리테일').length).toBeGreaterThanOrEqual(2)
  })

  it('never exceeds the kind height ceiling', () => {
    const tall = canonicalBox(node('gate', { label: 'word '.repeat(40), distribution: 'deterministic' }))
    expect(tall.h).toBeLessThanOrEqual(MAX_NODE_H.gate)
  })

  it('counts combining marks as zero width and spacing vowels as wide', () => {
    expect(textWidthBound('ก่', 14)).toBe(textWidthBound('ก', 14))
    expect(textWidthBound('กา', 14)).toBeGreaterThan(textWidthBound('ก', 14))
  })
})

// the layout migration's frame membership (§DL2.8) — FROZEN: the box of every
// node of the Templates as they stood before step 4, as Step 4's canonicalBox
// gave it (checked node for node against that code when this was written)
describe('legacyCanonicalBoxBeforeOutlineContainment (frozen)', () => {
  const docs = { equilibrium: eqDoc, deadlock: dlDoc, 'coffee-roastery': coffeeDoc, 'gacha-banner-zones': gachaDoc, 'mmo-progression': mmoDoc } as unknown as Record<string, { nodes: LoopNode[] }>
  it('gives every node of the pre-step-4 Templates exactly the recorded box', () => {
    const table: Record<string, Record<string, number[]>> = {}
    for (const [name, doc] of Object.entries(docs)) {
      table[name] = {}
      for (const n of [...doc.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const b = legacyCanonicalBoxBeforeOutlineContainment(n)
        table[name][n.id] = [b.w, b.h]
      }
    }
    expect(table).toEqual(LEGACY)
  })

  it('is not the current canonical box: a Converter is narrower without the #337 outline room', () => {
    const conv = node('converter', { label: 'Gekaufte Nahrung (Einheiten)', mode: 'pullAny' })
    expect(legacyCanonicalBoxBeforeOutlineContainment(conv).w).toBe(12 + 14 + 135 + 12)
    expect(canonicalBox(conv).w).toBeGreaterThan(legacyCanonicalBoxBeforeOutlineContainment(conv).w)
  })
})

describe('portInsetFraction (the drawn port on the 28 px row)', () => {
  it('sits on the outline: a Pool slant, a Drain notch tip, a Converter waist, a Source tip', () => {
    expect(portInsetFraction('pool', 58, 'in', 28)).toBeGreaterThan(0.1)
    expect(portInsetFraction('drain', 56, 'in', 28)).toBeCloseTo(6 / 120, 5)
    expect(portInsetFraction('converter', 56, 'in', 28)).toBeCloseTo((8 + OUTLINE_DEPTH.converterWaist) / 120, 5)
    expect(portInsetFraction('source', 56, 'out', 28)).toBeCloseTo(6 / 120, 5)
  })

  it('#337: a width-parametric outline keeps its port the same px in at every width', () => {
    for (const kind of ['pool', 'source', 'drain', 'converter', 'gate'] as const)
      for (const side of ['in', 'out'] as const) {
        const at120 = portInsetFraction(kind, 56, side, 28, 120) * 120
        expect(portInsetFraction(kind, 56, side, 28, 240) * 240, `${kind} ${side}`).toBeCloseTo(at120, 5)
      }
    // a 120-wide-viewBox kind stretches: the same fraction at every width
    expect(portInsetFraction('register', 56, 'in', 28, 240)).toBeCloseTo(portInsetFraction('register', 56, 'in', 28), 5)
  })

  it('stays on the row when the node grows: a taller Gate keeps its port at y 28', () => {
    const low = portInsetFraction('gate', 56, 'in', 28)
    const tall = portInsetFraction('gate', 92, 'in', 28)
    expect(low).toBeCloseTo(3 / 120, 5) // the diamond's apex
    expect(tall).toBeGreaterThan(low) // on the slanted side above the apex
  })
})
