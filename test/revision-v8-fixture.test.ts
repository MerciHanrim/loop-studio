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
  isDataImportContent,
  readRevisionSide,
  validateResultGraph,
} from '../src/model/revision'
import { deserialize, serialize, readDataImports, type ImportSourceTable } from '../src/model/serialize'
import type { LoopEdge, LoopNode } from '../src/model/types'

// loop-revision/8 golden vector — SEMANTICS-R8.md / docs/data-import.md §DI13.
//
// Mirrors examples/revision-v5/ (a graph-level array, like `frames`) AND
// examples/revision-v6/ (a per-node signal that must not mis-infer v1 and hit
// the R2-INV-2 assertion, like CSU): `dataImports` is BOTH shapes at once, so
// this fixture combines both templates rather than picking one.
//
//   DG0 — a plain `parameter` node, no provenance at all. NO `dataImports`.
//         digest_v8(DG0) === digest_v2(DG0) === pinned; not v8 (R8-INV-2).
//   DG1 — DG0's Parameter gains the FULL valid generating triple +
//         `labelAutoComposed`. Infers v8; digest differs; every other
//         node/edge byte unchanged; does NOT throw (the R2-INV-2-style
//         regression `isCsuContent` guarded against for CSU, guarded here for
//         the "provenance is the ONLY v2+ trigger" case).
//   DG2 — DG1 with the four fields removed. v8 -> v2 -> v8 returns the digest
//         EXACTLY to DG0's.
//   DG3 — DG1 with an INCOHERENT partial triple (`sourceKey` only, no
//         `sourceTableId` / `sourceColumnId`). Still v8 — `readParameterData`
//         keeps each field independently verbatim (§DI9's corrected design,
//         the CSU `timing`/`when` precedent, not the `min`/`max`
//         coherent-pair-or-drop one) — and its digest differs from BOTH DG0
//         and DG1 (a real, distinct shape, not "the same as no provenance").
//   DG4 — a graph with a graph-level `dataImports` entry but ZERO Parameters
//         carrying any provenance key at all (a pure-lookup-table import).
//         Still v8, via the array alone — mirrors `frames`' own role in the
//         version predicate, and is the case that would otherwise mis-infer
//         v1 (no model/routing/frames/CSU trigger either) and hit the
//         R2-INV-2 assertion, exactly the failure mode `isCsuContent` was
//         built to close for CSU.
//
// Regenerate the committed files with:  UPDATE_FIXTURE=1 npm test -- revision-v8-fixture

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision-v8')
const UPDATE = process.env.UPDATE_FIXTURE === '1'
const readOrWrite = (name: string, produce: () => unknown): unknown => {
  const path = resolve(DIR, name)
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, JSON.stringify(produce(), null, 2) + '\n')
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

const XY = { x: 0, y: 0 }
const param = (id: string, over: Record<string, unknown> = {}): LoopNode =>
  ({ id, type: 'parameter', position: XY, data: { kind: 'parameter', label: id, value: 1, ...over } }) as LoopNode
const pool = (id: string): LoopNode =>
  ({ id, type: 'pool', position: XY, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as LoopNode

const DG0_GRAPH = { nodes: [param('p'), pool('b')], edges: [] as LoopEdge[] }
const withParamData = (over: Record<string, unknown>) => ({
  nodes: [param('p', over), pool('b')],
  edges: [] as LoopEdge[],
})
const FULL_TRIPLE = {
  sourceTableId: 'srctable_1',
  sourceKey: 'itm_blade_ssr',
  sourceColumnId: 'srccol_1',
  labelAutoComposed: true,
}
const DG1_GRAPH = withParamData(FULL_TRIPLE)
const DG3_GRAPH = withParamData({ sourceKey: 'itm_blade_ssr' }) // partial — no table/column id

const TABLE: ImportSourceTable = {
  sourceTableId: 'srctable_items',
  label: 'Items',
  columns: [
    { sourceColumnId: 'srccol_key', role: 'key', header: 'item_key' },
    { sourceColumnId: 'srccol_name', role: 'label', header: 'display_name' },
  ],
  rows: [{ sourceKey: 'itm_blade_ssr', number: {}, label: { srccol_name: 'Ember Blade' }, foreignKey: {} }],
}
const DG4_GRAPH = { nodes: DG0_GRAPH.nodes, edges: DG0_GRAPH.edges, dataImports: [TABLE] }
// DG5 — a WRONG-TYPED provenance value (a number, not a string). Dropped by
// `readParameterData` from the PROJECTION (§R8-2.3), but must still classify
// as v8 (§R8-1's "however invalid its value" clause) — the regression this
// document's first implementation got wrong by classifying on already-
// normalised data, which has already lost this signal.
const DG5_RAW_NODES = [
  { id: 'p', type: 'parameter', position: XY, data: { kind: 'parameter', label: 'p', value: 1, sourceTableId: 42 } },
  { id: 'b', type: 'pool', position: XY, data: { kind: 'pool', label: 'b', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
]
// DG6 — a `dataImports` array whose ONLY entry is missing its `sourceTableId`
// (dropped whole by `readDataImports`, deterministically — §R8-1.1). The RAW
// array still attempted a table record, so this must still classify as v8
// even though nothing survives the projection.
const DG6_RAW_DATA_IMPORTS = [{ label: 'no id', columns: [], rows: [] }]

// PINNED — the digest the shipped projection produces for DG0 / DG1. A
// comparison against only other freshly-computed digests (as this fixture
// originally did) cannot catch a drift in the projection's own field order —
// a consistent reordering would still agree with itself on both sides of a
// `toBe` / `not.toBe` between two computed values.
const DG0_DIGEST = '223b4b2cf3baceebe3ea2e7c5d912841ca5caa4091ffa8bc372919a7fb36ecb5'
const DG1_DIGEST = '43f1c9fd9e603c3868d0dea0e0c549750bd909bfffff07598be1e6f52af84d88'

describe('loop-revision/8 golden vector (SEMANTICS-R8.md)', () => {
  it('DG0 — no provenance: not v8, no dataImports key; digest === pinned', () => {
    const dg0 = readOrWrite('DG0.json', () => JSON.parse(serialize(DG0_GRAPH.nodes, DG0_GRAPH.edges))) as {
      nodes: LoopNode[]
      edges: LoopEdge[]
    }
    const c = canonicalContent(dg0)
    expect(c).not.toHaveProperty('dataImports')
    const p = c.nodes.find((n) => n.id === 'p')!
    expect('sourceTableId' in p.data).toBe(false)
    expect(isDataImportContent({ nodes: dg0.nodes as never })).toBe(false)
    const side = readRevisionSide(dg0)
    expect(side.ok && side.version).toBe('loop-revision/2') // a plain Parameter, nothing else
    expect(digestOfCanonical(c)).toBe(DG0_DIGEST)
  })

  it('DG1 — full valid triple: infers v8; digest differs (=== pinned); does not throw (the R2-INV-2-style regression)', () => {
    const dg1 = readOrWrite('DG1.json', () => JSON.parse(serialize(DG1_GRAPH.nodes, DG1_GRAPH.edges))) as {
      nodes: LoopNode[]
      edges: LoopEdge[]
    }
    expect(isDataImportContent({ nodes: dg1.nodes as never })).toBe(true)
    const c = canonicalContent(dg1)
    const p = c.nodes.find((n) => n.id === 'p')!
    expect(p.data.sourceTableId).toBe('srctable_1')
    expect(p.data.sourceKey).toBe('itm_blade_ssr')
    expect(p.data.sourceColumnId).toBe('srccol_1')
    expect(p.data.labelAutoComposed).toBe(true)

    expect(() => readRevisionSide(dg1)).not.toThrow()
    const digest = digestOfCanonical(canonicalContent(dg1))
    expect(digest).toBe(DG1_DIGEST)
    const side = readRevisionSide(dg1, digest)
    expect(side.ok && side.version).toBe('loop-revision/8')
    expect(side.ok && side.digestVerified).toBe(true)
    expect(digest).not.toBe(DG0_DIGEST)
  })

  it('DG5 — a WRONG-TYPED provenance value: still classifies v8 on raw content, even though the projection drops it', () => {
    const edges: LoopEdge[] = []
    // direct call (no deserialize) — readRevisionSide checks its OWN raw
    // `graph.nodes` argument, not its internally-normalised copy.
    expect(isDataImportContent({ nodes: DG5_RAW_NODES as never })).toBe(true)
    const direct = readRevisionSide({ nodes: DG5_RAW_NODES as never, edges })
    expect(direct.ok && direct.version).toBe('loop-revision/8')
    // the value itself never survives the projection (§R8-2.3)
    const c = direct.ok ? direct.content : null
    const p = c!.nodes.find((n) => n.id === 'p')!
    expect('sourceTableId' in p.data).toBe(false)

    // deserialize-fed path — `deserialize`'s OWN normalizeGraph has already
    // stripped the raw key by the time `nodes` exists; `hasRawDataImportSignal`
    // is the only surviving signal, threaded through exactly as `revisionIO.ts` does.
    const file = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: DG5_RAW_NODES, edges: [] })
    const parsed = deserialize(file)
    expect((parsed.nodes.find((n) => n.id === 'p')!.data as { sourceTableId?: unknown }).sourceTableId).toBeUndefined()
    expect(parsed.hasRawDataImportSignal).toBe(true)
    const viaDeserialize = readRevisionSide(
      { nodes: parsed.nodes, edges: parsed.edges, dataImports: parsed.dataImports, rawDataImportSignal: parsed.hasRawDataImportSignal },
      undefined,
      parsed.modelVersion,
    )
    expect(viaDeserialize.ok && viaDeserialize.version).toBe('loop-revision/8')
    // WITHOUT the threaded flag, the same content would mis-classify (the bug this guards)
    const withoutFlag = readRevisionSide(
      { nodes: parsed.nodes, edges: parsed.edges, dataImports: parsed.dataImports },
      undefined,
      parsed.modelVersion,
    )
    expect(withoutFlag.ok && withoutFlag.version).toBe('loop-revision/2')
  })

  it('DG6 — a `dataImports` array whose only entry is dropped entirely: still classifies v8 on raw presence', () => {
    expect(readDataImports(DG6_RAW_DATA_IMPORTS)).toEqual([]) // nothing survives the defensive read
    const direct = readRevisionSide({ nodes: DG0_GRAPH.nodes, edges: DG0_GRAPH.edges, dataImports: DG6_RAW_DATA_IMPORTS as never })
    expect(direct.ok && direct.version).toBe('loop-revision/8')
    // the projection itself carries no `dataImports` key — nothing survived to project
    const c = direct.ok ? direct.content : null
    expect(c).not.toHaveProperty('dataImports')

    const file = JSON.stringify({
      schema: 'loop-studio/graph', version: 1, nodes: DG0_GRAPH.nodes, edges: [], dataImports: DG6_RAW_DATA_IMPORTS,
    })
    const parsed = deserialize(file)
    expect(parsed.dataImports).toEqual([])
    expect(parsed.hasRawDataImportSignal).toBe(true)
    const viaDeserialize = readRevisionSide({
      nodes: parsed.nodes, edges: parsed.edges, dataImports: parsed.dataImports, rawDataImportSignal: parsed.hasRawDataImportSignal,
    })
    expect(viaDeserialize.ok && viaDeserialize.version).toBe('loop-revision/8')
  })

  it('determinism — projecting / re-reading the same content twice produces byte-identical canonical JSON and digest', () => {
    const c1 = canonicalContent(DG4_GRAPH)
    const c2 = canonicalContent(DG4_GRAPH)
    expect(canonicalJson(c1)).toBe(canonicalJson(c2))
    expect(digestOfCanonical(c1)).toBe(digestOfCanonical(c2))

    const file = serialize(DG4_GRAPH.nodes, DG4_GRAPH.edges, undefined, undefined, undefined, 1, undefined, DG4_GRAPH.dataImports)
    const a = deserialize(file)
    const b = deserialize(file)
    expect(a.dataImports).toEqual(b.dataImports)
    expect(digestOfCanonical(canonicalContent({ nodes: a.nodes, edges: a.edges, dataImports: a.dataImports }))).toBe(
      digestOfCanonical(canonicalContent({ nodes: b.nodes, edges: b.edges, dataImports: b.dataImports })),
    )
  })

  it('DG2 — v8 -> v2 -> v8: removing the four fields returns the digest EXACTLY', () => {
    const withProv = digestOfCanonical(canonicalContent(DG1_GRAPH))
    const cleared = digestOfCanonical(canonicalContent(DG0_GRAPH))
    expect(withProv).not.toBe(cleared)
    const d = computeRevisionDiff(canonicalContent(DG1_GRAPH), canonicalContent(DG0_GRAPH))
    expect(d.summary.provenanceAffecting).toBe(true)
    expect(d.summary.engineAffecting).toBe(false)
    expect(d.nodes.changed).toHaveLength(1)
  })

  it('DG3 — an INCOHERENT partial triple (sourceKey only): still v8; digest differs from BOTH DG0 and DG1', () => {
    expect(isDataImportContent({ nodes: DG3_GRAPH.nodes as never })).toBe(true)
    const c = canonicalContent(DG3_GRAPH)
    const p = c.nodes.find((n) => n.id === 'p')!
    expect(p.data.sourceKey).toBe('itm_blade_ssr')
    expect('sourceTableId' in p.data).toBe(false)
    expect('sourceColumnId' in p.data).toBe(false)
    const d = digestOfCanonical(c)
    expect(d).not.toBe(digestOfCanonical(canonicalContent(DG0_GRAPH)))
    expect(d).not.toBe(digestOfCanonical(canonicalContent(DG1_GRAPH)))
    const side = readRevisionSide(DG3_GRAPH, d)
    expect(side.ok && side.version).toBe('loop-revision/8')
  })

  it('DG4 — a graph-level `dataImports` entry with ZERO provenance-carrying Parameters: still v8 (the array alone triggers it, mirroring `frames`); does not mis-infer v1', () => {
    expect(readDataImports(DG4_GRAPH.dataImports)).toHaveLength(1)
    const c = canonicalContent(DG4_GRAPH)
    expect(c.dataImports).toHaveLength(1)
    expect(c.dataImports![0]).toMatchObject({ sourceTableId: 'srctable_items', label: 'Items' })
    // no node in this graph carries a provenance key — the ARRAY alone must
    // still classify this as v8, or `readRevisionSide` would mis-infer v1 (no
    // model/routing/frames/CSU trigger either) and the v1-lift assertion below
    // would throw exactly like the pre-SEMANTICS-R6.md CSU bug.
    expect(isDataImportContent({ nodes: DG4_GRAPH.nodes as never })).toBe(false)
    expect(() => readRevisionSide(DG4_GRAPH)).not.toThrow()
    const digest = digestOfCanonical(c)
    const side = readRevisionSide(DG4_GRAPH, digest)
    expect(side.ok && side.version).toBe('loop-revision/8')
  })

  it('diff DG0 -> DG1: the four changed fields are all `provenance`-tagged; provenanceAffecting true, engine/advisory false', () => {
    const d = computeRevisionDiff(canonicalContent(DG0_GRAPH), canonicalContent(DG1_GRAPH))
    expect(d.nodes.changed).toHaveLength(1)
    const fields = d.nodes.changed[0].fields
    const byField = Object.fromEntries(fields.map((f) => [f.field, f]))
    for (const f of ['data.sourceTableId', 'data.sourceKey', 'data.sourceColumnId', 'data.labelAutoComposed']) {
      expect(byField[f]?.tag).toBe('provenance')
    }
    expect(d.summary).toMatchObject({ provenanceAffecting: true, engineAffecting: false, advisoryAffecting: false, empty: false })
  })

  it('three-way: a divergent local provenance value is a CONFLICT, tag provenance, feeds nConf', () => {
    const base = canonicalContent(DG0_GRAPH)
    // I locally bound this Parameter to a DIFFERENT table than the proposal —
    // a genuine three-way divergence (base had none, mine and theirs disagree).
    const mine = canonicalContent(withParamData({ ...FULL_TRIPLE, sourceTableId: 'srctable_OTHER' }))
    const theirs = canonicalContent(DG1_GRAPH) // proposal binds it to srctable_1
    const plan = computeThreeWay(base, mine, theirs)
    expect(plan.nConf).toBeGreaterThan(0)
    const hunk = plan.hunks.find((h) => h.elementType === 'node' && h.id === 'p')!
    expect(hunk.verdict).toBe('conflict')
    const tableField = hunk.fields?.find((f) => f.field === 'data.sourceTableId')
    expect(tableField?.verdict).toBe('conflict')
    expect(tableField?.tag).toBe('provenance')
  })

  // Regression guard mirroring SEMANTICS-R6.md's own CG7a/CG7b: a field
  // missing from `OPTIONAL_PROJECTED_KEYS` can't be DELETED by a selective
  // "take theirs" (`proposed: undefined` is otherwise left as the target has
  // it). Confirms the four provenance fields were added to that set.
  it('selective Apply provenance -> plain: choosing "theirs" on all four fields REMOVES them; result returns to DG0 exactly', () => {
    const base = canonicalContent(DG1_GRAPH) // base === target === provenance (nothing changed locally)
    const proposed = canonicalContent(DG0_GRAPH) // proposal drops provenance back to plain
    const plan = computeThreeWay(base, base, proposed)
    const hunk = plan.hunks.find((h) => h.elementType === 'node' && h.id === 'p')!
    expect(hunk.verdict).toBe('clean')
    const fieldNames = (hunk.fields ?? []).map((f) => f.field)
    expect(fieldNames).toEqual(
      expect.arrayContaining(['data.sourceTableId', 'data.sourceKey', 'data.sourceColumnId', 'data.labelAutoComposed']),
    )

    const result = buildSelectiveApply({
      target: DG1_GRAPH,
      proposedFull: DG0_GRAPH,
      plan,
      selection: {
        accept: {},
        fieldChoices: {
          p: {
            'data.sourceTableId': 'proposed',
            'data.sourceKey': 'proposed',
            'data.sourceColumnId': 'proposed',
            'data.labelAutoComposed': 'proposed',
          },
        },
      },
    })
    if (!result.ok) throw new Error(result.detail)
    const p = result.nodes.find((n) => n.id === 'p')!
    const pd = p.data as Record<string, unknown>
    expect('sourceTableId' in pd).toBe(false)
    expect('sourceKey' in pd).toBe(false)
    expect('sourceColumnId' in pd).toBe(false)
    expect('labelAutoComposed' in pd).toBe(false)
    expect(isDataImportContent({ nodes: result.nodes as never })).toBe(false)
    expect(digestOfCanonical(canonicalContent({ nodes: result.nodes, edges: result.edges }))).toBe(
      digestOfCanonical(canonicalContent(DG0_GRAPH)),
    )
    expect(validateResultGraph(result.nodes, result.edges).ok).toBe(true)
  })

  it('selective Apply plain -> provenance (reverse direction): choosing "theirs" ADDS all four; result matches DG1 exactly', () => {
    const base = canonicalContent(DG0_GRAPH)
    const proposed = canonicalContent(DG1_GRAPH)
    const plan = computeThreeWay(base, base, proposed)
    const hunk = plan.hunks.find((h) => h.elementType === 'node' && h.id === 'p')!
    expect(hunk.verdict).toBe('clean')

    const result = buildSelectiveApply({
      target: DG0_GRAPH,
      proposedFull: DG1_GRAPH,
      plan,
      selection: {
        accept: {},
        fieldChoices: {
          p: {
            'data.sourceTableId': 'proposed',
            'data.sourceKey': 'proposed',
            'data.sourceColumnId': 'proposed',
            'data.labelAutoComposed': 'proposed',
          },
        },
      },
    })
    if (!result.ok) throw new Error(result.detail)
    const p = result.nodes.find((n) => n.id === 'p')!
    expect((p.data as { sourceTableId?: unknown }).sourceTableId).toBe('srctable_1')
    expect((p.data as { labelAutoComposed?: unknown }).labelAutoComposed).toBe(true)
    expect(digestOfCanonical(canonicalContent({ nodes: result.nodes, edges: result.edges }))).toBe(
      digestOfCanonical(canonicalContent(DG1_GRAPH)),
    )
    expect(validateResultGraph(result.nodes, result.edges).ok).toBe(true)
  })

  it('round trip through Import -> Export preserves the triple + labelAutoComposed byte-for-byte', () => {
    const file = serialize(DG1_GRAPH.nodes, DG1_GRAPH.edges)
    const back = deserialize(file)
    const p = back.nodes.find((n) => n.id === 'p')!
    expect((p.data as { sourceTableId?: unknown }).sourceTableId).toBe('srctable_1')
    expect((p.data as { labelAutoComposed?: unknown }).labelAutoComposed).toBe(true)
    expect(digestOfCanonical(canonicalContent({ nodes: back.nodes, edges: back.edges }))).toBe(
      digestOfCanonical(canonicalContent(DG1_GRAPH)),
    )
  })

  // ── the graph-level `dataImports` array — mirrors SEMANTICS-R5.md's own
  // frames SG4a-e battery (clean swap-in, clean clear, divergent conflict,
  // noop, absent-on-both-sides), since `dataImports` shares that exact shape.
  const bare = canonicalContent(DG0_GRAPH)
  const withTables = (ts: ImportSourceTable[]) => canonicalContent({ ...DG0_GRAPH, dataImports: ts })
  const sel = (dataImports?: 'proposed' | 'yours') => ({ accept: {}, fieldChoices: {}, ...(dataImports ? { dataImports } : {}) })

  it('dataImports hunk — clean swap-in: selecting it adopts the proposal whole array, no node/edge byte moves', () => {
    const plan = computeThreeWay(bare, bare, withTables([TABLE]))
    expect(plan.hunks).toHaveLength(0)
    expect(plan.nConf).toBe(0)
    expect(plan.dataImports).toMatchObject({ kind: 'dataImports', verdict: 'clean', base: null, yours: null })

    const taken = buildSelectiveApply({
      target: DG0_GRAPH,
      proposedFull: { ...DG0_GRAPH, dataImports: [TABLE] },
      plan,
      selection: sel('proposed'),
    })
    if (!taken.ok) throw new Error(taken.detail)
    expect(canonicalJson({ nodes: taken.nodes, edges: taken.edges } as never)).toBe(
      canonicalJson({ nodes: DG0_GRAPH.nodes, edges: DG0_GRAPH.edges } as never),
    )
    expect(taken.dataImports).toEqual([TABLE])
    expect(taken.dataImports).not.toBe([TABLE]) // deep-cloned per-entry, not the same array identity as any literal

    const kept = buildSelectiveApply({
      target: DG0_GRAPH,
      proposedFull: { ...DG0_GRAPH, dataImports: [TABLE] },
      plan,
      selection: sel(),
    })
    if (!kept.ok) throw new Error(kept.detail)
    expect(kept.dataImports).toBeUndefined()
  })

  it('dataImports hunk — clean clear: the applied digest returns to DG0 exactly', () => {
    const v8 = withTables([TABLE])
    const plan = computeThreeWay(v8, v8, bare)
    expect(plan.dataImports).toMatchObject({ kind: 'dataImports', verdict: 'clean', proposed: null })
    const cleared = buildSelectiveApply({
      target: DG0_GRAPH,
      proposedFull: { ...DG0_GRAPH },
      plan,
      selection: sel('proposed'),
    })
    if (!cleared.ok) throw new Error(cleared.detail)
    expect(cleared.dataImports).toEqual([])
    expect(
      digestOfCanonical(canonicalContent({ nodes: cleared.nodes, edges: cleared.edges, dataImports: cleared.dataImports })),
    ).toBe(digestOfCanonical(bare))
  })

  it('dataImports hunk — a divergent local edit is a CONFLICT and feeds nConf; target-still-at-base is clean; target-already-at-proposal is noop', () => {
    const base = withTables([TABLE])
    const mineTable = { ...TABLE, label: 'Items (mine)' }
    const theirTable = { ...TABLE, label: 'Items (theirs)' }
    const mine = withTables([mineTable])
    const theirs = withTables([theirTable])
    const conflict = computeThreeWay(base, mine, theirs)
    expect(conflict.dataImports?.verdict).toBe('conflict')
    expect(conflict.nConf).toBe(1)

    const clean = computeThreeWay(base, base, theirs)
    expect(clean.dataImports?.verdict).toBe('clean')
    expect(clean.nConf).toBe(0)

    const noop = computeThreeWay(base, theirs, theirs)
    expect(noop.dataImports?.verdict).toBe('noop')
    expect(noop.nConf).toBe(0)
  })

  it('dataImports hunk — absent on both sides: the plan carries no dataImports key', () => {
    const plan = computeThreeWay(bare, bare, bare)
    expect(plan.dataImports).toBeUndefined()
    expect(plan.nConf).toBe(0)
  })
})
