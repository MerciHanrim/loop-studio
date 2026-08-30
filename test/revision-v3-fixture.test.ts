import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSelectiveApply,
  canonicalContent,
  canonicalJson,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  isModelLayerContent,
  readProject,
  readRevisionSide,
  validateResultGraph,
} from '../src/model/revision'
import { readRoutingPayload, routingReadIssues } from '../src/model/edgeRouting'
import { normalizeGraph, serialize } from '../src/model/serialize'
import { readWorkspace, buildWorkspacePayload } from '../src/model/workspace'
import { initSim, step } from '../src/engine/step'
import { initialPoolValues } from '../src/model/model'
import type { LoopEdge, LoopNode } from '../src/model/types'

// loop-revision/3 golden vector — SEMANTICS-R3.md §R3-4 / R3-D3.
//
// Mirrors examples/revision-v2/: committed JSON under examples/revision-v3/ that
// this test GUARDS against drift, plus the pinned oracle every claim in §R3-4
// is checked against. The v2 oracle digest is PINNED to the value the shipped
// loop-revision/2 projection produces, so a drift in either projection fails.
//
//   RG0 — a v2-content graph (parameter + register + a Gold resourceType), no
//         routing intent. digest_v3(RG0) === digest_v2(RG0) === pinned; not v3.
//   RG1 — RG0 + `route:"orthogonal"` on one edge + a 3-point `waypoints` on
//         another. Infers v3; digest differs; the two edges gain exactly the
//         trailing keys; every other element is byte-identical to RG0; the diff
//         is two `cosmetic` hunks, engine/advisory-affecting false.
//   RG2 — RG1 switched back to Bézier (both keys removed / emptied). Fails the
//         v3 predicate; digest returns EXACTLY to RG0's (ER-D16 / R3-D5).
//   RG3 — a proposal whose PROPOSED content carries broken payloads. Every one
//         is quarantined; one warning per edge in ascending id order; the edges
//         + every semantic field survive; the side then infers v2; the header
//         digest is checked against the QUARANTINED GraphDoc (mismatch drops).
//   RG4 — the same proposal but the break is in `base.content`: verified
//         INDEPENDENTLY (§R3-5.2), its failure drops the WHOLE proposal.
//   RG5 — the four v2↔v3 combinations (RV-1…RV-4) through computeThreeWay /
//         buildSelectiveApply / validateResultGraph.
//   RG6 — a loop-workspace/1 round-trip carries no routing field (§R3-8).
//
// Regenerate the committed files with:  UPDATE_FIXTURE=1 npm test -- revision-v3-fixture

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision-v3')
const UPDATE = !!process.env.UPDATE_FIXTURE

// ── graph builders ──────────────────────────────────────────────────────
const node = (id: string, type: LoopNode['type'], x: number, data: Record<string, unknown>): LoopNode =>
  ({ id, type, position: { x, y: 0 }, data } as LoopNode)
const rEdge = (id: string, s: string, t: string, extra: Record<string, unknown> = {}): LoopEdge =>
  ({
    id,
    source: s,
    target: t,
    type: 'loop',
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { kind: 'resource', flow: '1', ...extra },
  } as LoopEdge)

/** v2-content base — a parameter, a register, a Gold resourceType; NO routing. */
function buildRG0(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  return {
    nodes: [
      node('n_src', 'source', 0, { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' }),
      node('n_gold', 'pool', 200, { kind: 'pool', label: 'Gold', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny', resourceType: 'Gold' }),
      node('n_sink', 'drain', 400, { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' }),
      node('p_rate', 'parameter', 0, { kind: 'parameter', label: 'Rate', value: 2 }),
      node('r_x', 'register', 200, { kind: 'register', label: 'X', expr: '@n_gold * @p_rate' }),
    ],
    edges: [
      rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold' }),
      rEdge('e_gd', 'n_gold', 'n_sink'),
    ],
  }
}

/** RG0 + `route:"orthogonal"` on e_sg, a 3-point `waypoints` on e_gd. */
function buildRG1(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const g = buildRG0()
  return {
    nodes: g.nodes,
    edges: g.edges.map((e) =>
      e.id === 'e_sg'
        ? ({ ...e, data: { ...e.data, route: 'orthogonal' } } as LoopEdge)
        : e.id === 'e_gd'
          ? ({ ...e, data: { ...e.data, route: 'orthogonal', waypoints: [{ x: 250, y: -0 }, { x: 250, y: 40 }, { x: 300, y: 40 }] } } as LoopEdge)
          : e,
    ),
  }
}

/** RG1 with routing removed the way the Inspector "Curved" option does it. */
function buildRG2(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const g = buildRG1()
  return {
    nodes: g.nodes,
    edges: g.edges.map((e) => {
      const { route: _r, waypoints: _w, ...rest } = e.data as Record<string, unknown>
      return { ...e, data: rest } as LoopEdge
    }),
  }
}

const RG0 = buildRG0()
const RG1 = buildRG1()
const RG2 = buildRG2()

const graphDoc = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => {
  const n = normalizeGraph(g)
  return { schema: 'loop-studio/graph', version: 1, nodes: n.nodes, edges: n.edges }
}

// `v3` = the projection as-is (routing kept). `v2` = the projection a pure
// loop-revision/2 reader would produce — routing intent stripped first — so a
// no-routing graph has an IDENTICAL v2/v3 digest (R3-INV-2) and a routed graph
// does not. Both use the one conservative `canonicalContent`; only the input
// differs.
const stripRouting = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => ({
  nodes: g.nodes,
  edges: g.edges.map((e) => {
    const { route: _r, waypoints: _w, ...rest } = e.data as Record<string, unknown>
    return { ...e, data: rest } as LoopEdge
  }),
})
const v3 = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => canonicalContent(g)
const v2 = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => canonicalContent(stripRouting(g))
const dg3 = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => digestOfCanonical(v3(g))
const dg2 = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => digestOfCanonical(v2(g))

// ── RG3 / RG4 — hand-built proposal files ───────────────────────────────
const PROJECT_ID = 'proj_0000000000000000000000000F' // proj_ + 26 (Crockford base32)
const BASE_REV = 'rev_00000000000000000000000RG3' // rev_ + 26
const PROP_REV = 'rev_00000000000000000000000RG4'

/** RG0 with three broken routing payloads on its edges (+ one extra edge). */
function brokenProposedGraph(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  return {
    nodes: buildRG0().nodes,
    edges: [
      rEdge('e_gd', 'n_gold', 'n_sink', { route: 'orthogonal', waypoints: Array.from({ length: 65 }, (_, i) => ({ x: i, y: 0 })) }),
      rEdge('e_nan', 'n_gold', 'n_sink', { route: 'orthogonal', waypoints: [{ x: 1, y: Number.NaN }] }),
      rEdge('e_sg', 'n_src', 'n_gold', { flow: '2', resourceType: 'Gold', route: 3 as unknown as string }),
      rEdge('e_stray', 'n_src', 'n_gold', { waypoints: [{ x: 1, y: 1 }] }), // waypoints, route absent
    ],
  }
}

/** the proposed side AFTER §R3-1.1 quarantine — what a correct writer commits. */
const quarantinedProposed = () => canonicalContent(brokenProposedGraph())

function proposalFile(opts: { contentDigest: string; baseContent: unknown; baseDigest: string }) {
  const n = normalizeGraph(brokenProposedGraph())
  return {
    schema: 'loop-studio/graph',
    version: 1,
    nodes: n.nodes,
    edges: n.edges,
    project: {
      schema: 'loop-revision/1',
      version: 1,
      projectId: PROJECT_ID,
      revisionId: PROP_REV,
      parentId: BASE_REV,
      role: 'proposal',
      contentDigest: opts.contentDigest,
      lineage: [BASE_REV],
      base: {
        revisionId: BASE_REV,
        contentDigest: opts.baseDigest,
        content: opts.baseContent,
      },
    },
  }
}

const rg3Proposal = proposalFile({
  contentDigest: digestOfCanonical(quarantinedProposed()),
  baseContent: v3(RG0),
  baseDigest: dg2(RG0),
})
// RG4 — same file, but base.contentDigest no longer matches base.content
const rg4Proposal = proposalFile({
  contentDigest: digestOfCanonical(quarantinedProposed()),
  baseContent: v3(RG0),
  baseDigest: 'f'.repeat(64),
})

// ── the oracle ─────────────────────────────────────────────────────────
const rg0ToRg1Diff = computeRevisionDiff(v3(RG0), v3(RG1))
const oracle = {
  loopRevision2: {
    rg0Digest: dg2(RG0), // PINNED — the shipped loop-revision/2 value
  },
  loopRevision3: {
    rg1Digest: dg3(RG1),
    rg0IsV3: false,
    rg1IsV3: true,
  },
  diff: {
    rg0ToRg1: rg0ToRg1Diff.edges.changed
      .flatMap((c) => c.fields.map((f) => `${c.id}:${f.field}:${f.tag}`))
      .sort(),
    summary: {
      engineAffecting: rg0ToRg1Diff.summary.engineAffecting,
      advisoryAffecting: rg0ToRg1Diff.summary.advisoryAffecting,
      empty: rg0ToRg1Diff.summary.empty,
    },
  },
}

const files: Record<string, unknown> = {
  'RG0.json': graphDoc(RG0),
  'RG1.json': graphDoc(RG1),
  'proposal.malformed-proposed.json': rg3Proposal,
  'proposal.malformed-base.json': rg4Proposal,
  'oracle.json': oracle,
}

describe('loop-revision/3 fixture — committed files stay in sync with the model', () => {
  if (UPDATE) {
    it('regenerates examples/revision-v3/*', () => {
      mkdirSync(DIR, { recursive: true })
      for (const [name, value] of Object.entries(files)) {
        writeFileSync(resolve(DIR, name), JSON.stringify(value, null, 2) + '\n')
      }
    })
    return
  }
  for (const [name, value] of Object.entries(files)) {
    it(name, () => {
      const committed = JSON.parse(readFileSync(resolve(DIR, name), 'utf8'))
      expect(committed, `examples/revision-v3/${name} is stale — run: UPDATE_FIXTURE=1 npm test -- revision-v3-fixture`).toEqual(value)
    })
  }
})

describe('loop-revision/3 golden vector — §R3-4', () => {
  it('RG0 — the v3 predicate is false; digest_v3(RG0) === digest_v2(RG0) === pinned', () => {
    expect(isModelLayerContent(graphDoc(RG0))).toBe(true) // model layer, but…
    const side = readRevisionSide(RG0)
    expect(side.ok && side.version).toBe('loop-revision/2') // …no routing ⇒ not v3
    expect(dg3(RG0)).toBe(dg2(RG0))
    expect(dg2(RG0)).toBe(oracle.loopRevision2.rg0Digest) // drift guard
    expect(canonicalJson(v3(RG0))).not.toMatch(/"route"|"waypoints"/)
  })

  it('RG1 — infers v3; digest differs; the two edges gain exactly the trailing keys; everything else is byte-identical to RG0', () => {
    const side = readRevisionSide(RG1)
    expect(side.ok && side.version).toBe('loop-revision/3')
    expect(dg3(RG1)).not.toBe(dg2(RG1))
    expect(dg3(RG1)).toBe(oracle.loopRevision3.rg1Digest)

    const c0 = v3(RG0)
    const c1 = v3(RG1)
    const e0 = Object.fromEntries(c0.edges.map((e) => [e.id, e]))
    const e1 = Object.fromEntries(c1.edges.map((e) => [e.id, e]))
    expect(e1.e_sg.data).toEqual({ ...e0.e_sg.data, route: 'orthogonal' })
    expect(e1.e_gd.data).toEqual({
      ...e0.e_gd.data,
      route: 'orthogonal',
      waypoints: [{ x: 250, y: 0 }, { x: 250, y: 40 }, { x: 300, y: 40 }], // -0 -> 0, in order, {x,y}
    })
    expect(Object.keys(e1.e_gd.data).slice(-2)).toEqual(['route', 'waypoints'])
    expect(canonicalJson({ ...c1, edges: [] } as never)).toBe(canonicalJson({ ...c0, edges: [] } as never))
  })

  it('RG1 diff vs RG0 — two `cosmetic` hunks, engine/advisory-affecting false, not empty', () => {
    const diff = computeRevisionDiff(v3(RG0), v3(RG1))
    expect(diff.summary.engineAffecting).toBe(false)
    expect(diff.summary.advisoryAffecting).toBe(false)
    expect(diff.summary.empty).toBe(false)
    expect(
      diff.edges.changed.flatMap((c) => c.fields.map((f) => `${c.id}:${f.field}:${f.tag}`)).sort(),
    ).toEqual([
      'e_gd:data.route:cosmetic',
      'e_gd:data.waypoints:cosmetic',
      'e_sg:data.route:cosmetic',
    ])
  })

  it('RG2 — the v2 → v3 → v2 digest return is EXACT (ER-D16 / R3-D5)', () => {
    const side = readRevisionSide(RG2)
    expect(side.ok && side.version).toBe('loop-revision/2') // fails §R3-1 again
    expect(dg3(RG2)).toBe(dg2(RG2))
    expect(dg2(RG2)).toBe(dg2(RG0))
    expect(canonicalJson(v3(RG2))).toBe(canonicalJson(v3(RG0)))
    const back = computeRevisionDiff(v3(RG1), v3(RG2))
    expect(
      back.edges.changed.flatMap((c) => c.fields.map((f) => `${c.id}:${f.field}`)).sort(),
    ).toEqual(['e_gd:data.route', 'e_gd:data.waypoints', 'e_sg:data.route'])
    expect(back.summary.engineAffecting).toBe(false)
  })

  it('RG3 — a malformed PROPOSED payload is quarantined; edges + semantic fields survive; warnings are id-ordered; digest checks the quarantined GraphDoc', () => {
    const g = normalizeGraph(brokenProposedGraph())
    for (const e of g.edges) {
      expect((e.data as { route?: unknown }).route).toBeUndefined()
      expect((e.data as { waypoints?: unknown }).waypoints).toBeUndefined()
      expect(e.data.kind).toBe('resource')
    }
    expect((g.edges.find((e) => e.id === 'e_sg')!.data as { flow?: string }).flow).toBe('2')
    expect((g.edges.find((e) => e.id === 'e_sg')!.data as { resourceType?: string }).resourceType).toBe('Gold')

    // nothing v3 survived ⇒ the proposed side infers v2
    expect((readRevisionSide(brokenProposedGraph()) as { version?: string }).version).toBe('loop-revision/2')

    // one warning per broken edge, ascending id order
    const issues = routingReadIssues([
      { id: 'e_stray', data: { waypoints: [{ x: 1, y: 1 }] } },
      { id: 'e_nan', data: { route: 'orthogonal', waypoints: [{ x: 1, y: Number.NaN }] } },
      { id: 'e_gd', data: { route: 'orthogonal', waypoints: Array.from({ length: 65 }, () => ({ x: 0, y: 0 })) } },
      { id: 'e_sg', data: { route: 3 } },
    ])
    expect(issues.map((s) => s.match(/"([^"]+)"/)?.[1])).toEqual(['e_gd', 'e_nan', 'e_sg', 'e_stray'])

    // the header digest is verified against the QUARANTINED GraphDoc → ok
    expect(readProject(rg3Proposal.project, quarantinedProposed()).ok).toBe(true)
    // …and a header digest computed against the PRE-quarantine bytes is dropped
    const tampered = { ...rg3Proposal.project, contentDigest: 'a'.repeat(64) }
    expect(readProject(tampered, quarantinedProposed()).ok).toBe(false)
  })

  it('RG4 — a malformed `base` is verified independently and drops the WHOLE proposal', () => {
    const r = readProject(rg4Proposal.project, quarantinedProposed())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.warning).toMatch(/base snapshot|not match/i)
  })

  it('RG5 — the four v2↔v3 combinations classify correctly (RV-1…RV-4)', () => {
    const B0 = v3(RG0) // v2 content
    const B1 = v3(RG1) // v3 content

    // RV-1: v2 base, v3 proposed — routing hunks apply, no engine field touched
    const p1 = computeThreeWay(B0, B0, B1)
    expect(p1.nConf).toBe(0)
    expect(p1.hunks.every((h) => h.kind === 'change' && (h.fields ?? []).every((f) => f.tag === 'cosmetic'))).toBe(true)
    const a1 = buildSelectiveApply({
      target: RG0,
      proposedFull: RG1,
      plan: p1,
      selection: {
        accept: {},
        fieldChoices: {
          e_sg: { 'data.route': 'proposed' },
          e_gd: { 'data.route': 'proposed', 'data.waypoints': 'proposed' },
        },
      },
    })
    expect(a1.ok).toBe(true)
    if (a1.ok) {
      expect(validateResultGraph(a1.nodes, a1.edges).ok).toBe(true)
      expect(digestOfCanonical(canonicalContent({ nodes: a1.nodes, edges: a1.edges }))).toBe(dg3(RG1))
    }

    // RV-2: v3 base, v2 proposed — routing hunks remove keys, digest returns
    const p2 = computeThreeWay(B1, B1, B0)
    const a2 = buildSelectiveApply({
      target: RG1,
      proposedFull: RG0,
      plan: p2,
      selection: {
        accept: {},
        fieldChoices: {
          e_sg: { 'data.route': 'proposed' },
          e_gd: { 'data.route': 'proposed', 'data.waypoints': 'proposed' },
        },
      },
    })
    expect(a2.ok).toBe(true)
    if (a2.ok) {
      expect(digestOfCanonical(canonicalContent({ nodes: a2.nodes, edges: a2.edges }))).toBe(dg2(RG0))
    }

    // RV-3: v3↔v3 with a waypoints reorder feeds nConf
    const RG1b = {
      nodes: RG1.nodes,
      edges: RG1.edges.map((e) =>
        e.id === 'e_gd'
          ? ({ ...e, data: { ...e.data, waypoints: [{ x: 300, y: 40 }, { x: 250, y: 40 }, { x: 250, y: 0 }] } } as LoopEdge)
          : e,
      ),
    }
    const p3 = computeThreeWay(B0, v3(RG1), v3(RG1b))
    const wpField = p3.hunks.find((h) => h.id === 'e_gd')?.fields?.find((f) => f.field === 'data.waypoints')
    expect(wpField?.verdict).toBe('conflict') // base absent for e_gd's waypoints ⇒ conflict
    expect(p3.nConf).toBeGreaterThanOrEqual(1)

    // RV-4: v2↔v2 unchanged from loop-revision/2
    const p4 = computeThreeWay(B0, B0, B0)
    expect(p4.hunks).toEqual([])
    expect(p4.nConf).toBe(0)
  })

  it('RG6 — loop-workspace/1 round-trip carries no routing field; the value is in the embedded GraphDoc (§R3-8)', () => {
    const n = normalizeGraph(RG1)
    let st = initSim(n.nodes)
    st = step(n.nodes, n.edges, st, 1).state
    const payload = buildWorkspacePayload({
      mc: { config: { baseSeed: 1, runs: 1, steps: 1, tracked: [] }, stale: false },
      view: { timeline: 'live', distributionPoolId: null, showMean: false },
      canvas: { x: 0, y: 0, zoom: 1 },
      simulation: {
        seed: 1, step: st.step, ended: false, values: st.values,
        fired: st.fired ?? [], triggerQueue: st.triggerQueue ?? [], stateEvents: [],
        series: [{ step: 0, values: initialPoolValues(n.nodes) }, { step: st.step, values: st.values }],
      },
    })
    const file = JSON.parse(serialize(n.nodes, n.edges, undefined, payload)) as {
      workspace: { simulation: Record<string, unknown> }
      edges: LoopEdge[]
    }
    expect(JSON.stringify(file.workspace)).not.toMatch(/"route"|"waypoints"/)
    expect((file.edges.find((e) => e.id === 'e_sg')!.data as { route?: unknown }).route).toBe('orthogonal')
    const { restored } = readWorkspace(file.workspace, { nodes: n.nodes, edges: n.edges }, 'x')
    expect(restored?.simulation?.step).toBe(st.step)
  })

  it('defensive read — full precision, -0 → 0, duplicates kept (§R3-1.1 / R3-INV-9)', () => {
    const r = readRoutingPayload({
      route: 'orthogonal',
      waypoints: [{ x: -0, y: 1.123456789 }, { x: 5, y: 5 }, { x: 5, y: 5 }],
    })
    expect(r.route).toBe('orthogonal')
    expect(r.waypoints).toEqual([{ x: 0, y: 1.123456789 }, { x: 5, y: 5 }, { x: 5, y: 5 }])
    expect(readRoutingPayload({ route: 'bezier', waypoints: [{ x: 1, y: 1 }] })).toEqual({})
    expect(readRoutingPayload({ waypoints: [{ x: 1, y: 1 }] })).toEqual({})
  })
})
