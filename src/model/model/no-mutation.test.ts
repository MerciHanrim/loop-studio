import { describe, expect, it } from 'vitest'
import { evaluate, parse, type Resolver } from '../expr'
import { readParameterData } from './parameter'
import { readRegisterData } from './register'
import { normalizeResourceType, resourceTypeMismatches } from './resourceType'
import { evaluateRegisters } from './registers'

// The defensive readers and the evaluator must be pure w.r.t. their inputs:
// they read the raw object and return NEW values, never mutating what was
// passed in. `Object.freeze` makes an accidental write throw in strict mode.

const frozen = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) frozen(v)
    Object.freeze(o)
  }
  return o
}
const snapshot = (o: unknown) => JSON.stringify(o)

describe('loop-model/1 — inputs are never mutated', () => {
  it('readParameterData does not touch the raw data', () => {
    const raw = frozen({ kind: 'parameter', label: 'x', value: 7, min: 0, max: 3, step: 0, unit: '  g  ' })
    const before = snapshot(raw)
    expect(() => readParameterData(raw)).not.toThrow()
    expect(snapshot(raw)).toBe(before)
  })

  it('readRegisterData does not touch the raw data', () => {
    const raw = frozen({ kind: 'register', label: 'p', expr: '@a+@b', unit: ' g ', format: 'nope' })
    const before = snapshot(raw)
    expect(() => readRegisterData(raw)).not.toThrow()
    expect(snapshot(raw)).toBe(before)
  })

  it('normalizeResourceType / resourceTypeMismatches do not reorder or mutate input', () => {
    const edges = frozen([
      { id: 'e2', source: 'a', target: 'b', resourceType: 'Gold' },
      { id: 'e1', source: 'a', target: 'b', resourceType: 'Gold' },
    ])
    const nodes: Record<string, { kind: string; resourceType?: string }> = {
      a: { kind: 'pool', resourceType: 'Energy' },
      b: { kind: 'pool', resourceType: 'Gold' },
    }
    const before = snapshot(edges)
    resourceTypeMismatches({
      resourceEdges: edges,
      nodeKind: (id) => nodes[id]?.kind,
      nodeResourceType: (id) => nodes[id]?.resourceType,
    })
    expect(snapshot(edges)).toBe(before)
    expect(edges[0].id).toBe('e2') // original order untouched
    normalizeResourceType('  Gold  ')
  })

  it('evaluate does not mutate the AST', () => {
    const p = parse('@a * (@b - 2)')
    if (!p.ok) throw new Error('parse')
    frozen(p.ast)
    const before = snapshot(p.ast)
    const r: Resolver = (id) => ({ ok: true, value: id === 'a' ? 3 : 5 })
    expect(() => evaluate(p.ast, r)).not.toThrow()
    expect(snapshot(p.ast)).toBe(before)
  })

  it('evaluateRegisters does not mutate the view or its arrays', () => {
    const registers = frozen([
      { id: 'r_b', expr: '@r_a + 1' },
      { id: 'r_a', expr: '2' },
    ])
    const before = snapshot(registers)
    const out = evaluateRegisters({
      registers,
      refKind: (id) => (id === 'r_a' || id === 'r_b' ? 'register' : 'missing'),
      poolCount: () => 0,
      paramValue: () => 0,
    })
    expect(out.get('r_b')).toEqual({ invalid: false, value: 3 })
    expect(snapshot(registers)).toBe(before)
    expect(registers[0].id).toBe('r_b') // not sorted in place
  })
})
