import { describe, expect, it } from 'vitest'
import { defaultData } from './factory'
import { readRoutingPayload, routingReadIssues } from './edgeRouting'
import {
  buildSelectiveApply,
  canonicalContent,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  fieldTag,
  fullContentDigest,
  readRevisionSide,
} from './revision'
import { deserialize, serialize } from './serialize'
import type { LoopEdge, LoopNode, NodeKind } from './types'
import { semanticDigest } from './workspace'

// SEMANTICS-R10.md — the connection shapes through the reader, the file, the
// digests and the revision layer (issue #344 step 3, docs/diagram-layout.md §DL4).

function node(id: string, kind: NodeKind, x: number): LoopNode {
  const data = { ...(defaultData(kind) as unknown as Record<string, unknown>), label: id }
  return { id, type: kind, position: { x, y: 0 }, data: data as LoopNode['data'] }
}

type Shape = Record<string, unknown>

/** a flow-only graph (so the shape is the only reason for a version above /1):
 *  a resource edge `r` and a state edge `s`, each with the given routing keys */
function graph(r: Shape = {}, s: Shape = {}) {
  const nodes = [node('source', 'source', 0), node('pool', 'pool', 200), node('gate', 'gate', 400)]
  const edges: LoopEdge[] = [
    { id: 'r', type: 'loop', source: 'source', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...r } as LoopEdge['data'] },
    { id: 's', type: 'loop', source: 'pool', target: 'gate', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', ...s } as LoopEdge['data'] },
  ]
  return { nodes, edges }
}

const STRAIGHT = { route: 'straight' }
const AUTO = { route: 'orthogonal' }
const MANUAL = { route: 'orthogonal', waypoints: [{ x: 96, y: 48 }, { x: 96, y: 112 }] }

const routeOf = (e: LoopEdge | undefined) => (e?.data as { route?: unknown } | undefined)?.route
const wpOf = (e: LoopEdge | undefined) => (e?.data as { waypoints?: unknown } | undefined)?.waypoints
const roundTrip = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => deserialize(serialize(g.nodes, g.edges))

describe('the reader — §R10-1.1', () => {
  it('keeps "straight" and drops bend points beside it, with a warning', () => {
    expect(readRoutingPayload({ route: 'straight' })).toEqual({ route: 'straight' })
    const warns: string[] = []
    expect(readRoutingPayload({ route: 'straight', waypoints: [{ x: 1, y: 2 }] }, (m) => warns.push(m))).toEqual({ route: 'straight' })
    expect(warns).toEqual(['edge `waypoints` dropped — a `route: "straight"` connection takes none'])
    expect(readRoutingPayload({ route: 'straight', waypoints: [] })).toEqual({ route: 'straight' })
  })

  it('Curved stays absent, "bezier" is read as absent, an unknown value drops the payload', () => {
    expect(readRoutingPayload({})).toEqual({})
    expect(readRoutingPayload({ route: 'bezier' })).toEqual({})
    const warns: string[] = []
    expect(readRoutingPayload({ route: 'diagonal', waypoints: [{ x: 1, y: 1 }] }, (m) => warns.push(m))).toEqual({})
    expect(warns).toEqual(['edge routing dropped — unrecognised `route` value'])
    expect(routingReadIssues([{ id: 'b', data: { route: 'straight', waypoints: [{ x: 0, y: 0 }] } }, { id: 'a', data: { waypoints: [{ x: 0, y: 0 }] } }])).toEqual([
      'edge "a": edge `waypoints` dropped — no `route: "orthogonal"`',
      'edge "b": edge `waypoints` dropped — a `route: "straight"` connection takes none',
    ])
  })

  it('Auto and Manual orthogonal read as before', () => {
    expect(readRoutingPayload(AUTO)).toEqual(AUTO)
    expect(readRoutingPayload(MANUAL)).toEqual(MANUAL)
  })
})

describe('the file', () => {
  it('every shape survives a round trip on both edge kinds; Curved gains no key', () => {
    for (const shape of [{}, STRAIGHT, AUTO, MANUAL]) {
      const g = roundTrip(graph(shape, shape))
      for (const id of ['r', 's']) {
        const e = g.edges.find((x) => x.id === id)
        expect(routeOf(e), `${id} ${JSON.stringify(shape)}`).toBe((shape as { route?: unknown }).route)
        expect(wpOf(e)).toEqual((shape as { waypoints?: unknown }).waypoints)
      }
    }
    expect(serialize(graph().nodes, graph().edges)).not.toContain('"route"')
  })

  it('bend points stored beside Straight are dropped on reading, the shape kept', () => {
    const g = roundTrip(graph({ route: 'straight', waypoints: [{ x: 1, y: 2 }] }))
    const r = g.edges.find((x) => x.id === 'r')
    expect(routeOf(r)).toBe('straight')
    expect(wpOf(r)).toBeUndefined()
  })
})

describe('the digests — R10-INV-1 / R10-INV-2', () => {
  it('the engine digest is the same for every shape', async () => {
    const plain = await semanticDigest(graph())
    for (const shape of [STRAIGHT, AUTO, MANUAL]) expect(await semanticDigest(graph(shape, shape))).toBe(plain)
  })

  it('the full digest tells every shape apart and returns with the shape', async () => {
    const ds = await Promise.all([{}, STRAIGHT, AUTO, MANUAL].map((s) => fullContentDigest(graph(s))))
    expect(new Set(ds).size).toBe(4)
    expect(await fullContentDigest(graph())).toBe(ds[0])
  })

  it('a document with no straight connection projects exactly as before', () => {
    for (const shape of [{}, AUTO, MANUAL]) expect(JSON.stringify(canonicalContent(graph(shape)))).not.toContain('straight')
    const r = canonicalContent(graph(STRAIGHT)).edges.find((e) => e.id === 'r')!
    expect((r.data as Record<string, unknown>).route).toBe('straight')
    expect('waypoints' in r.data).toBe(false)
  })

  it('the literal loop-revision/1 projection never emits it', () => {
    expect(JSON.stringify(canonicalContent(graph(STRAIGHT, STRAIGHT), { modelLayer: false }))).not.toContain('route')
  })
})

describe('the revision layer — SEMANTICS-R10.md', () => {
  it('a side with a straight connection is loop-revision/10; without one it is what it was', () => {
    const straight = readRevisionSide(graph(STRAIGHT))
    expect(straight.ok && straight.version).toBe('loop-revision/10')
    const auto = readRevisionSide(graph(AUTO))
    expect(auto.ok && auto.version).toBe('loop-revision/3')
    const curved = readRevisionSide(graph())
    expect(curved.ok && curved.version).toBe('loop-revision/1')
    const invalid = readRevisionSide(graph({ route: 'diagonal' }))
    expect(invalid.ok && invalid.version).toBe('loop-revision/1')
  })

  it('a stored digest over the /10 projection verifies', () => {
    const g = graph(STRAIGHT, MANUAL)
    const side = readRevisionSide(g, digestOfCanonical(canonicalContent(g)))
    expect(side.ok && side.digestVerified).toBe(true)
  })

  it('a digest written before /10 still verifies (no straight connection, any other shape)', () => {
    for (const shape of [{}, AUTO, MANUAL]) {
      const g = graph(shape)
      const side = readRevisionSide(g, digestOfCanonical(canonicalContent(g)))
      expect(side.ok && side.digestVerified, JSON.stringify(shape)).toBe(true)
    }
  })

  it('the shape and the bend points are cosmetic fields', () => {
    expect(fieldTag('edge', 'data.route')).toBe('cosmetic')
    expect(fieldTag('edge', 'data.waypoints')).toBe('cosmetic')
  })

  it('a shape change is a real change in Review, never an engine or advisory one', () => {
    const pairs: [Shape, Shape][] = [[{}, STRAIGHT], [STRAIGHT, AUTO], [AUTO, MANUAL], [MANUAL, {}]]
    for (const [a, b] of pairs) {
      const d = computeRevisionDiff(canonicalContent(graph(a)), canonicalContent(graph(b)))
      expect(d.summary.empty, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toBe(false)
      expect(d.summary.engineAffecting).toBe(false)
      expect(d.summary.advisoryAffecting).toBe(false)
    }
  })

  it('a selective Apply moves between every pair of shapes', () => {
    const shapes: Shape[] = [{}, STRAIGHT, AUTO, MANUAL]
    for (const from of shapes) {
      for (const to of shapes) {
        if (from === to) continue
        const base = graph(from)
        const proposed = graph(to)
        const plan = computeThreeWay(canonicalContent(base), canonicalContent(base), canonicalContent(proposed))
        const hunk = plan.hunks.find((h) => h.id === 'r' && h.kind === 'change')!
        const fieldChoices = Object.fromEntries(hunk.fields!.map((f) => [f.field, 'proposed' as const]))
        const applied = buildSelectiveApply({ target: base, proposedFull: proposed, plan, selection: { accept: {}, fieldChoices: { r: fieldChoices } } })
        const label = `${JSON.stringify(from)} -> ${JSON.stringify(to)}`
        expect(applied.ok, label).toBe(true)
        if (!applied.ok) continue
        const r = applied.edges.find((e) => e.id === 'r')
        expect(routeOf(r), label).toBe((to as { route?: unknown }).route)
        expect(wpOf(r), label).toEqual((to as { waypoints?: unknown }).waypoints)
      }
    }
  })
})
