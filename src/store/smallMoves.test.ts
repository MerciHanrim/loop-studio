import { describe, expect, it } from 'vitest'
import type { StepMove } from '../engine'
import { initSim, step } from '../engine'
import { add, exactDouble, fromInt, sub } from '../model/rational'
import type { LoopEdge, LoopNode } from '../model/types'
import { recordAmountText, type FieldUnit } from '../model/units'
import { amountOf, NO_SMALL_MOVES, smallMovesOf } from './smallMoves'

// SEMANTICS-E.md §E17 — what the interface reads of a step's moves that are not shown: which
// they are, and the exact net change of each Pool one of them reached.

const move = (edgeId: string, from: string, to: string, num: string, den: string, shown: number): StepMove => ({ edgeId, from, to, num, den, shown })
const isPool = (id: string) => id.startsWith('p')

describe('smallMovesOf', () => {
  it('a step whose every move is shown has none, and the one empty value', () => {
    expect(smallMovesOf([move('a', 'p1', 'g', '3', '1', 3), move('b', 'g', 'p2', '3', '1', 3)], isPool)).toBe(NO_SMALL_MOVES)
    expect(smallMovesOf([], isPool)).toBe(NO_SMALL_MOVES)
    expect(smallMovesOf(undefined, isPool)).toBe(NO_SMALL_MOVES)
  })

  it('a move at the display threshold is not shown; one just above it is', () => {
    const at = smallMovesOf([move('a', 's', 'p1', '1', '1000000000', 1e-9)], isPool)
    expect(at.moves.map((m) => m.edgeId)).toEqual(['a'])
    expect(smallMovesOf([move('a', 's', 'p1', '1000000001', '1000000000000000000', 1.000000001e-9)], isPool)).toBe(NO_SMALL_MOVES)
  })

  it('keeps the moves that are not shown in the record`s order, and nets each Pool they reached over ALL the step`s moves', () => {
    const moves = [
      move('big', 'p1', 'g', '2', '1', 2), // shown, out of p1
      move('small', 'p1', 'd', '1', '2000000000', 5e-10), // not shown, out of p1
      move('on', 'g', 'p2', '2', '1', 2), // shown, into p2: p2 is reached by no small move
      move('in', 's', 'p3', '1', '4000000000', 2.5e-10), // not shown, into p3
    ]
    const r = smallMovesOf(moves, isPool)
    expect(r.moves.map((m) => m.edgeId)).toEqual(['small', 'in'])
    expect(Object.keys(r.netByPool).sort()).toEqual(['p1', 'p3'])
    // p1: −2 − 1/2000000000, exactly
    expect(r.netByPool.p1).toEqual({ num: '-4000000001', den: '2000000000' })
    expect(r.netByPool.p3).toEqual({ num: '1', den: '4000000000' })
  })

  it('a net of 0 is kept as 0 (a small move in and the same out)', () => {
    const r = smallMovesOf([move('in', 's', 'p1', '1', '2000000000', 5e-10), move('out', 'p1', 'd', '1', '2000000000', 5e-10)], isPool)
    expect(r.netByPool.p1).toEqual({ num: '0', den: '1' })
  })
})

describe('from a real step', () => {
  const XY = { x: 0, y: 0 }
  const pool = (id: string, initial: number): LoopNode => ({ id, type: 'pool', position: XY, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } })
  const drain = (id: string): LoopNode => ({ id, type: 'drain', position: XY, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } })
  const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

  it('a Drain that takes 5e-10 beside one that takes 2: one move not shown, and the Pool`s net is both', () => {
    const nodes = [pool('p', 10), drain('d1'), drain('d2')]
    const edges = [res('small', 'p', 'd1', '0.0000000005'), res('big', 'p', 'd2', '2')]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(r.report.events.map((e) => e.edgeId)).toEqual(['big'])
    const s = smallMovesOf(r.report.moves, (id) => id === 'p')
    expect(s.moves.map((m) => [m.edgeId, m.from, m.to])).toEqual([['small', 'p', 'd1']])
    // what a Drain takes is its line's engine value, the double of 5e-10 read exactly
    // (SEMANTICS-E.md §E1): the net is −(2 + that double), as one fraction
    const want = sub(fromInt(0), add(fromInt(2), exactDouble(5e-10)))
    expect(s.netByPool).toEqual({ p: { num: String(want.num), den: String(want.den) } })
    expect(recordAmountText(amountOf(s.moves[0]), { kind: 'base' }, undefined)).toBe('≈ 0.0000000005')
  })
})

describe('recordAmountText', () => {
  const base: FieldUnit = { kind: 'base' }
  const litres: FieldUnit = { kind: 'amount', unit: { name: 'L', factor: '0.001' } }

  it('prints an amount under the display threshold in full digits, never as 0', () => {
    expect(recordAmountText(amountOf({ num: '1', den: '2000000000' }), base, undefined)).toBe('0.0000000005')
  })

  it('says ≈ where 15 digits are not the amount', () => {
    expect(recordAmountText(amountOf({ num: '1', den: '8640000000' }), base, undefined)).toBe('≈ 0.000000000115740740740741')
  })

  it('prints in the Pool`s unit with the unit after it, and in the view unit while one is on', () => {
    expect(recordAmountText(amountOf({ num: '1', den: '2000000000' }), litres, undefined)).toBe('0.0000005 L')
    expect(recordAmountText(amountOf({ num: '1', den: '2000000000' }), base, undefined, litres)).toBe('0.0000005 L')
  })
})
