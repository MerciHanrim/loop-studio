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
  readRevisionSide,
  validateResultGraph,
} from '../src/model/revision'
import { deserialize, serialize, readSavedFrames } from '../src/model/serialize'
import { buildWorkspacePayload, readWorkspace } from '../src/model/workspace'
import type { LoopEdge, LoopNode } from '../src/model/types'

// loop-revision/5 golden vector — SEMANTICS-R5.md §R5-4 / R5-D.
//
// Mirrors examples/revision-v3/: committed JSON under examples/revision-v5/ that
// this test GUARDS against drift, plus a pinned oracle. The <= v4 digest is
// PINNED to the value the shipped projection produces, so a drift in either
// projection fails the fixture.
//
//   SG0 — a v2-content graph (a `gold` resourceType), NO frames.
//         digest_v5(SG0) === digest_v4(SG0) === pinned; not v5 (R5-INV-2).
//   SG1 — SG0 + two `frames` entries (one coloured, one neutral). Infers v5;
//         digest differs; `frames` is the trailing key in file order with the
//         §R5-2.1 per-entry key order; every node / edge byte === SG0's; the
//         diff is ONE `cosmetic` `frames` hunk, engine / advisory false.
//   SG2 — SG1 with every frame removed. Fails the v5 predicate;
//         digest_v5(SG2) === digest_v4(SG2) === digest_v4(SG0) — exact return.
//   SG3 — malformed `frames`: a NaN rect, a 0-height rect, an unknown colour, a
//         numeric id, a duplicate id, a 130-char label, and 201 entries. Each
//         is dropped / normalised per §R5-1.1; the good ones survive; the graph
//         loads.
//   SG5 — a loop-workspace/1 round-trip carries no `frames` in
//         `workspace.simulation`; the graph's `frames` survive (§R5-8).
//
// Regenerate the committed files with:  UPDATE_FIXTURE=1 npm test -- revision-v5-fixture

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision-v5')
const UPDATE = process.env.UPDATE_FIXTURE === '1'
const readOrWrite = (name: string, produce: () => unknown): unknown => {
  const path = resolve(DIR, name)
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, JSON.stringify(produce(), null, 2) + '\n')
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

const pool = (id: string, over: Record<string, unknown> = {}): LoopNode =>
  ({
    id,
    type: 'pool',
    position: { x: 0, y: 0 },
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...over },
  }) as LoopNode
const rEdge = (id: string, s: string, t: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }) as LoopEdge

const SG0_GRAPH = { nodes: [pool('a', { resourceType: 'gold' }), pool('b')], edges: [rEdge('e', 'a', 'b')] }
const FRAMES = [
  { id: 'f1', label: 'Green intake', rect: { x: 1, y: 2, w: 100, h: 50 } },
  { id: 'f2', label: 'Rewards', rect: { x: 5, y: 6, w: 80, h: 40 }, color: 'rose' as const },
]

// PINNED — the digest the shipped <= v4 projection produces for SG0.
const SG0_DIGEST = '8dcbffabd9ab26cc277261f896d28762ae7a366b6e1343c19a79ceb674165f38'
const SG1_DIGEST = '8986b2617bba8d983381ea6aa4ed1a1b237637ffd380a258188fe04ab0933bab'

describe('loop-revision/5 golden vector (SEMANTICS-R5.md §R5-4)', () => {
  it('SG0 — no frames: digest_v5 === digest_v4 === pinned; not v5', () => {
    const sg0 = readOrWrite('SG0.json', () =>
      JSON.parse(serialize(SG0_GRAPH.nodes, SG0_GRAPH.edges)),
    ) as { nodes: LoopNode[]; edges: LoopEdge[] }
    const c = canonicalContent(sg0)
    expect(c).not.toHaveProperty('frames')
    expect(digestOfCanonical(c)).toBe(SG0_DIGEST)
    // deserialize of the committed file yields no frames
    expect(deserialize(JSON.stringify(sg0)).frames).toEqual([])
  })

  it('SG1 — frames present: trailing key, file order, §R5-2.1 shape; digest differs; node/edge bytes unchanged', () => {
    const sg1 = readOrWrite('SG1.json', () =>
      JSON.parse(serialize(SG0_GRAPH.nodes, SG0_GRAPH.edges, undefined, undefined, undefined, 1, FRAMES)),
    ) as { nodes: LoopNode[]; edges: LoopEdge[]; frames: unknown }
    const c = canonicalContent(sg1)
    expect(Object.keys(c)[Object.keys(c).length - 1]).toBe('frames')
    expect(c.frames).toEqual([
      { id: 'f1', label: 'Green intake', rect: { x: 1, y: 2, w: 100, h: 50 } },
      { id: 'f2', label: 'Rewards', rect: { x: 5, y: 6, w: 80, h: 40 }, color: 'rose' },
    ])
    expect(digestOfCanonical(c)).toBe(SG1_DIGEST)
    expect(SG1_DIGEST).not.toBe(SG0_DIGEST)
    const c0 = canonicalContent(SG0_GRAPH)
    expect(canonicalJson({ nodes: c.nodes, edges: c.edges } as never)).toBe(
      canonicalJson({ nodes: c0.nodes, edges: c0.edges } as never),
    )
  })

  it('SG1 diff vs SG0 — ONE cosmetic `frames` hunk; engine/advisory false; not empty', () => {
    const d = computeRevisionDiff(canonicalContent(SG0_GRAPH), canonicalContent({ ...SG0_GRAPH, frames: FRAMES }))
    expect(d.summary).toMatchObject({
      framesChanged: true,
      engineAffecting: false,
      advisoryAffecting: false,
      empty: false,
      nodes: { added: 0, removed: 0, changed: 0 },
      edges: { added: 0, removed: 0, changed: 0 },
    })
    expect(d.frames?.base).toBeNull()
    expect(d.frames?.proposed).toHaveLength(2)
  })

  it('SG2 — v4 → v5 → v4: removing every frame returns the digest EXACTLY', () => {
    const withF = digestOfCanonical(canonicalContent({ ...SG0_GRAPH, frames: FRAMES }))
    const cleared = digestOfCanonical(canonicalContent({ ...SG0_GRAPH, frames: [] }))
    expect(withF).toBe(SG1_DIGEST)
    expect(cleared).toBe(SG0_DIGEST)
    const d = computeRevisionDiff(
      canonicalContent({ ...SG0_GRAPH, frames: FRAMES }),
      canonicalContent(SG0_GRAPH),
    )
    expect(d.frames).toEqual({ base: canonicalContent({ ...SG0_GRAPH, frames: FRAMES }).frames, proposed: null })
  })

  it('SG3 — malformed `frames`: bad entries dropped, good ones survive, the graph loads', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `x${i}`, label: `${i}`, rect: { x: i, y: 0, w: 5, h: 5 } }))
    const raw = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: SG0_GRAPH.nodes,
      edges: SG0_GRAPH.edges,
      frames: [
        { id: 'good', label: 'ok', rect: { x: 1, y: 2, w: 100, h: 50 }, color: 'sage' },
        { id: 'nan', label: 'x', rect: { x: NaN, y: 0, w: 1, h: 1 } },
        { id: 'flat', label: 'x', rect: { x: 0, y: 0, w: 5, h: 0 } },
        { id: 7, label: 'numid', rect: { x: 0, y: 0, w: 4, h: 4 } },
        { id: 'good', label: 'dup', rect: { x: 9, y: 9, w: 9, h: 9 } },
        { id: 'nocolor', label: 'y'.repeat(130), rect: { x: 0, y: 0, w: 4, h: 4 }, color: 'teal' },
        ...many, // pushes the total past SF_FRAMES_MAX (200)
      ],
    })
    const back = deserialize(raw)
    expect(back.nodes).toHaveLength(2) // graph loads
    expect(back.frames.length).toBeLessThanOrEqual(200)
    const good = back.frames.find((f) => f.label === 'ok')!
    expect(good.color).toBe('sage')
    expect(back.frames.find((f) => f.label === 'numid')?.id).toMatch(/^frame_/) // numeric id → fresh
    expect(back.frames.find((f) => f.label === 'dup')?.id).not.toBe('good') // clash → fresh
    expect(back.frames.find((f) => f.label.startsWith('y'))?.label).toHaveLength(120) // capped
    expect(back.frames.find((f) => f.label.startsWith('y'))).not.toHaveProperty('color') // unknown dropped
    expect(readSavedFrames(undefined)).toEqual([]) // absent ⇒ []
  })

  // SG4 — the v4 ↔ v5 combinations replayed through `computeThreeWay` /
  // `buildSelectiveApply` / `validateResultGraph` (SEMANTICS-R5.md §R5-4 /
  // §R5-6). `sel(frames?)` is a bare hunk selection; `withFrames(f)` a canonical
  // content with a `frames` array; `bare` = the ≤ v4 canonical content.
  const bare = canonicalContent(SG0_GRAPH)
  const withFrames = (f: unknown) => canonicalContent({ ...SG0_GRAPH, frames: f as never })
  const sel = (frames?: 'proposed' | 'yours') => ({ accept: {}, fieldChoices: {}, ...(frames ? { frames } : {}) })

  it('SG4a — v4 base, v5 proposed: ONE clean cosmetic `frames` hunk; selecting it swaps the whole array in, no node/edge byte moves; not selecting keeps none', () => {
    const plan = computeThreeWay(bare, bare, withFrames(FRAMES))
    expect(plan.hunks).toHaveLength(0) // no node / edge change
    expect(plan.nConf).toBe(0) // a CLEAN frames hunk never feeds nConf
    expect(plan.frames).toMatchObject({ kind: 'frames', verdict: 'clean', base: null, yours: null })
    expect(plan.frames?.proposed).toHaveLength(2)

    // select the frames hunk ⇒ the proposal's whole array, node/edge untouched
    const taken = buildSelectiveApply({
      target: SG0_GRAPH,
      proposedFull: { ...SG0_GRAPH, frames: FRAMES },
      plan,
      selection: sel('proposed'),
    })
    if (!taken.ok) throw new Error(taken.detail)
    expect(JSON.stringify(taken.nodes)).toBe(JSON.stringify(SG0_GRAPH.nodes))
    expect(JSON.stringify(taken.edges)).toBe(JSON.stringify(SG0_GRAPH.edges))
    expect(taken.frames).toEqual(FRAMES)
    expect(taken.frames).not.toBe(FRAMES) // deep-cloned, not aliased
    expect(validateResultGraph(taken.nodes, taken.edges).ok).toBe(true)
    // the applied result's digest is SG1's (v4 + the two frames)
    expect(
      digestOfCanonical(canonicalContent({ nodes: taken.nodes, edges: taken.edges, frames: taken.frames })),
    ).toBe(SG1_DIGEST)

    // NOT selecting it ⇒ `frames` undefined ⇒ the caller keeps the target (none)
    const kept = buildSelectiveApply({ target: SG0_GRAPH, proposedFull: { ...SG0_GRAPH, frames: FRAMES }, plan, selection: sel() })
    if (!kept.ok) throw new Error(kept.detail)
    expect(kept.frames).toBeUndefined()
  })

  it('SG4b — v5 base, v4 proposed: the `frames` hunk CLEARS the array; the applied digest returns to SG0 exactly', () => {
    const v5 = withFrames(FRAMES)
    const plan = computeThreeWay(v5, v5, bare)
    expect(plan.hunks).toHaveLength(0)
    expect(plan.nConf).toBe(0)
    expect(plan.frames).toMatchObject({ kind: 'frames', verdict: 'clean', proposed: null })
    expect(plan.frames?.base).toHaveLength(2)

    const cleared = buildSelectiveApply({
      target: SG0_GRAPH, // structurally identical; the v5 target's frames live outside the graph arrays
      proposedFull: { ...SG0_GRAPH }, // no `frames` ⇒ selecting the hunk clears
      plan,
      selection: sel('proposed'),
    })
    if (!cleared.ok) throw new Error(cleared.detail)
    expect(cleared.frames).toEqual([]) // an explicit empty array = "clear every frame"
    expect(
      digestOfCanonical(canonicalContent({ nodes: cleared.nodes, edges: cleared.edges, frames: cleared.frames })),
    ).toBe(SG0_DIGEST)
  })

  it('SG4c — v5 ↔ v5: a `frames` reorder / relabel with a divergent local edit is a CONFLICT and feeds nConf', () => {
    const base = withFrames(FRAMES)
    const mine = withFrames([{ ...FRAMES[0], label: 'Intake (mine)' }, FRAMES[1]]) // I renamed f1 locally
    const theirs = withFrames([FRAMES[1], { ...FRAMES[0], label: 'Intake (theirs)' }]) // they reordered + renamed
    const plan = computeThreeWay(base, mine, theirs)
    expect(plan.frames?.verdict).toBe('conflict')
    expect(plan.nConf).toBe(1) // §R5-6 — a frames conflict feeds nConf like a label conflict
    // a NON-divergent case (target still at base) is clean, nConf 0
    const clean = computeThreeWay(base, base, theirs)
    expect(clean.frames?.verdict).toBe('clean')
    expect(clean.nConf).toBe(0)
    // target already at the proposal ⇒ the hunk exists but is `noop` (the UI
    // filters `verdict === 'noop'` out of the actionable list)
    const noop = computeThreeWay(base, theirs, theirs)
    expect(noop.frames?.verdict).toBe('noop')
    expect(noop.nConf).toBe(0)
  })

  it('SG4d — ≤ v4 ↔ ≤ v4: no `frames` anywhere ⇒ the plan is byte-for-byte what loop-revision/3 · /4 produced', () => {
    const plan = computeThreeWay(bare, bare, bare)
    expect(plan.frames).toBeUndefined()
    expect(plan.nConf).toBe(0)
    expect(plan.hunks).toHaveLength(0)
  })

  it('SG4e — `readRevisionSide` version predicate: a surviving `frames` block ⇒ loop-revision/5; its digest verifies with the v5 projection', () => {
    const v5doc = { nodes: SG0_GRAPH.nodes, edges: SG0_GRAPH.edges, frames: FRAMES }
    const digest = digestOfCanonical(canonicalContent(v5doc))
    const side = readRevisionSide(v5doc, digest, 1)
    expect(side.ok && side.version).toBe('loop-revision/5')
    expect(side.ok && side.digestVerified).toBe(true)
    if (side.ok) expect(side.content.frames).toHaveLength(2)
    // a block whose entries were ALL dropped leaves nothing ⇒ the side infers
    // as ≤ v4 (here `loop-revision/2` — SG0_GRAPH's `a` carries a `resourceType`)
    const brokenOnly = readRevisionSide(
      { nodes: SG0_GRAPH.nodes, edges: SG0_GRAPH.edges, frames: [{ id: 'x', label: 'x', rect: { x: NaN, y: 0, w: 1, h: 1 } }] as never },
      undefined,
      1,
    )
    expect(brokenOnly.ok && brokenOnly.version).toBe('loop-revision/2')
  })

  it('SG5 — loop-workspace/1 round-trip: no `frames` in workspace.simulation; the graph keeps its frames', () => {
    const file = serialize(
      SG0_GRAPH.nodes,
      SG0_GRAPH.edges,
      undefined,
      buildWorkspacePayload({ pools: { a: 0 }, step: 0, seed: 1, tracked: [], mc: {} } as never),
      undefined,
      1,
      FRAMES,
    )
    const parsed = deserialize(file)
    expect(parsed.frames).toHaveLength(2) // graph's frames intact
    const ws = readWorkspace(parsed.workspace, { nodes: parsed.nodes, edges: parsed.edges })
    expect(JSON.stringify(ws)).not.toContain('"frames"')
  })
})
