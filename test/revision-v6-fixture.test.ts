import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalContent,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  isCsuContent,
  readRevisionSide,
} from '../src/model/revision'
import { deserialize, serialize } from '../src/model/serialize'
import type { LoopEdge, LoopNode } from '../src/model/types'

// loop-revision/6 golden vector — SEMANTICS-R6.md §R6-4 / R6-D.
//
// Mirrors examples/revision-v5/: committed JSON under examples/revision-v6/
// that this test GUARDS against drift, plus a pinned oracle. The <= v5 digest
// is PINNED to the value the shipped projection produces, so a drift in
// either projection fails the fixture.
//
//   CG0 — a PURE engine-only graph (no Parameter/Register/routing/frames): a
//         Pool, a deterministic Gate, a resource edge (the Gate fires), and a
//         second Pool with an ordinary phase0 `label` edge (no timing, no
//         when) sourced FROM THE GATE. (The source is fixed at the Gate
//         across CG0-CG2 purely so the CSU edit below is isolated to the
//         `timing` / `when` fields for a byte-for-byte round trip; whether a
//         phase0 label with a Gate source is itself engine-VALID is exercised
//         separately in state.afterpull.test.ts / gacha-pity-timing.probe.test.ts
//         — this fixture is a wire/digest test only.)
//         digest_v6(CG0) === digest_v1(CG0) === pinned; not v6 (R6-INV-2).
//   CG1 — CG0's label edge gains `timing: "afterPull"` + `when: "source-fired"`.
//         Infers v6; digest differs; every other node/edge byte === CG0's.
//         Before SEMANTICS-R6.md, `readRevisionSide` on exactly this shape
//         (no model/routing/frames) mis-inferred loop-revision/1 and THREW
//         the R2-INV-2 assertion — this is the regression the predicate fixes.
//   CG2 — CG1 with `timing` / `when` removed. Fails the v6 predicate;
//         digest_v6(CG2) === digest_v6(CG0) exactly (the v5 -> v6 -> v5 return).
//   CG3 — CG1 with `timing: "nope"` (unrecognised, `when` still valid).
//         Still v6; digest differs from BOTH CG0 and CG1 — an invalid value
//         is neither "no CSU" nor "the same CSU edit."
//   CG4a — CG1 with `when: "level>=5"` (unrecognised).
//   CG4b — CG0's bare phase0 label with `when: "source-fired"` added,
//          `timing` left absent (CSU3-5 row 2 — fail-closed even though
//          `timing` never became "afterPull"). Still v6.
//   All of CG0/CG1/CG3/CG4a/CG4b digest PAIRWISE DIFFERENTLY.
//
// Regenerate the committed files with:  UPDATE_FIXTURE=1 npm test -- revision-v6-fixture

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision-v6')
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
const pool = (id: string, initial = 0): LoopNode =>
  ({ id, type: 'pool', position: XY, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } }) as LoopNode
const gate = (id: string): LoopNode =>
  ({ id, type: 'gate', position: XY, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } }) as LoopNode
const rEdge = (id: string, s: string, t: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }) as LoopEdge
const label = (id: string, s: string, t: string, over: Record<string, unknown> = {}): LoopEdge =>
  ({
    id, type: 'loop', source: s, target: t, sourceHandle: 'state-source', targetHandle: 'state-target',
    data: { kind: 'state', mode: 'label', expr: '+1', ...over },
  }) as LoopEdge

const CG0_GRAPH = {
  nodes: [pool('a', 5), gate('g'), pool('b', 0)],
  edges: [rEdge('e', 'a', 'g'), label('m', 'g', 'b')],
}
const withLabelData = (over: Record<string, unknown>) => ({
  nodes: CG0_GRAPH.nodes,
  edges: [rEdge('e', 'a', 'g'), label('m', 'g', 'b', over)],
})
const CG1_GRAPH = withLabelData({ timing: 'afterPull', when: 'source-fired' })
const CG3_GRAPH = withLabelData({ timing: 'nope', when: 'source-fired' })
const CG4A_GRAPH = withLabelData({ timing: 'afterPull', when: 'level>=5' })
const CG4B_GRAPH = withLabelData({ when: 'source-fired' }) // timing absent — CSU3-5 row 2

// PINNED — the digest the shipped <= v5 projection produces for CG0.
const CG0_DIGEST = '3eb6713f642100e18b202901beb53c46c50d2eb82bb7e4f96eaf6403c71d5c83'
const CG1_DIGEST = 'dacf0ef5138bf3bf24c3173d9572c6ea72fe4dccc6360d233e04fd8101127c58'

describe('loop-revision/6 golden vector (SEMANTICS-R6.md §R6-4)', () => {
  it('CG0 — no CSU content: digest_v6 === digest_v1 === pinned; not v6', () => {
    const cg0 = readOrWrite('CG0.json', () => JSON.parse(serialize(CG0_GRAPH.nodes, CG0_GRAPH.edges))) as {
      nodes: LoopNode[]
      edges: LoopEdge[]
    }
    const c = canonicalContent(cg0)
    const edge = c.edges.find((e) => e.id === 'm')!
    expect('timing' in edge.data).toBe(false)
    expect('when' in edge.data).toBe(false)
    expect(isCsuContent(cg0)).toBe(false)
    expect(digestOfCanonical(c)).toBe(CG0_DIGEST)
  })

  it('CG1 — valid afterPull: infers v6; digest differs; node/edge bytes otherwise unchanged; does NOT throw (the R2-INV-2 regression)', () => {
    const cg1 = readOrWrite('CG1.json', () => JSON.parse(serialize(CG1_GRAPH.nodes, CG1_GRAPH.edges))) as {
      nodes: LoopNode[]
      edges: LoopEdge[]
    }
    expect(isCsuContent(cg1)).toBe(true)
    const c = canonicalContent(cg1)
    const edge = c.edges.find((e) => e.id === 'm')!
    expect(edge.data.timing).toBe('afterPull')
    expect(edge.data.when).toBe('source-fired')
    expect(digestOfCanonical(c)).toBe(CG1_DIGEST)
    expect(CG1_DIGEST).not.toBe(CG0_DIGEST)

    // the regression this document fixes: readRevisionSide must not throw and
    // must correctly infer v6 for a graph with NO model/routing/frames content.
    const digest = digestOfCanonical(canonicalContent(cg1))
    expect(() => readRevisionSide(cg1, digest)).not.toThrow()
    const side = readRevisionSide(cg1, digest)
    expect(side.ok && side.version).toBe('loop-revision/6')
    expect(side.ok && side.digestVerified).toBe(true)
  })

  it('CG2 — v5 -> v6 -> v5: removing timing/when returns the digest EXACTLY', () => {
    const withCsu = digestOfCanonical(canonicalContent(CG1_GRAPH))
    const cleared = digestOfCanonical(canonicalContent(CG0_GRAPH))
    expect(withCsu).toBe(CG1_DIGEST)
    expect(cleared).toBe(CG0_DIGEST)
    const d = computeRevisionDiff(canonicalContent(CG1_GRAPH), canonicalContent(CG0_GRAPH))
    expect(d.summary.engineAffecting).toBe(true)
    expect(d.edges.changed).toHaveLength(1)
  })

  it('CG3 — an unrecognised timing: still v6; digest differs from BOTH CG0 and CG1', () => {
    expect(isCsuContent(CG3_GRAPH)).toBe(true)
    const c = canonicalContent(CG3_GRAPH)
    expect(c.edges.find((e) => e.id === 'm')!.data.timing).toBe('nope')
    const d = digestOfCanonical(c)
    expect(d).not.toBe(CG0_DIGEST)
    expect(d).not.toBe(CG1_DIGEST)
    const side = readRevisionSide(CG3_GRAPH, d)
    expect(side.ok && side.version).toBe('loop-revision/6')
  })

  it('CG4a/CG4b — an unrecognised `when`, and a phase0 label with a stray `when`: both v6, all digests pairwise distinct', () => {
    expect(isCsuContent(CG4A_GRAPH)).toBe(true)
    expect(isCsuContent(CG4B_GRAPH)).toBe(true)
    const b = CG4B_GRAPH.edges.find((e) => e.id === 'm')!
    expect((b.data as { timing?: unknown }).timing).toBeUndefined()

    const digests = [CG0_GRAPH, CG1_GRAPH, CG3_GRAPH, CG4A_GRAPH, CG4B_GRAPH].map((g) =>
      digestOfCanonical(canonicalContent(g)),
    )
    expect(new Set(digests).size).toBe(digests.length) // pairwise distinct

    const c4b = canonicalContent(CG4B_GRAPH).edges.find((e) => e.id === 'm')!
    expect('timing' in c4b.data).toBe(false)
    expect(c4b.data.when).toBe('source-fired')
  })

  it('CG5 — diff: CG0 -> CG1 is exactly two `engine`-tagged changed fields (timing, when), engineAffecting true', () => {
    const d = computeRevisionDiff(canonicalContent(CG0_GRAPH), canonicalContent(CG1_GRAPH))
    expect(d.edges.changed).toHaveLength(1)
    const fields = d.edges.changed[0].fields
    const byField = Object.fromEntries(fields.map((f) => [f.field, f]))
    expect(byField['data.timing']).toMatchObject({ tag: 'engine', proposed: 'afterPull' })
    expect(byField['data.when']).toMatchObject({ tag: 'engine', proposed: 'source-fired' })
    expect(d.summary).toMatchObject({ engineAffecting: true, advisoryAffecting: false, empty: false })
  })

  it('CG5 — three-way: a divergent local `timing` is a CONFLICT and feeds nConf (the ordinary engine-field rule, no frames-style carve-out)', () => {
    const base = canonicalContent(CG0_GRAPH)
    const mine = canonicalContent(CG3_GRAPH) // I locally set an unrecognised timing
    const theirs = canonicalContent(CG1_GRAPH) // proposal sets the valid afterPull edit
    const plan = computeThreeWay(base, mine, theirs)
    expect(plan.nConf).toBeGreaterThan(0)
    const hunk = plan.hunks.find((h) => h.elementType === 'edge' && h.id === 'm')!
    expect(hunk.verdict).toBe('conflict')
    const timingField = hunk.fields?.find((f) => f.field === 'data.timing')
    expect(timingField?.verdict).toBe('conflict')
    expect(timingField?.tag).toBe('engine')
  })

  it('CG6 — round trip through Import -> Export preserves timing/when byte-for-byte', () => {
    const file = serialize(CG1_GRAPH.nodes, CG1_GRAPH.edges)
    const back = deserialize(file)
    const edge = back.edges.find((e) => e.id === 'm')!
    expect((edge.data as { timing?: unknown }).timing).toBe('afterPull')
    expect((edge.data as { when?: unknown }).when).toBe('source-fired')
    expect(digestOfCanonical(canonicalContent({ nodes: back.nodes, edges: back.edges }))).toBe(CG1_DIGEST)
  })
})
