import { describe, expect, it } from 'vitest'
import { GATE_WHY_KEY, gateWhyKey } from './gateStatusKeys'
import canvasEn from '../../i18n/locales/en/canvas'

// Issue #593 — a reason's phrase can depend on the state. `upstream` on a `partial` Gate keeps its
// phrase (supplied in part); on a `held` Gate nothing arrived from what feeds it, and it gets a
// phrase of its own. Every other reason reads the same in every state.
describe('the phrase of a Gate`s reason', () => {
  it('a held Gate held by what feeds it: nothing arrived', () => {
    expect(gateWhyKey({ state: 'held', why: 'upstream' })).toBe('node.gate.why.upstreamHeld')
    expect(canvasEn['node.gate.why.upstreamHeld']).toBe('Nothing arrived from what feeds it this step.')
  })
  it('a part by what feeds it keeps "supplied in part"', () => {
    expect(gateWhyKey({ state: 'partial', why: 'upstream' })).toBe('node.gate.why.upstream')
    expect(canvasEn['node.gate.why.upstream']).toMatch(/^Supplied in part/)
  })
  it('every other reason reads the same whatever the state, and no reason has no phrase', () => {
    for (const why of Object.keys(GATE_WHY_KEY) as (keyof typeof GATE_WHY_KEY)[]) {
      if (why === 'upstream') continue
      for (const state of ['held', 'partial', 'fault'] as const) expect(gateWhyKey({ state, why }), `${state}/${why}`).toBe(GATE_WHY_KEY[why])
    }
    expect(gateWhyKey({ state: 'full', why: undefined })).toBeNull()
  })
})
