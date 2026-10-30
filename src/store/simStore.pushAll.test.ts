import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'

// issue #419 item 2 — the push-all Source's non-Pool diagnostic travels the
// same path as every step diagnostic (#396): `simStore.diagnostics` carries it
// after the step, so the run strip's diagnostics block shows it.

const S = () => useSimStore.getState()
const G = () => useGraphStore.getState()

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  G().newGraph()
  S().reset()
})

describe('simStore — push-all Source diagnostic (#419 item 2)', () => {
  it('Source (push all) → Pool and → Drain: the Pool stays 0 and the store carries one diagnostic naming the Drain edge', () => {
    G().addNodeAt('source', { x: 0, y: 0 })
    G().addNodeAt('pool', { x: 200, y: 0 })
    G().addNodeAt('drain', { x: 200, y: 200 })
    const [s, p, d] = G().nodes.map((n) => n.id)
    G().updateNodeData(s, { mode: 'pushAll' })
    G().onConnect({ source: s, target: p, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    G().onConnect({ source: s, target: d, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    const eD = G().edges.find((e) => e.target === d)!.id
    S().reset()
    S().stepOnce()
    expect(S().values?.[p]).toBe(0)
    expect(S().diagnostics).toHaveLength(1)
    expect(S().diagnostics[0]).toContain(`Edge "${eD}"`)
    expect(S().diagnostics[0]).toContain('not a Pool')
    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1) // replaced per step, never piling up
  })
})
