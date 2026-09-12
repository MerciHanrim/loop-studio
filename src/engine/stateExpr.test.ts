import { describe, expect, it } from 'vitest'
import { classifyLabelTiming, eligibleLabelPreset, parseLabelExpr, ROUTER_KINDS } from './stateExpr'
import { ROUTER_KINDS as ROUTER_KINDS_VIA_STEP } from './step'
import { ROUTER_KINDS as ROUTER_KINDS_VIA_BARREL } from '../engine'

// docs/label-timing-authoring.md §LTA9 — the shared classification /
// eligibility helpers behind the Inspector's label-timing radiogroup.
// Pure, synchronous, no store — exactly the surface the design doc asks for
// so the Inspector never re-derives what SEMANTICS-S3.md §S3-5 already
// decided (LTA-D8 / LTA-D12).

// LTA-D13 — ROUTER_KINDS' canonical home is stateExpr.ts; step.ts imports and
// explicitly re-exports it (a bare `import` does not re-export) rather than
// declaring its own copy, so `src/engine/index.ts`'s existing barrel export
// keeps resolving. Both paths must be the SAME object, not just equal values,
// or the engine and the Inspector could still silently drift apart.
describe('ROUTER_KINDS — one canonical object, two resolvable import paths (LTA-D13)', () => {
  it('the barrel (`../engine`) and the direct (`./step`) paths both resolve to the canonical stateExpr.ts object', () => {
    expect(ROUTER_KINDS_VIA_STEP).toBe(ROUTER_KINDS)
    expect(ROUTER_KINDS_VIA_BARREL).toBe(ROUTER_KINDS)
  })
})

describe('classifyLabelTiming (§LTA4.1 — SEMANTICS-S3.md §S3-5 rows 1-4)', () => {
  it('absent timing, no when -> phase0', () => {
    expect(classifyLabelTiming(undefined, undefined)).toBe('phase0')
  })
  it('explicit "phase0", no when -> phase0', () => {
    expect(classifyLabelTiming('phase0', undefined)).toBe('phase0')
  })
  it('valid afterPull + source-fired -> afterPull', () => {
    expect(classifyLabelTiming('afterPull', 'source-fired')).toBe('afterPull')
  })

  // the four named bad combinations (Hanrim, review round 2) + a fifth
  // (row 1, an unrecognised timing string)
  it('row 2 — phase0 + a stray when -> unsupported', () => {
    expect(classifyLabelTiming('phase0', 'source-fired')).toBe('unsupported')
  })
  it('row 2 (absent timing normalises to phase0 first) — no timing + when -> unsupported', () => {
    expect(classifyLabelTiming(undefined, 'source-fired')).toBe('unsupported')
  })
  it('row 3 — afterPull with no when -> unsupported', () => {
    expect(classifyLabelTiming('afterPull', undefined)).toBe('unsupported')
  })
  it('row 4 — afterPull with an unrecognised when -> unsupported', () => {
    expect(classifyLabelTiming('afterPull', 'level>=5')).toBe('unsupported')
  })
  it('row 1 — an unrecognised timing -> unsupported', () => {
    expect(classifyLabelTiming('nope', 'source-fired')).toBe('unsupported')
  })
})

describe('eligibleLabelPreset (§LTA4.2 — SEMANTICS-S3.md §S3-5 rows 5-8)', () => {
  const N = (n: number) => parseLabelExpr(`+${n}`) // token 'N'
  const S = parseLabelExpr('+S') // token 'S'
  const bad = parseLabelExpr('') // unparseable

  it('Pool source + Pool target + N modifier -> A eligible, B disqualified (source-not-router)', () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'pool', modifier: N(1) })).toEqual({
      eligible: 'A',
      reasonB: 'source-not-router',
    })
  })

  it('Router source + Pool target + N modifier -> B eligible, A disqualified (source-not-pool)', () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'gate', modifier: N(1) })).toEqual({
      eligible: 'B',
      reasonA: 'source-not-pool',
    })
  })

  it("Hanrim's worked example — Router source + S-form modifier + Pool target -> neither eligible, TWO DIFFERENT reasons", () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'converter', modifier: S })).toEqual({
      eligible: null,
      reasonA: 'source-not-pool',
      reasonB: 's-form',
    })
  })

  it('Source-kind source (neither Pool nor Router) -> neither eligible, two DIFFERENT reasons', () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'source', modifier: N(1) })).toEqual({
      eligible: null,
      reasonA: 'source-not-pool',
      reasonB: 'source-not-router',
    })
  })

  it('non-Pool target (any source) -> neither eligible, SAME shared reason on both', () => {
    expect(eligibleLabelPreset({ targetKind: 'gate', sourceKind: 'pool', modifier: N(1) })).toEqual({
      eligible: null,
      reasonA: 'target-not-pool',
      reasonB: 'target-not-pool',
    })
  })

  it('unparseable modifier (row 7, both presets need a parseable one) -> neither eligible, shared reason', () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'pool', modifier: bad })).toEqual({
      eligible: null,
      reasonA: 'modifier-invalid',
      reasonB: 'modifier-invalid',
    })
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: 'pool', modifier: parseLabelExpr('garbage') })).toEqual({
      eligible: null,
      reasonA: 'modifier-invalid',
      reasonB: 'modifier-invalid',
    })
  })

  // §LTA9 test 7b — a dangling reference reachable only by import, never by
  // this codebase's own removeNode (which cascades incident-edge deletion).
  // Exercised here as a pure function call on a synthetic context, exactly
  // per the design doc's stated reason for making this function pure.
  it('missing target id -> neither eligible (shared target-not-pool reason)', () => {
    expect(eligibleLabelPreset({ targetKind: undefined, sourceKind: 'pool', modifier: N(1) })).toEqual({
      eligible: null,
      reasonA: 'target-not-pool',
      reasonB: 'target-not-pool',
    })
  })
  it('missing source id -> neither eligible (two different reasons)', () => {
    expect(eligibleLabelPreset({ targetKind: 'pool', sourceKind: undefined, modifier: N(1) })).toEqual({
      eligible: null,
      reasonA: 'source-not-pool',
      reasonB: 'source-not-router',
    })
  })
})
