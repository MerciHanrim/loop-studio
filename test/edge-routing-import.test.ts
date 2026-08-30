import { describe, expect, it } from 'vitest'
import {
  buildSelectiveApply,
  canonicalContent,
  computeThreeWay,
  digestOfCanonical,
  readProject,
  readRevisionSide,
} from '../src/model/revision'
import { routingReadIssues } from '../src/model/edgeRouting'
import { deserialize, normalizeGraph, serialize } from '../src/model/serialize'
import { decodeShareText, encodeShareText } from '../src/model/share'
import { buildWorkspacePayload, readWorkspace } from '../src/model/workspace'
import { initSim, step } from '../src/engine/step'
import { initialPoolValues } from '../src/model/model'
import type { LoopEdge, LoopNode } from '../src/model/types'

// SEMANTICS-R3.md §R3-1.1 / §R3-7 / §R3-8 — a malformed routing payload is a
// routing-only quarantine through EVERY real import path, and a valid
// `waypoints` value round-trips losslessly through every transport. Slice 1
// has no waypoint editor, but an existing waypoint file is fully supported.

const node = (id: string, type: LoopNode['type'], x: number, data: Record<string, unknown>): LoopNode =>
  ({ id, type, position: { x, y: 0 }, data } as LoopNode)
const rEdge = (id: string, s: string, t: string, extra: Record<string, unknown> = {}): LoopEdge =>
  ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...extra } } as LoopEdge)

const NODES: LoopNode[] = [
  node('n_src', 'source', 0, { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' }),
  node('n_gold', 'pool', 200, { kind: 'pool', label: 'Gold', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny', resourceType: 'Gold' }),
  node('n_sink', 'drain', 400, { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' }),
]

/** three broken routing payloads + one good one; every engine/advisory field
 *  present so we can assert it survives. */
const BROKEN_EDGES: LoopEdge[] = [
  rEdge('e_a', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold', route: 'orthogonal', waypoints: Array.from({ length: 65 }, (_, i) => ({ x: i, y: 0 })) }),
  rEdge('e_b', 'n_gold', 'n_sink', { flow: '5', route: 'orthogonal', waypoints: [{ x: 1, y: Number.NaN }] }),
  rEdge('e_c', 'n_gold', 'n_sink', { flow: '9', route: 'diagonal' as unknown as string }),
  rEdge('e_d', 'n_src', 'n_gold', { flow: '4', waypoints: [{ x: 1, y: 1 }] }), // waypoints, route absent
]

const graphFile = (nodes: LoopNode[], edges: LoopEdge[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges, ...extra })

describe('edge routing — malformed payload quarantine through real import paths (§R3-1.1)', () => {
  it('Graph JSON import — every routing pair dropped, every semantic field + the edge kept', () => {
    const g = deserialize(graphFile(NODES, BROKEN_EDGES))
    expect(g.edges.map((e) => e.id).sort()).toEqual(['e_a', 'e_b', 'e_c', 'e_d'])
    for (const e of g.edges) {
      expect((e.data as { route?: unknown }).route).toBeUndefined()
      expect((e.data as { waypoints?: unknown }).waypoints).toBeUndefined()
    }
    const by = Object.fromEntries(g.edges.map((e) => [e.id, e.data as Record<string, unknown>]))
    expect(by.e_a).toMatchObject({ kind: 'resource', flow: '2', resourceType: 'Gold' })
    expect(by.e_b).toMatchObject({ kind: 'resource', flow: '5' })
    expect(by.e_c).toMatchObject({ kind: 'resource', flow: '9' })
    expect(by.e_d).toMatchObject({ kind: 'resource', flow: '4' })
  })

  it('the import warning list is one entry per broken edge, sorted by edge id', () => {
    const issues = routingReadIssues(BROKEN_EDGES as unknown as { id: string; data: unknown }[])
    expect(issues.map((s) => s.match(/"([^"]+)"/)?.[1])).toEqual(['e_a', 'e_b', 'e_c', 'e_d'])
  })

  it('a plain (valid) Graph import still opens and runs', () => {
    const clean = deserialize(graphFile(NODES, [rEdge('e', 'n_src', 'n_gold', { flow: '2' })]))
    let st = initSim(clean.nodes)
    st = step(clean.nodes, clean.edges, st).state
    st = step(clean.nodes, clean.edges, st).state
    expect(st.step).toBe(2)
  })

  it('Workspace import — the embedded GraphDoc is quarantined; the workspace payload has no routing field and still restores', () => {
    const n = normalizeGraph({ nodes: NODES, edges: [rEdge('e', 'n_src', 'n_gold', { flow: '2', route: 'orthogonal', waypoints: [{ x: 1, y: 1 }] })] })
    let sim = initSim(n.nodes)
    sim = step(n.nodes, n.edges, sim).state
    const payload = buildWorkspacePayload({
      mc: { config: { baseSeed: 1, runs: 1, steps: 1, tracked: [] }, stale: false },
      view: { timeline: 'live', distributionPoolId: null, showMean: false },
      canvas: { x: 0, y: 0, zoom: 1 },
      simulation: {
        seed: 1, step: sim.step, ended: false, values: sim.values,
        fired: sim.fired ?? [], triggerQueue: sim.triggerQueue ?? [], stateEvents: [],
        series: [{ step: 0, values: initialPoolValues(n.nodes) }, { step: sim.step, values: sim.values }],
      },
    })
    // hand-break the routing on the embedded edge, then round-trip the file
    const broken = JSON.parse(serialize(n.nodes, n.edges, undefined, payload)) as Record<string, unknown>
    ;(broken.edges as LoopEdge[])[0].data = { kind: 'resource', flow: '2', route: 'orthogonal', waypoints: 'nope' as unknown as [] }
    const g = deserialize(JSON.stringify(broken))
    expect((g.edges[0].data as { route?: unknown }).route).toBeUndefined()
    expect((g.edges[0].data as { waypoints?: unknown }).waypoints).toBeUndefined()
    expect(g.edges[0].data.flow).toBe('2')
    expect(JSON.stringify(g.workspace)).not.toMatch(/"route"|"waypoints"/)
    const { restored } = readWorkspace(g.workspace, { nodes: g.nodes, edges: g.edges }, 'x')
    expect(restored?.simulation?.step).toBe(sim.step)
  })

  it('Project revision — header digest is checked against the QUARANTINED GraphDoc', () => {
    const quarantined = canonicalContent({ nodes: NODES, edges: BROKEN_EDGES })
    const goodHeader = {
      schema: 'loop-revision/1', version: 1,
      projectId: 'proj_' + '0'.repeat(26), revisionId: 'rev_' + '1'.repeat(26),
      parentId: null, role: 'revision', lineage: [],
      contentDigest: digestOfCanonical(quarantined),
    }
    expect(readProject(goodHeader, quarantined).ok).toBe(true)
    // a digest that matched the PRE-quarantine bytes ⇒ dropped, graph loads alone
    const staleHeader = { ...goodHeader, contentDigest: 'b'.repeat(64) }
    const dropped = readProject(staleHeader, quarantined)
    expect(dropped.ok).toBe(false)
    // the side itself infers v2 — nothing v3 survived the quarantine
    expect((readRevisionSide({ nodes: NODES, edges: BROKEN_EDGES }) as { version?: string }).version).toBe('loop-revision/2')
  })

  it('Proposal — `base.content` and proposed content are quarantined + digest-checked INDEPENDENTLY', () => {
    const quarantinedProposed = canonicalContent({ nodes: NODES, edges: BROKEN_EDGES })
    const base = {
      revisionId: 'rev_' + '2'.repeat(26),
      contentDigest: digestOfCanonical(canonicalContent({ nodes: NODES, edges: [rEdge('e', 'n_src', 'n_gold', { flow: '2' })] })),
      content: canonicalContent({ nodes: NODES, edges: [rEdge('e', 'n_src', 'n_gold', { flow: '2' })] }),
    }
    const proposal = {
      schema: 'loop-revision/1', version: 1,
      projectId: 'proj_' + '0'.repeat(26), revisionId: 'rev_' + '3'.repeat(26),
      parentId: base.revisionId, role: 'proposal', lineage: [base.revisionId],
      contentDigest: digestOfCanonical(quarantinedProposed),
      base,
    }
    expect(readProject(proposal, quarantinedProposed).ok).toBe(true)
    // break ONLY base.contentDigest ⇒ the whole proposal is dropped
    const badBase = { ...proposal, base: { ...base, contentDigest: 'c'.repeat(64) } }
    expect(readProject(badBase, quarantinedProposed).ok).toBe(false)
    // break ONLY the top-level (proposed) digest ⇒ also dropped, independently
    const badProposed = { ...proposal, contentDigest: 'd'.repeat(64) }
    expect(readProject(badProposed, quarantinedProposed).ok).toBe(false)
  })
})

// ── §R3-7 / §R3-8 — a valid `waypoints` value round-trips losslessly ──────
const WP = [
  { x: -12.5, y: 0.100000001 },
  { x: -12.5, y: 88.25 },
  { x: -12.5, y: 88.25 }, // duplicate — kept on the wire
  { x: 140, y: 88.25 }, // collinear with the previous pair — kept on the wire
]
const ROUTED = normalizeGraph({
  nodes: NODES,
  edges: [
    rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold', route: 'orthogonal' }),
    rEdge('e_gd', 'n_gold', 'n_sink', { route: 'orthogonal', waypoints: WP }),
  ],
})
const wpOf = (edges: LoopEdge[]) => (edges.find((e) => e.id === 'e_gd')!.data as { waypoints?: unknown }).waypoints

describe('edge routing — valid waypoints round-trip losslessly (§R3-7 / §R3-INV-9)', () => {
  it('Graph JSON: full precision, order, duplicate + collinear points all preserved', () => {
    const back = deserialize(serialize(ROUTED.nodes, ROUTED.edges))
    expect(wpOf(back.edges)).toEqual(WP)
    // canonical bytes are stable across a second trip
    expect(serialize(back.nodes, back.edges)).toBe(serialize(ROUTED.nodes, ROUTED.edges))
  })

  it('Share link: encode → decode preserves the routing intent', async () => {
    const text = serialize(ROUTED.nodes, ROUTED.edges)
    const { payload } = await encodeShareText(text)
    const back = deserialize(await decodeShareText(payload))
    expect(wpOf(back.edges)).toEqual(WP)
    expect((back.edges.find((e) => e.id === 'e_sg')!.data as { route?: unknown }).route).toBe('orthogonal')
  })

  it('Workspace: the embedded GraphDoc keeps the waypoints; the payload carries none', () => {
    const payload = buildWorkspacePayload({
      mc: { config: { baseSeed: 1, runs: 1, steps: 1, tracked: [] }, stale: false },
      view: { timeline: 'live', distributionPoolId: null, showMean: false },
      canvas: { x: 0, y: 0, zoom: 1 },
      simulation: {
        seed: 1, step: 0, ended: false, values: initialPoolValues(ROUTED.nodes),
        fired: [], triggerQueue: [], stateEvents: [],
        series: [{ step: 0, values: initialPoolValues(ROUTED.nodes) }],
      },
    })
    const back = deserialize(serialize(ROUTED.nodes, ROUTED.edges, undefined, payload))
    expect(wpOf(back.edges)).toEqual(WP)
    expect(JSON.stringify(back.workspace)).not.toMatch(/"route"|"waypoints"/)
  })

  it('Project + Proposal projection: waypoints appear verbatim, last, in wire order', () => {
    const side = readRevisionSide(ROUTED)
    expect(side.ok && side.version).toBe('loop-revision/3')
    if (!side.ok) return
    const e = side.content.edges.find((x) => x.id === 'e_gd')!
    expect(Object.keys(e.data).slice(-2)).toEqual(['route', 'waypoints'])
    expect(e.data.waypoints).toEqual(WP)
  })

  it('selective Apply: a `waypoints` hunk swaps the WHOLE array; Curved removes both keys', () => {
    const B = canonicalContent({ nodes: NODES, edges: [rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold' }), rEdge('e_gd', 'n_gold', 'n_sink')] })
    const P = canonicalContent(ROUTED)
    // whole-array replace
    const plan = computeThreeWay(B, B, P)
    const add = buildSelectiveApply({
      target: { nodes: NODES, edges: [rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold' }), rEdge('e_gd', 'n_gold', 'n_sink')] },
      proposedFull: ROUTED,
      plan,
      selection: { accept: {}, fieldChoices: { e_gd: { 'data.route': 'proposed', 'data.waypoints': 'proposed' }, e_sg: { 'data.route': 'proposed' } } },
    })
    expect(add.ok).toBe(true)
    if (add.ok) {
      expect((add.edges.find((e) => e.id === 'e_gd')!.data as { waypoints?: unknown }).waypoints).toEqual(WP)
    }
    // key removal: v3 base + target, v2 proposed ⇒ the base→proposed diff removes
    // both keys, and a selective Apply of those hunks deletes them from the target
    const back = buildSelectiveApply({
      target: ROUTED,
      proposedFull: { nodes: NODES, edges: [rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold' }), rEdge('e_gd', 'n_gold', 'n_sink')] },
      plan: computeThreeWay(P, P, B),
      selection: { accept: {}, fieldChoices: { e_gd: { 'data.route': 'proposed', 'data.waypoints': 'proposed' }, e_sg: { 'data.route': 'proposed' } } },
    })
    expect(back.ok).toBe(true)
    if (back.ok) {
      const gd = back.edges.find((e) => e.id === 'e_gd')!.data as Record<string, unknown>
      expect(gd.route).toBeUndefined()
      expect(gd.waypoints).toBeUndefined()
      expect(gd.kind).toBe('resource') // required field untouched
    }
  })
})
