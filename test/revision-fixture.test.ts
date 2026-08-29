import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/model/factory'
import {
  buildSelectiveApply,
  canonicalContent,
  computeThreeWay,
  digestOfCanonical,
  planProposalExport,
  validateResultGraph,
  type HunkSelection,
} from '../src/model/revision'
import type { LoopEdge, LoopNode } from '../src/model/types'

// Verification fixture for loop-revision/1 (SEMANTICS-R.md). This test both
// GUARDS the committed files under examples/revision/ against drift and is the
// oracle the desktop / mobile E2E specs replay Import→Review→Apply→Undo→Redo
// against. Regenerate the files with:  UPDATE_FIXTURE=1 npm test -- revision-fixture

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision')
const UPDATE = !!process.env.UPDATE_FIXTURE

// ── the base graph: Faucet → Gold → Split → Sink ─────────────────────────
const node = (id: string, kind: Parameters<typeof defaultData>[0], over: Record<string, unknown> = {}, pos = { x: 0, y: 0 }): LoopNode =>
  ({ id, type: kind, position: pos, data: { ...defaultData(kind), ...over } }) as LoopNode
const edge = (id: string, source: string, target: string, over: Partial<LoopEdge> = {}): LoopEdge =>
  ({
    id,
    source,
    target,
    type: 'loop',
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { kind: 'resource', flow: '1' },
    markerEnd: { type: 'arrowclosed' },
    ...over,
  }) as LoopEdge

const BASE = {
  nodes: [
    node('n_src', 'source', { label: 'Faucet' }, { x: 0, y: 120 }),
    node('n_pool', 'pool', { label: 'Gold', initial: 5 }, { x: 220, y: 100 }),
    node('n_gate', 'gate', { label: 'Split', distribution: 'deterministic' }, { x: 440, y: 110 }),
    node('n_drain', 'drain', { label: 'Sink' }, { x: 660, y: 120 }),
  ],
  edges: [
    edge('e_sp', 'n_src', 'n_pool', { data: { kind: 'resource', flow: '2' } }),
    edge('e_pg', 'n_pool', 'n_gate'),
    edge('e_gd', 'n_gate', 'n_drain'),
  ],
}

// clean: add Bonus pool + edge; Gold.initial 5→8; Split → uniform
const CLEAN = {
  nodes: [
    ...BASE.nodes.map((n) =>
      n.id === 'n_pool'
        ? ({ ...n, data: { ...n.data, initial: 8 } } as LoopNode)
        : n.id === 'n_gate'
          ? ({ ...n, data: { ...n.data, distribution: 'uniform' } } as LoopNode)
          : n,
    ),
    node('n_bonus', 'pool', { label: 'Bonus' }, { x: 440, y: 260 }),
  ],
  edges: [...BASE.edges, edge('e_gb', 'n_gate', 'n_bonus')],
}

// structural: remove n_gate; drop e_pg; retarget e_gd's source to n_pool
const STRUCTURAL = {
  nodes: BASE.nodes.filter((n) => n.id !== 'n_gate'),
  edges: [
    edge('e_sp', 'n_src', 'n_pool', { data: { kind: 'resource', flow: '2' } }),
    edge('e_gd', 'n_pool', 'n_drain'),
  ],
}

// diverged target: Gold.initial locally 12 (a third value)
const DIVERGED = {
  nodes: BASE.nodes.map((n) => (n.id === 'n_pool' ? ({ ...n, data: { ...n.data, initial: 12 } } as LoopNode) : n)),
  edges: BASE.edges,
}
// target with a local edge onto n_gate (which STRUCTURAL removes)
const LOCAL_EDGE = { nodes: BASE.nodes, edges: [...BASE.edges, edge('e_local', 'n_src', 'n_gate')] }

// ── deterministic ids ───────────────────────────────────────────────────
// opaque ids — Crockford base32, 26 chars, no I/L/O/U (§R11 PROJECT_ID_RE / REVISION_ID_RE)
const PROJECT_ID = 'proj_0000000000000000000000000F' // proj_ + 26
const BASE_REV = 'rev_00000000000000000000000BSE' // rev_ + 26
const NOW = '2026-08-29T00:00:00.000Z'
const META = { title: 'Revision fixture', createdAt: NOW, tool: 'loop-studio/fixture', author: { name: 'Fixture' } }
let seq = 0
const mint = () => `rev_${String(seq++).padStart(25, '0')}X`
const dg = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => digestOfCanonical(canonicalContent(g))

const baseRevisionFile = {
  schema: 'loop-studio/graph',
  version: 1,
  nodes: BASE.nodes,
  edges: BASE.edges,
  project: {
    schema: 'loop-revision/1',
    version: 1,
    projectId: PROJECT_ID,
    revisionId: BASE_REV,
    parentId: null,
    role: 'revision',
    contentDigest: dg(BASE),
    lineage: [],
    meta: META,
  },
}

function proposalFile(proposed: { nodes: LoopNode[]; edges: LoopEdge[] }) {
  const r = planProposalExport({
    doc: proposed,
    project: { projectId: PROJECT_ID, revisionId: BASE_REV, lineage: [] },
    dirty: false,
    pinnedBase: { revisionId: BASE_REV, content: canonicalContent(BASE) },
    meta: META,
    now: NOW,
    mint,
  })
  if (!r.ok) throw new Error(`proposal build failed: ${r.reason}`)
  return JSON.parse(r.text)
}

const selective = (
  target: { nodes: LoopNode[]; edges: LoopEdge[] },
  proposedFull: { nodes: LoopNode[]; edges: LoopEdge[] },
  selection: HunkSelection,
) => {
  const plan = computeThreeWay(canonicalContent(BASE), canonicalContent(target), canonicalContent(proposedFull))
  const built = buildSelectiveApply({ target, proposedFull, plan, selection })
  if (!built.ok) return { invalid: true as const, detail: built.detail }
  const v = validateResultGraph(built.nodes, built.edges)
  if (!v.ok) return { invalid: true as const, reasons: v.reasons }
  return { digest: dg({ nodes: built.nodes, edges: built.edges }) }
}

// selections referenced by the oracle AND replayed by the E2E specs
const SEL = {
  'clean/base/addNode+gateOnly': {
    accept: { n_bonus: true, e_gb: true },
    fieldChoices: { n_gate: { 'data.distribution': 'proposed' }, n_pool: { 'data.initial': 'yours' } },
  },
  'clean/diverged/gateTheirs+poolMine': {
    accept: {},
    fieldChoices: { n_gate: { 'data.distribution': 'proposed' }, n_pool: { 'data.initial': 'yours' } },
  },
  'structural/base/removeGate+retarget': {
    accept: { n_gate: true, e_pg: true },
    fieldChoices: { e_gd: { source: 'proposed' } },
  },
  'structural/base/nodeAlone': { accept: { n_gate: true }, fieldChoices: {} },
  'structural/localEdge/nodeBlocked': { accept: { n_gate: true }, fieldChoices: {} },
} satisfies Record<string, HunkSelection>

const cleanVsBase = computeThreeWay(canonicalContent(BASE), canonicalContent(BASE), canonicalContent(CLEAN))
const cleanVsDiverged = computeThreeWay(canonicalContent(BASE), canonicalContent(DIVERGED), canonicalContent(CLEAN))
const structVsBase = computeThreeWay(canonicalContent(BASE), canonicalContent(BASE), canonicalContent(STRUCTURAL))
const structVsLocal = computeThreeWay(canonicalContent(BASE), canonicalContent(LOCAL_EDGE), canonicalContent(STRUCTURAL))
const gateRemoveBase = structVsBase.hunks.find((h) => h.id === 'n_gate' && h.kind === 'remove')!
const gateRemoveLocal = structVsLocal.hunks.find((h) => h.id === 'n_gate' && h.kind === 'remove')!

const oracle = {
  projectId: PROJECT_ID,
  baseRevisionId: BASE_REV,
  digests: { base: dg(BASE), clean: dg(CLEAN), structural: dg(STRUCTURAL) },
  wholeApply: {
    cleanOntoBase: { classification: 'exact', digest: dg(CLEAN) },
    structuralOntoBase: { classification: 'exact', digest: dg(STRUCTURAL) },
    structuralOntoLocalEdge: { classification: 'divergent', digest: dg(STRUCTURAL) },
  },
  threeWay: {
    cleanVsBase: {
      hunks: cleanVsBase.hunks.map((h) => ({ kind: h.kind, id: h.id, verdict: h.verdict })),
      nConf: cleanVsBase.nConf,
    },
    cleanVsDiverged: {
      poolInitialField: cleanVsDiverged.hunks.find((h) => h.id === 'n_pool')?.fields?.find((f) => f.field === 'data.initial'),
      nConf: cleanVsDiverged.nConf,
    },
    structuralVsBase: { gateRemoveDependents: gateRemoveBase.dependents ?? null, gateRemoveBlockedBy: gateRemoveBase.blockedBy ?? null },
    structuralVsLocalEdge: {
      gateRemoveBlockedBy: gateRemoveLocal.blockedBy ?? null,
      gateRemoveVerdict: gateRemoveLocal.verdict,
      nConf: structVsLocal.nConf,
    },
  },
  selective: Object.fromEntries(
    Object.entries(SEL).map(([name, selection]) => {
      const target =
        name.startsWith('clean/diverged') ? DIVERGED : name.startsWith('structural/localEdge') ? LOCAL_EDGE : BASE
      const proposedFull = name.startsWith('structural') ? STRUCTURAL : CLEAN
      return [name, { selection, ...selective(target, proposedFull, selection) }]
    }),
  ),
}

const files: Record<string, unknown> = {
  'base.revision.json': baseRevisionFile,
  'proposal.clean.json': proposalFile(CLEAN),
  'proposal.structural.json': proposalFile(STRUCTURAL),
  'oracle.json': oracle,
}

describe('revision fixture — committed files stay in sync with the model', () => {
  if (UPDATE) {
    it('regenerates examples/revision/*', () => {
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
      expect(committed, `examples/revision/${name} is stale — run: UPDATE_FIXTURE=1 npm test -- revision-fixture`).toEqual(value)
    })
  }
})

describe('revision fixture — the oracle', () => {
  it('whole-apply the clean proposal onto its base is `exact` and yields the proposed graph', () => {
    expect(oracle.wholeApply.cleanOntoBase.digest).toBe(oracle.digests.clean)
  })

  it('clean vs base — one add node + one add edge + two field changes, no conflicts', () => {
    expect(oracle.threeWay.cleanVsBase.nConf).toBe(0)
    const kinds = oracle.threeWay.cleanVsBase.hunks.map((h) => `${h.kind}:${h.id}`).sort()
    expect(kinds).toEqual(['add:e_gb', 'add:n_bonus', 'change:n_gate', 'change:n_pool'])
  })

  it('clean vs a diverged target — Gold.initial is a 3-way conflict (base 5 / proposed 8 / yours 12)', () => {
    const f = oracle.threeWay.cleanVsDiverged.poolInitialField
    expect(f).toMatchObject({ base: 5, proposed: 8, yours: 12, verdict: 'conflict' })
    expect(oracle.threeWay.cleanVsDiverged.nConf).toBe(1)
  })

  it('structural: removing n_gate has explicit dependents (drop e_pg, retarget e_gd), not a silent cascade', () => {
    expect(oracle.threeWay.structuralVsBase.gateRemoveDependents).toEqual(['e_gd', 'e_pg'])
    expect(oracle.threeWay.structuralVsBase.gateRemoveBlockedBy).toBeNull()
  })

  it('structural + a local edge onto n_gate — structural conflict feeds nConf ⇒ divergent', () => {
    expect(oracle.threeWay.structuralVsLocalEdge.gateRemoveBlockedBy).toEqual(['e_local'])
    expect(oracle.threeWay.structuralVsLocalEdge.gateRemoveVerdict).toBe('conflict')
    expect(oracle.threeWay.structuralVsLocalEdge.nConf).toBeGreaterThanOrEqual(1)
  })

  it('selective apply — deterministic digests for each named selection', () => {
    const s = oracle.selective
    expect(s['clean/base/addNode+gateOnly']).toHaveProperty('digest')
    expect(s['clean/diverged/gateTheirs+poolMine']).toHaveProperty('digest')
    // remove the gate + drop e_pg + retarget e_gd ⇒ a clean src→pool→drain line
    expect(s['structural/base/removeGate+retarget']).toHaveProperty('digest')
    // the node alone leaves e_gd dangling ⇒ invalid
    expect(s['structural/base/nodeAlone']).toMatchObject({ invalid: true })
    // blocked by the local edge ⇒ invalid
    expect(s['structural/localEdge/nodeBlocked']).toMatchObject({ invalid: true })
  })

  it('every valid selective result passes full-GraphDoc validation', () => {
    for (const [name, r] of Object.entries(oracle.selective)) {
      if ('digest' in r) expect(typeof r.digest, name).toBe('string')
    }
  })
})
