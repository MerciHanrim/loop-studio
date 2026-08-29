import { describe, expect, it } from 'vitest'
import { type RefKind, type RegisterSnapshotView, evaluateRegisters } from './registers'

// SEMANTICS-M.md §M3 — the Register DAG pass: topo order, cycle → invalid,
// depends-on-invalid cascade, deterministic.

type Kinds = Record<string, RefKind>

const mkView = (
  registers: { id: string; expr: string }[],
  opts: { kinds?: Kinds; pools?: Record<string, number>; params?: Record<string, number> } = {},
): RegisterSnapshotView => {
  const kinds: Kinds = { ...opts.kinds }
  for (const r of registers) kinds[r.id] ??= 'register'
  return {
    registers,
    refKind: (id) => kinds[id] ?? 'missing',
    poolCount: (id) => opts.pools?.[id] ?? 0,
    paramValue: (id) => opts.params?.[id] ?? 0,
  }
}

describe('loop-model/1 evaluateRegisters (§M3)', () => {
  it('resolves pools, parameters, and prior registers in one pass', () => {
    const out = evaluateRegisters(
      mkView(
        [
          { id: 'r_rev', expr: '@p_price * @pool_sales' },
          { id: 'r_profit', expr: '@r_rev - @pool_cost' },
        ],
        {
          kinds: { p_price: 'parameter', pool_sales: 'pool', pool_cost: 'pool' },
          params: { p_price: 3 },
          pools: { pool_sales: 10, pool_cost: 12 },
        },
      ),
    )
    expect(out.get('r_rev')).toEqual({ invalid: false, value: 30 })
    expect(out.get('r_profit')).toEqual({ invalid: false, value: 18 })
  })

  it('order-independent: declaration order does not affect the result', () => {
    const a = evaluateRegisters(mkView([
      { id: 'r_a', expr: '@r_b + 1' },
      { id: 'r_b', expr: '2' },
    ]))
    const b = evaluateRegisters(mkView([
      { id: 'r_b', expr: '2' },
      { id: 'r_a', expr: '@r_b + 1' },
    ]))
    expect(a.get('r_a')).toEqual({ invalid: false, value: 3 })
    expect(b.get('r_a')).toEqual({ invalid: false, value: 3 })
  })

  it('a dependency cycle marks every register on it M_REG_CYCLE', () => {
    const out = evaluateRegisters(mkView([
      { id: 'r_a', expr: '@r_b + 1' },
      { id: 'r_b', expr: '@r_c + 1' },
      { id: 'r_c', expr: '@r_a + 1' },
      { id: 'r_ok', expr: '5' },
    ]))
    expect(out.get('r_a')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(out.get('r_b')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(out.get('r_c')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(out.get('r_ok')).toEqual({ invalid: false, value: 5 })
  })

  it('a self-reference is a cycle', () => {
    const out = evaluateRegisters(mkView([{ id: 'r_self', expr: '@r_self + 1' }]))
    expect(out.get('r_self')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
  })

  it('depends-on-invalid cascades', () => {
    const out = evaluateRegisters(mkView([
      { id: 'r_bad', expr: '1 / 0' },
      { id: 'r_dep', expr: '@r_bad + 1' },
      { id: 'r_dep2', expr: '@r_dep * 2' },
    ]))
    expect(out.get('r_bad')).toMatchObject({ invalid: true, code: 'M_REG_EVAL' })
    expect(out.get('r_dep')).toMatchObject({ invalid: true, code: 'M_REG_DEPENDS_ON_INVALID' })
    expect(out.get('r_dep2')).toMatchObject({ invalid: true, code: 'M_REG_DEPENDS_ON_INVALID' })
  })

  it('classifies reference errors', () => {
    const out = evaluateRegisters(
      mkView(
        [
          { id: 'r_unknown', expr: '@nope + 1' },
          { id: 'r_wrongkind', expr: '@gate_x + 1' },
          { id: 'r_parse', expr: '@a +' },
        ],
        { kinds: { gate_x: 'other' } },
      ),
    )
    expect(out.get('r_unknown')).toMatchObject({ invalid: true, code: 'M_REG_UNKNOWN_REF' })
    expect(out.get('r_wrongkind')).toMatchObject({ invalid: true, code: 'M_REG_WRONG_KIND' })
    expect(out.get('r_parse')).toMatchObject({ invalid: true, code: 'M_REG_PARSE' })
  })

  it('an invalid register does not stop the pass — others still evaluate', () => {
    const out = evaluateRegisters(mkView([
      { id: 'r_bad', expr: '@nope' },
      { id: 'r_fine', expr: '2 + 2' },
    ]))
    expect(out.get('r_bad')).toMatchObject({ invalid: true })
    expect(out.get('r_fine')).toEqual({ invalid: false, value: 4 })
  })
})
