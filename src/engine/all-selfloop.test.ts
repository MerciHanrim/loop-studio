import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// issue #471 item 5 (Lumi, 2026-11-03; the design `all-selfloop-design.md`
// rev 2, its §7 test table). Two rules, per connection and Pool:
//
//   R2  `all` on a connection with a Converter at either end is REFUSED, as a
//       percent is (#396): the connection moves 0, one diagnostic names the
//       connection and the number its flow used to mean (`1`), the document is
//       never rewritten. Everywhere else `all` keeps its one meaning, the Pool
//       as it stands (a Gate's demand, a Drain's pull).
//   G   a Pool a plan unit both takes from and delivers into is bounded ALONG
//       THE UNIT'S COMMIT ORDER: from the Pool as it stands, each take lowers
//       the level at its member's turn and each delivery raises it, and the
//       level stays within [0, capacity] at every point. One Converter takes
//       and makes inside one activation — availability on its gross take, room
//       on its net make (today's numbers); in a group an earlier member's take
//       is room a later member's delivery may fill (the routed loop S8 gets the
//       direct loop S1's numbers), a later member's take is not (S8c, S8d).
//
// Rows marked "=" are the numbers before this revision; "Δ" changed with it.
// ENGINE_REVISION 4.

const P = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode =>
  ({ id, type: 'pool', position: P, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } }) as LoopNode
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode =>
  ({ id, type: 'converter', position: P, data: { kind: 'converter', label: id, activation: 'automatic', mode } }) as LoopNode
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode =>
  ({ id, type: 'gate', position: P, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } }) as LoopNode
const source = (id: string): LoopNode =>
  ({ id, type: 'source', position: P, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } }) as LoopNode
const drain = (id: string): LoopNode =>
  ({ id, type: 'drain', position: P, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } }) as LoopNode
const res = (id: string, s: string, t: string, flow: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

/** one step from the initial state: every connection's amount (0 when it did not move), the Pools after, the diagnostics */
function run(nodes: LoopNode[], edges: LoopEdge[]) {
  const r = step(nodes, edges, initSim(nodes), 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { moved, pools: r.state.values, diagnostics: r.report.diagnostics, notices: r.report.notices }
}
const close = (got: Record<string, number>, want: Record<string, number>) => {
  for (const k of Object.keys(want)) expect(got[k], k).toBeCloseTo(want[k], 6)
}
const REFUSED = (id: string) =>
  `Edge "${id}" flow "all" is \`all\` on a Converter connection; a Converter's rate cannot be \`all\` — contributes 0 (write 1 for the rate "all" used to mean).`

describe('#471 item 5 — R2: `all` on a Converter connection is refused', () => {
  it('L1 Δ — a 100 →all C →10 x: nothing moves, a stays 100, one diagnostic names e1 and the number 1', () => {
    const r = run([pool('a', 100), conv('C'), pool('x', 0)], [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', '10')])
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { a: 100, x: 0 })
    expect(r.diagnostics).toEqual([REFUSED('e1')])
  })

  it('L2 Δ — a 100 →all C, b 100 →20 C →10 x: the Converter runs on b alone, e1 0, e2 20, o1 10; one diagnostic', () => {
    const r = run(
      [pool('a', 100), pool('b', 100), conv('C'), pool('x', 0)],
      [res('e1', 'a', 'C', 'all'), res('e2', 'b', 'C', '20'), res('o1', 'C', 'x', '10')],
    )
    close(r.moved, { e1: 0, e2: 20, o1: 10 })
    close(r.pools, { a: 100, b: 80, x: 10 })
    expect(r.diagnostics).toEqual([REFUSED('e1')])
  })

  it('L3 Δ — the output side, a 100 →20 C →all x: the only output is refused, so the Converter has no live output and does not run; the diagnostic names o1', () => {
    const r = run([pool('a', 100), conv('C'), pool('x', 0)], [res('e1', 'a', 'C', '20'), res('o1', 'C', 'x', 'all')])
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { a: 100, x: 0 })
    expect(r.diagnostics).toEqual([REFUSED('o1')])
  })

  it('L4 Δ — from a Gate, a 100 →5 g →all C →10 x: the Gate has no live branch and pulls nothing; the diagnostic names g1', () => {
    const r = run(
      [pool('a', 100), gate('g'), conv('C'), pool('x', 0)],
      [res('e1', 'a', 'g', '5'), res('g1', 'g', 'C', 'all'), res('o1', 'C', 'x', '10')],
    )
    close(r.moved, { e1: 0, g1: 0, o1: 0 })
    close(r.pools, { a: 100, x: 0 })
    expect(r.diagnostics).toEqual([REFUSED('g1')])
  })

  it('L5, L6, L7 Δ — a short Pool (0.5), an empty one, a capped output: nothing moves, one diagnostic each (L6 too: the fact is of the connection)', () => {
    for (const [a0, cap] of [
      [0.5, null],
      [0, null],
      [100, 5],
    ] as const) {
      const r = run([pool('a', a0), conv('C'), pool('x', 0, cap)], [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', '10')])
      close(r.moved, { e1: 0, o1: 0 })
      close(r.pools, { a: a0, x: 0 })
      expect(r.diagnostics).toEqual([REFUSED('e1')])
    }
  })

  it('L8 / L8r Δ — a shared Pool, a 100 →all C1 →10 x and a →60 C2 →10 y: C1 moves nothing, C2 takes 60, in either id order (no order dependence)', () => {
    for (const [allId, numId] of [
      ['C1', 'C2'],
      ['Cz', 'Ca'],
    ]) {
      const r = run(
        [pool('a', 100), conv(allId), conv(numId), pool('x', 0), pool('y', 0)],
        [res('e1', 'a', allId, 'all'), res('o1', allId, 'x', '10'), res('e2', 'a', numId, '60'), res('o2', numId, 'y', '10')],
      )
      close(r.moved, { e1: 0, o1: 0, e2: 60, o2: 10 })
      close(r.pools, { a: 40, x: 0, y: 10 })
      expect(r.diagnostics).toEqual([REFUSED('e1')])
    }
  })

  it('L9 Δ — a `pull all` Converter with the refused input moves nothing and still reports the connection', () => {
    const r = run([pool('a', 0.5), conv('C', 'pullAll'), pool('x', 0)], [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', '10')])
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { a: 0.5, x: 0 })
    expect(r.diagnostics).toEqual([REFUSED('e1')])
  })

  it('L10 Δ — `all` on both sides, a 100 →all C →all x: nothing moves, two diagnostics', () => {
    const r = run([pool('a', 100), conv('C'), pool('x', 0)], [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', 'all')])
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { a: 100, x: 0 })
    expect([...r.diagnostics].sort()).toEqual([REFUSED('e1'), REFUSED('o1')].sort())
  })

  it('L11 Δ — Converter → Converter, a 100 →20 C1 →all C2 →10 x: k1 is refused, C1 has no live output and C2 no live input, nothing moves, a stays 100, one diagnostic on k1', () => {
    const r = run(
      [pool('a', 100), conv('C1'), conv('C2'), pool('x', 0)],
      [res('e1', 'a', 'C1', '20'), res('k1', 'C1', 'C2', 'all'), res('o1', 'C2', 'x', '10')],
    )
    close(r.moved, { e1: 0, k1: 0, o1: 0 })
    close(r.pools, { a: 100, x: 0 })
    expect(r.diagnostics).toEqual([REFUSED('k1')])
  })

  it('L12 / L13 = — `all` at a Gate and at a Drain keeps its meaning, the whole Pool: 100 moves, no diagnostic', () => {
    const g = run([pool('a', 100), gate('g'), pool('x', 0)], [res('e1', 'a', 'g', 'all'), res('g1', 'g', 'x', '1')])
    close(g.moved, { e1: 100, g1: 100 })
    close(g.pools, { a: 0, x: 100 })
    expect(g.diagnostics).toEqual([])
    const d = run([pool('a', 100), drain('d')], [res('e1', 'a', 'd', 'all')])
    close(d.moved, { e1: 100 })
    close(d.pools, { a: 0 })
    expect(d.diagnostics).toEqual([])
  })

  it('the diagnostic is one per connection per step, not one per read', () => {
    const r = run([pool('a', 100), conv('C'), pool('x', 0)], [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', '10')])
    expect(r.diagnostics.filter((d) => d.includes('"e1"'))).toHaveLength(1)
  })
})

describe('#471 item 5 — G: a Pool the plan unit both takes from and delivers into', () => {
  /** P 100 of 120; C takes `need` from P and makes `make` into P */
  const loop = (p0: number, cap: number | null, need: number, make: number, mode: Mode = 'pullAny'): [LoopNode[], LoopEdge[]] => [
    [pool('P', p0, cap), conv('C', mode)],
    [res('e1', 'P', 'C', String(need)), res('o1', 'C', 'P', String(make))],
  ]

  it('S1 = — P 100/120, takes 50, makes 80: room 20 over the net 30 ⇒ f = 2/3, P ends at its cap', () => {
    const r = run(...loop(100, 120, 50, 80))
    close(r.moved, { e1: 100 / 3, o1: 160 / 3 })
    close(r.pools, { P: 120 })
    expect(r.diagnostics).toEqual([])
  })

  it('S2 = — a net-negative loop (takes 80, makes 50) has no room bound: f = 1, P 70', () => {
    const r = run(...loop(100, 120, 80, 50))
    close(r.moved, { e1: 80, o1: 50 })
    close(r.pools, { P: 70 })
  })

  it('S3 = — a full Pool with a net-zero cycle (50 → 50) runs: f = 1, P stays 100', () => {
    const r = run(...loop(100, 100, 50, 50))
    close(r.moved, { e1: 50, o1: 50 })
    close(r.pools, { P: 100 })
  })

  it('S4 = — with a second output (20 into x) the one fraction carries it too: 2/3', () => {
    const r = run([pool('P', 100, 120), conv('C'), pool('x', 0)], [res('e1', 'P', 'C', '50'), res('o1', 'C', 'P', '80'), res('o2', 'C', 'x', '20')])
    close(r.moved, { e1: 100 / 3, o1: 160 / 3, o2: 40 / 3 })
    close(r.pools, { P: 120, x: 40 / 3 })
  })

  it('S5 = — a second input (q 10 at 50) binds first: f = 0.2', () => {
    const r = run([pool('P', 100, 120), pool('q', 10), conv('C')], [res('e1', 'P', 'C', '50'), res('e2', 'q', 'C', '50'), res('o1', 'C', 'P', '80')])
    close(r.moved, { e1: 10, e2: 10, o1: 16 })
    close(r.pools, { P: 106, q: 0 })
  })

  it('S6 / S6r = — a second Converter on the same Pool is planned in id order, each seeing what the earlier left', () => {
    // C1 loops first: 2/3 (P → 120), then C2 takes 40 → P 80
    const a = run(
      [pool('P', 100, 120), conv('C1'), conv('C2'), pool('y', 0)],
      [res('e1', 'P', 'C1', '50'), res('o1', 'C1', 'P', '80'), res('e2', 'P', 'C2', '40'), res('o2', 'C2', 'y', '40')],
    )
    close(a.moved, { e1: 100 / 3, o1: 160 / 3, e2: 40, o2: 40 })
    close(a.pools, { P: 80, y: 40 })
    // ids reversed: the taker first (40 → P 60 of room 60), then the loop at f = 1 → P 90
    const b = run(
      [pool('P', 100, 120), conv('Cz'), conv('Ca'), pool('y', 0)],
      [res('e1', 'P', 'Cz', '50'), res('o1', 'Cz', 'P', '80'), res('e2', 'P', 'Ca', '40'), res('o2', 'Ca', 'y', '40')],
    )
    close(b.moved, { e2: 40, o2: 40, e1: 50, o1: 80 })
    close(b.pools, { P: 90, y: 40 })
  })

  it('S7 = — a loop cannot start from an empty Pool: availability is on the gross take', () => {
    const r = run(...loop(0, 100, 50, 80))
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { P: 0 })
  })

  it('S8 Δ — the same loop routed through a Gate, P 100/120 →50 g →50 C →80 P: the Gate takes before the Converter makes, so the group is bounded on the net as the direct loop is: 2/3, P 120 (was 1/4, P 107.5)', () => {
    const r = run([pool('P', 100, 120), gate('g'), conv('C')], [res('e1', 'P', 'g', '50'), res('g1', 'g', 'C', '50'), res('o1', 'C', 'P', '80')])
    close(r.moved, { e1: 100 / 3, g1: 100 / 3, o1: 160 / 3 })
    close(r.pools, { P: 120 })
    expect(r.diagnostics).toEqual([])
    expect(r.notices).toEqual([])
  })

  it('S8b Δ — routed through a Converter, P 100/120 →80 C1 →50 C2 →60 P: C1 takes 80 before C2 makes 60, the level never rises, f = 1, P 80 (was 1/3)', () => {
    const r = run([pool('P', 100, 120), conv('C1'), conv('C2')], [res('e1', 'P', 'C1', '80'), res('k1', 'C1', 'C2', '50'), res('o1', 'C2', 'P', '60')])
    close(r.moved, { e1: 80, k1: 50, o1: 60 })
    close(r.pools, { P: 80 })
    expect(r.notices).toEqual([])
  })

  it('S8c = — a take AFTER a delivery is not room for it: a 100 →50 g; g →10 P (115/120), g →40 C; P →50 C →20 x: the Gate delivers into P before C takes, room 5 over 0.2 T ⇒ T = 25', () => {
    const r = run(
      [pool('a', 100), gate('g'), pool('P', 115, 120), conv('C'), pool('x', 0)],
      [res('e1', 'a', 'g', '50'), res('g1', 'g', 'P', '10'), res('g2', 'g', 'C', '40'), res('e2', 'P', 'C', '50'), res('o1', 'C', 'x', '20')],
    )
    close(r.moved, { e1: 25, g1: 5, g2: 20, e2: 25, o1: 10 })
    close(r.pools, { a: 75, P: 95, x: 10 })
  })

  it('S8d = — a take by a LATER plan unit is not room either: a 100 →50 g1 →50 C1 →80 P (100/120); P →30 g2 →30 y: the group is bounded on its room 20 (f = 1/4), g2 then takes 30', () => {
    const r = run(
      [pool('a', 100), gate('g1'), conv('C1'), pool('P', 100, 120), gate('g2'), pool('y', 0)],
      [res('e1', 'a', 'g1', '50'), res('k1', 'g1', 'C1', '50'), res('o1', 'C1', 'P', '80'), res('e2', 'P', 'g2', '30'), res('g2y', 'g2', 'y', '30')],
    )
    close(r.moved, { e1: 12.5, k1: 12.5, o1: 20, e2: 30, g2y: 30 })
    close(r.pools, { a: 87.5, P: 90, y: 30 })
  })

  it('S9 / S10 = — no capacity: no room bound (f = 1, P 130); `pull all` under S1: f < 1 ⇒ nothing', () => {
    const a = run(...loop(100, null, 50, 80))
    close(a.moved, { e1: 50, o1: 80 })
    close(a.pools, { P: 130 })
    const b = run(...loop(100, 120, 50, 80, 'pullAll'))
    close(b.moved, { e1: 0, o1: 0 })
    close(b.pools, { P: 100 })
  })

  it('S11 / S12 = — a Source earlier in the order fills P to its cap and the loop finds room 0; a Drain later takes from what the loop left', () => {
    const a = run([source('s'), pool('P', 100, 120), conv('C')], [res('s1', 's', 'P', '30'), res('e1', 'P', 'C', '50'), res('o1', 'C', 'P', '80')])
    close(a.moved, { s1: 20, e1: 0, o1: 0 })
    close(a.pools, { P: 120 })
    const b = run([pool('P', 100, 120), conv('C'), drain('d')], [res('e1', 'P', 'C', '50'), res('o1', 'C', 'P', '80'), res('d1', 'P', 'd', '30')])
    close(b.moved, { e1: 100 / 3, o1: 160 / 3, d1: 30 })
    close(b.pools, { P: 90 })
  })

  it('S13 Δ — a loop whose input reads `all`, P 100/105 →all C →10 P: refused (R2), nothing moves, P 100, one diagnostic', () => {
    const r = run([pool('P', 100, 105), conv('C')], [res('e1', 'P', 'C', 'all'), res('o1', 'C', 'P', '10')])
    close(r.moved, { e1: 0, o1: 0 })
    close(r.pools, { P: 100 })
    expect(r.diagnostics).toEqual([REFUSED('e1')])
  })

  it('S14 / S15 / S16 = — 30 present over a take of 50 ⇒ 0.6; two outputs into P sum for the net ⇒ 2/3; another Converter delivering 10 into P first leaves room 10 ⇒ 1/3', () => {
    const a = run(...loop(30, 120, 50, 80))
    close(a.moved, { e1: 30, o1: 48 })
    close(a.pools, { P: 48 })
    const b = run([pool('P', 100, 120), conv('C')], [res('e1', 'P', 'C', '50'), res('o1', 'C', 'P', '30'), res('o2', 'C', 'P', '50')])
    close(b.moved, { e1: 100 / 3, o1: 20, o2: 100 / 3 })
    close(b.pools, { P: 120 })
    const c = run(
      [pool('b', 100), conv('C2'), pool('P', 100, 120), conv('Cz')],
      [res('e2', 'b', 'C2', '10'), res('o2', 'C2', 'P', '10'), res('e1', 'P', 'Cz', '50'), res('o1', 'Cz', 'P', '80')],
    )
    close(c.moved, { e2: 10, o2: 10, e1: 50 / 3, o1: 80 / 3 })
    close(c.pools, { P: 120, b: 90 })
  })

  it('M1 Δ — a multi-supply group with the loop: a 100 →50 g1 →50 G; P 100/120 →50 G (own); G →100 C →80 P. The first supply is fixed with the own supply at zero (room 20 over 0.8 of it ⇒ 25); the own supply then takes 50 from P before C delivers 60: the level ends +10 within the room ⇒ P 110', () => {
    const r = run(
      [pool('a', 100), gate('g1'), pool('P', 100, 120), gate('G'), conv('C')],
      [res('e1', 'a', 'g1', '50'), res('k1', 'g1', 'G', '50'), res('e2', 'P', 'G', '50'), res('k2', 'G', 'C', '100'), res('o1', 'C', 'P', '80')],
    )
    close(r.moved, { e1: 25, k1: 25, e2: 50, k2: 75, o1: 60 })
    close(r.pools, { a: 75, P: 110 })
    expect(r.notices).toEqual([])
  })
})
