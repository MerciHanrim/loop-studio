import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'

// issue #419 item 1 (Lumi, 2026-10-30) — Play at `ended` is a no-op: the status
// stays `ended`, the step and the values stay. The run bars' Replay is
// unchanged: Reset first, then Play. Before: `play()` set `running` before the
// loop's `ended` guard ran, and `head()` derived `ended` from the status, so
// the economy was stepped past the End.

const S = () => useSimStore.getState()
const G = () => useGraphStore.getState()

/** Pool Q (100) ─10→ End; returns the Pool id */
function seed() {
  G().newGraph()
  G().addNodeAt('pool', { x: 0, y: 0 })
  G().addNodeAt('end', { x: 200, y: 0 })
  const [q, e] = G().nodes.map((n) => n.id)
  G().updateNodeData(q, { initial: 100 })
  G().onConnect({ source: q, target: e, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  G().setEdgeData(G().edges[0].id, { kind: 'resource', flow: '10' })
  S().reset()
  return q
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  G().newGraph()
  S().reset()
})

describe('simStore — Play after ended (#419 item 1)', () => {
  it('the first step ends the run', () => {
    const q = seed()
    S().stepOnce()
    expect(S().status).toBe('ended')
    expect(S().stepIndex).toBe(1)
    expect(S().values?.[q]).toBe(90)
  })

  it('play() at ended is a no-op: status, step and values stay; so does a Step', () => {
    const q = seed()
    S().stepOnce()
    S().play()
    expect(S().status).toBe('ended')
    expect(S().stepIndex).toBe(1)
    expect(S().values?.[q]).toBe(90)
    expect(S().activeTransitionId).toBeNull()
    S().stepOnce()
    expect(S().stepIndex).toBe(1)
    expect(S().values?.[q]).toBe(90)
  })

  it('Replay (Reset, then Play) still starts a run from step 0', () => {
    const q = seed()
    S().stepOnce()
    expect(S().status).toBe('ended')
    S().reset()
    S().play()
    expect(S().status).toBe('running')
    expect(S().stepIndex).toBe(0)
    expect(S().values?.[q]).toBe(100)
    S().pause()
    expect(S().status).toBe('paused')
  })
})
