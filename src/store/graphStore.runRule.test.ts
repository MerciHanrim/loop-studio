import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { deserialize, serialize } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// SEMANTICS-M6.md §M6-9 — a rule set from the Inspector: a document only ever holds one
// that reads, the first promotes the version, and undo takes both back.

const S = () => useGraphStore.getState()
const RULE = { tank: 'p', level: '10', band: '5', side: 'fill' } as const

let stage = ''
const runOf = () => (S().nodes.find((n) => n.id === stage)!.data as { run?: unknown }).run
const hasKey = () => 'run' in S().nodes.find((n) => n.id === stage)!.data

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T00:00:00Z'))
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
  S().addNodeAt('converter', { x: 0, y: 0 })
  stage = S().nodes[S().nodes.length - 1]!.id
  vi.advanceTimersByTime(1000)
})
afterEach(() => vi.useRealTimers())

describe('setRunRule', () => {
  it('sets a rule, promotes the document, and restarts the run', () => {
    const before = S().modelVersion
    expect(before).toBeLessThan(6)
    const rev = S().simulationRev
    S().setRunRule(stage, RULE)
    expect(runOf()).toEqual(RULE)
    expect(S().modelVersion).toBe(6)
    expect(S().simulationRev).toBe(rev + 1)
  })

  it('removes the key, and leaves the version where it is', () => {
    S().setRunRule(stage, RULE)
    S().setRunRule(stage, null)
    expect(hasKey()).toBe(false)
    expect(S().modelVersion).toBe(6)
  })

  it('one undo takes the rule and the version back together', () => {
    const before = S().modelVersion
    S().setRunRule(stage, RULE)
    S().undo()
    expect(hasKey()).toBe(false)
    expect(S().modelVersion).toBe(before)
  })

  it('a field is one undo entry, and a different field another, however soon', () => {
    S().setRunRule(stage, RULE)
    vi.advanceTimersByTime(1000)
    const past = S().past.length
    S().setRunRule(stage, { ...RULE, level: '11' })
    S().setRunRule(stage, { ...RULE, level: '12' })
    expect(S().past.length).toBe(past + 1)
    S().setRunRule(stage, { ...RULE, level: '12', band: '6' })
    expect(S().past.length).toBe(past + 2)
  })

  it('the same rule changes nothing', () => {
    S().setRunRule(stage, RULE)
    const past = S().past.length
    const rev = S().simulationRev
    S().setRunRule(stage, { ...RULE })
    expect(S().past.length).toBe(past)
    expect(S().simulationRev).toBe(rev)
  })

  it('holds no rule on what is no Converter', () => {
    S().addNodeAt('pool', { x: 200, y: 0 })
    const pool = S().nodes[S().nodes.length - 1]!.id
    S().setRunRule(pool, RULE)
    expect(S().nodes.find((n) => n.id === pool)!.data).not.toHaveProperty('run')
  })

  it('is refused under the edit lock', () => {
    useUiStore.getState().setCanvasLocked(true)
    S().setRunRule(stage, RULE)
    expect(hasKey()).toBe(false)
  })

  it('a Pool’s unit change and its rules are one undo entry', () => {
    S().addNodeAt('pool', { x: 200, y: 0 })
    const pool = S().nodes[S().nodes.length - 1]!.id
    S().setRunRule(stage, { ...RULE, tank: pool })
    vi.advanceTimersByTime(1000)
    const past = S().past.length
    S().changePoolUnit(pool, { unit: 'L', initial: 0 }, [{ stage, rule: { ...RULE, tank: pool, level: '10000', band: '5000' } }])
    expect(S().past.length).toBe(past + 1)
    expect(runOf()).toEqual({ ...RULE, tank: pool, level: '10000', band: '5000' })
    S().undo()
    expect(runOf()).toEqual({ ...RULE, tank: pool })
    expect(S().nodes.find((n) => n.id === pool)!.data).not.toHaveProperty('unit', 'L')
  })

  it('a rule made here goes through the file and comes back the same', () => {
    S().setRunRule(stage, RULE)
    const { nodes, edges, modelVersion } = S()
    const text = serialize(nodes, edges, undefined, undefined, undefined, modelVersion)
    expect(JSON.parse(text).schema).toBe('loop-studio/graph/6')
    expect((deserialize(text).nodes.find((n) => n.id === stage)!.data as { run?: unknown }).run).toEqual(RULE)
  })
})
