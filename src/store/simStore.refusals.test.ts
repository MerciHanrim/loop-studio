import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useProjectStore } from './projectStore'
import { useSimStore } from './simStore'

// Issue #471 (Deploy 2, F1) — a Converter group whose paths split and meet
// again is refused BEFORE the run, in the store: `refusals` lists the group
// with its split and join on every simulation-relevant graph change; Play,
// Step and a Monte Carlo run do not start while it is not empty; editing the
// shape away clears it. (The run bars, the Inspector and the node outline
// read the same list.)

const g = () => useGraphStore.getState()
const byKind = (kind: string) => g().nodes.filter((n) => n.data.kind === kind).map((n) => n.id)
const connect = (source: string, target: string) =>
  g().onConnect({ source, target, sourceHandle: 'out', targetHandle: 'in' }, 'flow')

/** G4: a →(g0) ; g0 → g1, g0 → g2 ; g1 → C, g1 → y ; g2 → C ; C → x */
function buildG4() {
  const add = (kind: 'pool' | 'gate' | 'converter', i: number) => g().addNodeAt(kind, { x: i * 200, y: 0 })
  add('pool', 0) // a
  add('pool', 1) // x
  add('pool', 2) // y
  add('gate', 3) // g0
  add('gate', 4) // g1
  add('gate', 5) // g2
  add('converter', 6) // C
  const [a, x, y] = byKind('pool')
  const [g0, g1, g2] = byKind('gate')
  const [C] = byKind('converter')
  for (const [s, t] of [[a, g0], [g0, g1], [g0, g2], [g1, C], [g1, y], [g2, C], [C, x]]) expect(connect(s, t)).toEqual({ ok: true })
  return { a, x, y, g0, g1, g2, C }
}

beforeEach(() => {
  useMcStore.getState().clear()
  g().newGraph()
  useSimStore.getState().reset()
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
})

describe('simStore.refusals — a split that rejoins is refused before the run', () => {
  it('lists the group with its split and join as soon as the shape exists; the members are the four routers', () => {
    const ids = buildG4()
    const r = useSimStore.getState().refusals
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cls: 'split-rejoin', split: ids.g0, join: ids.C })
    expect([...r[0].members].sort()).toEqual([ids.C, ids.g0, ids.g1, ids.g2].sort())
    expect(useSimStore.getState().initError).toBeNull() // a refusal is not an initialisation error
  })

  it('Play and Step do not start; Reset keeps the refusal', () => {
    buildG4()
    useSimStore.getState().play()
    expect(useSimStore.getState().status).toBe('idle')
    useSimStore.getState().stepOnce()
    expect(useSimStore.getState().stepIndex).toBe(0)
    useSimStore.getState().reset()
    expect(useSimStore.getState().refusals).toHaveLength(1)
  })

  it('a Monte Carlo run does not start', async () => {
    buildG4()
    await useMcStore.getState().run()
    expect(useMcStore.getState().status).toBe('idle')
    expect(useMcStore.getState().result).toBeNull()
  })

  it('removing one of the paths clears the refusal and the run works again; the agreeing shape stays refused', () => {
    buildG4()
    // g1's branch to y removed: both paths give C the same fraction — still refused (the rule is on structure)
    const toY = g().edges.find((e) => e.source === byKind('gate')[1] && e.target === byKind('pool')[2])!
    g().removeEdge(toY.id)
    expect(useSimStore.getState().refusals).toHaveLength(1)
    // g2's path removed: one path into C — a tree, runs
    const g2ToC = g().edges.find((e) => e.source === byKind('gate')[2] && e.target === byKind('converter')[0])!
    g().removeEdge(g2ToC.id)
    expect(useSimStore.getState().refusals).toEqual([])
    useSimStore.getState().advance()
    expect(useSimStore.getState().stepIndex).toBe(1)
  })

  it('a restored Workspace snapshot of a refused graph stays refused: Step does not move it', () => {
    const ids = buildG4()
    useSimStore.getState().restoreSnapshot({
      seed: null, step: 2, ended: false, values: { [ids.a]: 7 }, fired: [], triggerQueue: [], stateEvents: [],
      series: [{ step: 0, values: { [ids.a]: 5 } }],
    })
    expect(useSimStore.getState().refusals).toHaveLength(1)
    useSimStore.getState().stepOnce()
    expect(useSimStore.getState().stepIndex).toBe(2)
  })
})
