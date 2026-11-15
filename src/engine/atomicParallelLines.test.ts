import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Whole-code review of 2026-11-15, findings E3 and E4: two rules outside the
// plans that looked at one line, or one node too many.
//
// E3 — SEMANTICS.md §9: a `pull all` node "moves 0 from every edge" when it
// "cannot pull every input edge in full"; "`push all` is the Source mirror:
// full push on every outgoing edge, or nothing". Each line was tested against
// the whole Pool (or the whole room), so two lines between the same pair passed
// one by one: a `pull all` Drain with two "5" lines off a Pool of 8 reported
// 5 + 5 = 10 taken while the Pool lost 8, and a `push all` Source with two "5"
// lines into a room of 8 pushed 5 + 3. (Drawing refuses a second line between
// the same pair; a document can hold one.)
//
// E4 — SEMANTICS.md §6: "A cycle among these zero-storage nodes with no Pool
// in it is ill-defined — every edge on such a cycle is treated as flow 0". The
// order's leftovers were taken as the cycle, and a router DOWNSTREAM of a cycle
// is a leftover too: Gates A ⇄ B, B → C, Pool P → C → Q had C reported on the
// cycle and P → C moved nothing.

const P0 = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const gate = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const source = (id: string, mode: 'pushAny' | 'pushAll'): LoopNode => ({ id, type: 'source', position: P0, data: { kind: 'source', label: id, activation: 'automatic', mode } as LoopNode['data'] })
const drain = (id: string, mode: 'pullAny' | 'pullAll'): LoopNode => ({ id, type: 'drain', position: P0, data: { kind: 'drain', label: id, activation: 'automatic', mode } as LoopNode['data'] })
const end = (id: string, mode: 'pullAny' | 'pullAll'): LoopNode => ({ id, type: 'end', position: P0, data: { kind: 'end', label: id, activation: 'automatic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

function run(nodes: LoopNode[], edges: LoopEdge[]) {
  const before = initSim(nodes)
  const r = step(nodes, edges, before, 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { moved, after: r.state.values, gates: r.report.gates, diagnostics: r.report.diagnostics, ended: r.state.ended }
}

describe('`pull all` / `push all` with two lines between the same pair: all of them or nothing (E3)', () => {
  it('a `pull all` Drain, two "5" lines off a Pool of 8: nothing (was: events 5 + 5, the Pool lost 8)', () => {
    const r = run([pool('P', 8), drain('D', 'pullAll')], [res('a', 'P', 'D', '5'), res('b', 'P', 'D', '5')])
    expect(r.moved).toEqual({ a: 0, b: 0 })
    expect(r.after).toEqual({ P: 8 })
  })
  it('the same Drain with the Pool at 10: 5 + 5', () => {
    const r = run([pool('P', 10), drain('D', 'pullAll')], [res('a', 'P', 'D', '5'), res('b', 'P', 'D', '5')])
    expect(r.moved).toEqual({ a: 5, b: 5 })
    expect(r.after).toEqual({ P: 0 })
  })
  it('a `pull any` Drain on the Pool of 8: 5 + 3 (unchanged)', () => {
    const r = run([pool('P', 8), drain('D', 'pullAny')], [res('a', 'P', 'D', '5'), res('b', 'P', 'D', '5')])
    expect(r.moved).toEqual({ a: 5, b: 3 })
    expect(r.after).toEqual({ P: 0 })
  })
  it('a `pull all` Drain on two Pools, one short: nothing (unchanged)', () => {
    const r = run([pool('P', 8), pool('R', 2), drain('D', 'pullAll')], [res('a', 'P', 'D', '5'), res('b', 'R', 'D', '5')])
    expect(r.moved).toEqual({ a: 0, b: 0 })
  })
  it('a `pull all` End, two "5" lines off a Pool of 8: nothing, and the run does not end', () => {
    const r = run([pool('P', 8), end('E', 'pullAll')], [res('a', 'P', 'E', '5'), res('b', 'P', 'E', '5')])
    expect(r.moved).toEqual({ a: 0, b: 0 })
    expect(r.after).toEqual({ P: 8 })
    expect(r.ended).toBeFalsy()
  })
  it('a `push all` Source, two "5" lines into a room of 8: nothing (was: 5 + 3)', () => {
    const r = run([source('S', 'pushAll'), pool('P', 0, 8)], [res('a', 'S', 'P', '5'), res('b', 'S', 'P', '5')])
    expect(r.moved).toEqual({ a: 0, b: 0 })
    expect(r.after).toEqual({ P: 0 })
  })
  it('the same Source with a room of 10: 5 + 5', () => {
    const r = run([source('S', 'pushAll'), pool('P', 0, 10)], [res('a', 'S', 'P', '5'), res('b', 'S', 'P', '5')])
    expect(r.moved).toEqual({ a: 5, b: 5 })
  })
  it('a `push any` Source into the room of 8: 5 + 3 (unchanged)', () => {
    const r = run([source('S', 'pushAny'), pool('P', 0, 8)], [res('a', 'S', 'P', '5'), res('b', 'S', 'P', '5')])
    expect(r.moved).toEqual({ a: 5, b: 3 })
  })
})

describe('a router downstream of a zero-storage cycle is not on it (E4)', () => {
  const cycle = [gate('A'), gate('B')]
  const loop = [res('ab', 'A', 'B', '1'), res('ba', 'B', 'A', '1')]
  it('Gates A ⇄ B, B → C, Pool P →"5"→ C → Q: C takes its 5 (was: C on the cycle, nothing moved)', () => {
    const r = run([...cycle, gate('C'), pool('P', 10), pool('Q', 0)], [...loop, res('bc', 'B', 'C', '1'), res('pc', 'P', 'C', '5'), res('cq', 'C', 'Q', '1')])
    expect(r.moved).toEqual({ ab: 0, ba: 0, bc: 0, pc: 5, cq: 5 })
    expect(r.after).toEqual({ P: 5, Q: 5 })
    const g = (id: string) => r.gates.find((x) => x.nodeId === id)!
    expect({ state: g('A').state, why: g('A').why }).toEqual({ state: 'fault', why: 'cycle' })
    expect({ state: g('B').state, why: g('B').why }).toEqual({ state: 'fault', why: 'cycle' })
    expect({ state: g('C').state, moved: g('C').moved }).toEqual({ state: 'full', moved: 5 })
    // the notice counts the routers ON the cycle
    expect(r.diagnostics.filter((d) => /zero-storage cycle/.test(d))).toEqual([expect.stringMatching(/^2 router node\(s\)/)])
  })
  it('a chain below the cycle: C → D → Q all run', () => {
    const r = run([...cycle, gate('C'), gate('D'), pool('P', 10), pool('Q', 0)], [...loop, res('bc', 'B', 'C', '1'), res('pc', 'P', 'C', '5'), res('cd', 'C', 'D', '1'), res('dq', 'D', 'Q', '1')])
    expect(r.moved).toMatchObject({ pc: 5, cd: 5, dq: 5, bc: 0 })
    expect(r.after).toEqual({ P: 5, Q: 5 })
  })
  it('a router ON the cycle keeps every connection dead, its Pool line too (unchanged)', () => {
    const r = run([...cycle, pool('P', 10), pool('Q', 0)], [...loop, res('pa', 'P', 'A', '5'), res('aq', 'A', 'Q', '1')])
    expect(r.moved).toEqual({ ab: 0, ba: 0, pa: 0, aq: 0 })
    expect(r.after).toEqual({ P: 10, Q: 0 })
  })
  it('a Gate between two cycles is on neither: its Pool line runs into its live branch', () => {
    // A ⇄ B → X → M ⇄ N ; P → X → Q. X's branch into M is dead (M is on a cycle)
    const r = run(
      [gate('A'), gate('B'), gate('M'), gate('N'), gate('X'), pool('P', 10), pool('Q', 0)],
      [...loop, res('mn', 'M', 'N', '1'), res('nm', 'N', 'M', '1'), res('bx', 'B', 'X', '1'), res('xm', 'X', 'M', '1'), res('px', 'P', 'X', '4'), res('xq', 'X', 'Q', '1')],
    )
    expect(r.moved).toMatchObject({ px: 4, xq: 4, bx: 0, xm: 0 })
    expect(r.diagnostics.filter((d) => /zero-storage cycle/.test(d))).toEqual([expect.stringMatching(/^4 router node\(s\)/)])
  })
  it('two separate cycles and a Gate below both', () => {
    const r = run(
      [gate('A'), gate('B'), gate('M'), gate('N'), gate('Z'), pool('P', 10), pool('Q', 0)],
      [...loop, res('mn', 'M', 'N', '1'), res('nm', 'N', 'M', '1'), res('bz', 'B', 'Z', '1'), res('nz', 'N', 'Z', '1'), res('pz', 'P', 'Z', '4'), res('zq', 'Z', 'Q', '1')],
    )
    expect(r.moved).toMatchObject({ pz: 4, zq: 4, bz: 0, nz: 0 })
    expect(r.diagnostics.filter((d) => /zero-storage cycle/.test(d))).toEqual([expect.stringMatching(/^4 router node\(s\)/)])
  })
})
