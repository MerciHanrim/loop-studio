import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'

// issue #396 (Lumi, 2026-10-30) — the engine's step diagnostics reach the
// store: `simStore.diagnostics` is the deduplicated `StepReport.diagnostics`
// of the step that produced the current head, replaced on every committed
// step (never accumulated) and emptied by Reset, by a document change and by
// a clean step. The refused percent on a Converter connection is the case.

const S = () => useSimStore.getState()
const G = () => useGraphStore.getState()

/** Pool A (8) ─flow→ Converter C ─1→ Pool B; returns the edge ids */
function seed(flowIn: string) {
  G().newGraph()
  G().addNodeAt('pool', { x: 0, y: 0 })
  G().addNodeAt('converter', { x: 200, y: 0 })
  G().addNodeAt('pool', { x: 400, y: 0 })
  const [a, c, b] = G().nodes.map((n) => n.id)
  G().updateNodeData(a, { initial: 8 })
  G().onConnect({ source: a, target: c, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  G().onConnect({ source: c, target: b, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  const [e1, e2] = G().edges.map((e) => e.id)
  G().setEdgeData(e1, { kind: 'resource', flow: flowIn })
  G().setEdgeData(e2, { kind: 'resource', flow: '1' })
  S().reset()
  return { a, b, c, e1, e2 }
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  G().newGraph()
  S().reset()
})

describe('simStore.diagnostics (#396)', () => {
  it('a step with a refused percent on a Converter input carries ONE diagnostic naming the connection, the expression and the number that keeps the old rate', () => {
    const { e1 } = seed('50%')
    expect(S().diagnostics).toEqual([])
    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1)
    expect(S().diagnostics[0]).toContain(`Edge "${e1}" flow "50%"`)
    expect(S().diagnostics[0]).toContain('write 0.5')
  })

  it('the next step REPLACES the set — the same diagnostic does not pile up step after step', () => {
    seed('50%')
    S().stepOnce()
    S().stepOnce()
    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1)
    expect(S().stepIndex).toBe(3)
  })

  it('Reset empties it; so does a document change (new graph); a clean step leaves none', () => {
    seed('50%')
    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1)
    S().reset()
    expect(S().diagnostics).toEqual([])

    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1)
    G().newGraph() // a document boundary: the sim resets through the graph subscription
    expect(S().diagnostics).toEqual([])

    seed('0.5') // the number the diagnostic named
    S().stepOnce()
    expect(S().diagnostics).toEqual([])
    expect(S().values?.[G().nodes[0].id]).toBeCloseTo(7.5, 9)
  })

  it('an edit that lifts the refusal mid-run clears it on the next step, not before', () => {
    const { e1 } = seed('50%')
    S().stepOnce()
    expect(S().diagnostics).toHaveLength(1)
    G().setEdgeData(e1, { kind: 'resource', flow: '0.5' }) // a graph edit resets the sim (simulationRev)
    expect(S().diagnostics).toEqual([])
    S().stepOnce()
    expect(S().diagnostics).toEqual([])
  })
})
