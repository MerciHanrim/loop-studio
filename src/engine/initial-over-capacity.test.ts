import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deserialize, normalizeGraph, serialize } from '../model/serialize'
import type { LoopNode } from '../model/types'
import { useGraphStore } from '../store/graphStore'
import { TEMPLATES } from '../model/templates'
import { useSimStore } from '../store/simStore'
import { initSim, step } from './index'

describe('every bundled Template still initialises under the rule', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (_id, t) => {
    expect(() => initSim(t.graph.nodes)).not.toThrow()
  })
})

// issue #406 — a Pool whose `initial` is above its `capacity`. Before the fix
// the pair travelled every path unchanged (the Inspector's commit, a file round
// trip, `initSim` at step 0) and the first step's Commit clamped the value to
// the capacity in silence: 20 at step 0, 10 from step 1, no event, no
// diagnostic. The rule now (Lumi, 2026-10-30): `initSim` REFUSES the pair
// through the existing `initError` path, naming the Pool and both numbers; the
// document keeps the pair as authored, for the user to correct. Each path
// below ends in that one message.

const pool = (initial: number, capacity: number | null): LoopNode => ({
  id: 'P',
  type: 'pool',
  position: { x: 0, y: 0 },
  data: { kind: 'pool', label: 'P', activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const REFUSED = /Pool "P" initial must be ≤ its capacity \(initial 20, capacity 10\)/

describe('a Pool with initial 20 and capacity 10 is refused at initSim (#406)', () => {
  it('initSim throws, naming the Pool, its initial and its capacity; no step runs', () => {
    expect(() => initSim([pool(20, 10)])).toThrow(REFUSED)
  })

  it('the boundary and the uncapped case are accepted: initial = capacity, and any initial with no capacity', () => {
    expect(initSim([pool(10, 10)]).values.P).toBe(10)
    expect(initSim([pool(20, null)]).values.P).toBe(20)
    // and a step leaves both where they are — the Commit clamp has nothing to do
    expect(step([pool(10, 10)], [], initSim([pool(10, 10)])).state.values.P).toBe(10)
    expect(step([pool(20, null)], [], initSim([pool(20, null)])).state.values.P).toBe(20)
  })

  it('the refusal comes after the finiteness checks, so a negative or non-finite value keeps its own message', () => {
    expect(() => initSim([pool(-5, 10)])).toThrow(/initial must be a finite number/)
    expect(() => initSim([pool(20, Number.POSITIVE_INFINITY)])).toThrow(/capacity must be a finite number/)
  })

  describe('the document keeps the pair as authored; the run refuses it the same way whichever way it arrived', () => {
    const mem = new Map<string, string>()
    beforeEach(() => {
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: (i: number) => [...mem.keys()][i] ?? null,
        get length() {
          return mem.size
        },
      })
      vi.useFakeTimers()
      useGraphStore.getState().newGraph()
      useSimStore.getState().reset()
      vi.runAllTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })
    const poolData = () => useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.data as { initial: number; capacity: number | null }
    const withLabelP = (re: RegExp) => new RegExp(re.source.replace('"P"', '"[^"]*"'))

    it('typed in the Inspector: capacity 10 then initial 20 (or the reverse) is stored as typed and initError names it; a fix clears it', () => {
      useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
      const id = useGraphStore.getState().nodes[0].id
      useGraphStore.getState().updateNodeData(id, { capacity: 10 })
      expect(useSimStore.getState().initError).toBeNull()
      useGraphStore.getState().updateNodeData(id, { initial: 20 })
      expect([poolData().initial, poolData().capacity]).toEqual([20, 10])
      expect(useSimStore.getState().initError).toMatch(withLabelP(REFUSED))
      expect(useSimStore.getState().values).toEqual({}) // an empty head, never stale values
      // the other order: initial first, then a capacity below it
      useGraphStore.getState().updateNodeData(id, { capacity: null })
      expect(useSimStore.getState().initError).toBeNull()
      useGraphStore.getState().updateNodeData(id, { capacity: 10 })
      expect(useSimStore.getState().initError).toMatch(withLabelP(REFUSED))
      // raising the capacity to the initial clears it; so would lowering the initial
      useGraphStore.getState().updateNodeData(id, { capacity: 20 })
      expect(useSimStore.getState().initError).toBeNull()
      expect(useSimStore.getState().values).toEqual({ [id]: 20 })
    })

    it('loaded from a file: the pair survives the round trip unchanged and the loaded document is refused with the same message', () => {
      const text = serialize([pool(20, 10)], [])
      const back = deserialize(text)
      expect([back.nodes[0].data, normalizeGraph({ nodes: back.nodes, edges: [] }).nodes[0].data]).toMatchObject([
        { initial: 20, capacity: 10 },
        { initial: 20, capacity: 10 },
      ])
      useGraphStore.getState().loadJSON(text)
      expect([poolData().initial, poolData().capacity]).toEqual([20, 10]) // nothing corrected on load
      expect(useSimStore.getState().initError).toMatch(REFUSED)
      useSimStore.getState().play()
      expect(useSimStore.getState().status).toBe('idle')
      useSimStore.getState().stepOnce()
      expect(useSimStore.getState().stepIndex).toBe(0)
    })
  })
})
