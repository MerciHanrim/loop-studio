import { describe, expect, it } from 'vitest'
import type { LoopNode } from '../../model/types'
import { canonicalBox, textWidthBound, titleLines } from './canonicalBox'
import { MAX_NODE_H, portInsetFraction } from './silhouette'

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
    expect(wrapped.w).toBe(12 + 14 + 135 + 12)
    expect(wrapped.h).toBeGreaterThan(one.h)
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

describe('portInsetFraction (the drawn port on the 28 px row)', () => {
  it('sits on the outline: a Pool slant, a Drain notch tip, a Converter waist, a Source tip', () => {
    expect(portInsetFraction('pool', 58, 'in', 28)).toBeGreaterThan(0.1)
    expect(portInsetFraction('drain', 56, 'in', 28)).toBeCloseTo(6 / 120, 5)
    expect(portInsetFraction('converter', 56, 'in', 28)).toBeCloseTo(38 / 120, 5)
    expect(portInsetFraction('source', 56, 'out', 28)).toBeCloseTo(6 / 120, 5)
  })

  it('stays on the row when the node grows: a taller Gate keeps its port at y 28', () => {
    const low = portInsetFraction('gate', 56, 'in', 28)
    const tall = portInsetFraction('gate', 92, 'in', 28)
    expect(low).toBeCloseTo(3 / 120, 5) // the diamond's apex
    expect(tall).toBeGreaterThan(low) // on the slanted side above the apex
  })
})
