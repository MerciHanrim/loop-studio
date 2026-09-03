import { describe, expect, it } from 'vitest'
import coffeeDoc from '../../../examples/coffee-roastery.json'
import mmoDoc from '../../../examples/mmo-progression.json'
import {
  analyzeStages,
  frameForeign,
  foreignBudget,
  suggestFrames,
  MAX_FRAMES,
  MAX_FRAME_FRACTION,
  MAX_OVERLAP_FRAC,
  MIN_FRAME_NODES,
  type AFEdge,
  type AFNode,
} from './autoFrames'

// docs/large-graph-readability-auto-frames.md §AF3.6 / §AF3.7 / §AF8 —
// review boundary 5, round 2. Three regression layers pinned separately:
//   Table A   — raw LP + merge-small + split-big (topology)
//   Table A′  — after spatial-cohesion split/drop + the S3 gate (split stage)
//   Table B   — final frames, plus the ACCEPTANCE CONTRACT asserted per frame
// Geometry is canonical (§AF8 / S9): `measured` is set to nonsense here to prove
// the algorithm ignores it.

type RawDoc = {
  nodes: { id: string; type: string; position: { x: number; y: number }; data?: { kind?: string } }[]
  edges: { source: string; target: string }[]
}

const toInputs = (
  doc: RawDoc,
  measured: AFNode['measured'] = { width: 999, height: 999 },
): { nodes: AFNode[]; edges: AFEdge[]; eligible: number } => {
  const nodes: AFNode[] = doc.nodes.map((nd) => ({
    id: nd.id,
    kind: nd.data?.kind ?? nd.type,
    position: nd.position,
    measured,
  }))
  return {
    nodes,
    edges: doc.edges.map((e) => ({ source: e.source, target: e.target })),
    eligible: nodes.filter((n) => n.kind !== 'parameter' && n.kind !== 'register').length,
  }
}

const rectOverlapFrac = (a: AFNode['position'] & { w: number; h: number }, b: typeof a): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h)
}

/** the §AF3.6 acceptance contract — asserted on every retained frame of every
 *  fixture and synthetic. */
function assertAcceptanceContract(frames: ReturnType<typeof suggestFrames>, nodes: AFNode[], eligible: number) {
  expect(frames.length).toBeLessThanOrEqual(MAX_FRAMES)
  for (const f of frames) {
    // S4 — no confetti
    expect(f.members.length).toBeGreaterThanOrEqual(MIN_FRAME_NODES)
    // S3 — no mega-frame
    expect(f.members.length).toBeLessThanOrEqual(MAX_FRAME_FRACTION * eligible)
    // S8 — spatially clean
    expect(frameForeign(f, nodes)).toBeLessThanOrEqual(foreignBudget(f.members.length))
  }
  // no kept pair overlaps > MAX_OVERLAP_FRAC of the smaller rect
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++)
      expect(rectOverlapFrac(frames[i].rect, frames[j].rect)).toBeLessThanOrEqual(MAX_OVERLAP_FRAC + 1e-9)
}

// ─────────────────────────────────────────────────────────────────────────
describe('Coffee roastery fixture — Table A / A′ / B', () => {
  const { nodes, edges, eligible } = toInputs(coffeeDoc as unknown as RawDoc)
  const stages = analyzeStages(nodes, edges)!
  const frames = suggestFrames(nodes, edges)

  it('Table A — raw LP + merge-small + split-big = [5, 4, 4]', () => {
    expect(stages.tableA).toEqual([5, 4, 4])
  })

  it("Table A′ — no group is contaminated, so the spatial pass is a no-op: [5, 4, 4], nothing dropped", () => {
    expect(stages.candidates).toEqual([5, 4, 4])
    expect(stages.drops).toEqual([])
  })

  it('Table B — exactly 3 frames, sizes {5, 4, 4}, coverage 13/13', () => {
    expect(frames.length).toBe(3)
    expect(frames.map((f) => f.members.length).sort((a, b) => b - a)).toEqual([5, 4, 4])
    expect(frames.reduce((s, f) => s + f.members.length, 0)).toBe(13)
    expect(eligible).toBe(13)
  })

  it('every retained frame satisfies the acceptance contract (S3/S4/S8 + overlap)', () => {
    assertAcceptanceContract(frames, nodes, eligible)
    expect(frames.every((f) => frameForeign(f, nodes) === 0)).toBe(true)
  })

  it('the 10 model nodes are never framed', () => {
    const modelIds = nodes.filter((n) => n.kind === 'parameter' || n.kind === 'register').map((n) => n.id)
    for (const f of frames) for (const id of f.members) expect(modelIds).not.toContain(id)
  })

  it('deterministic under input-array reversal', () => {
    expect(JSON.stringify(suggestFrames([...nodes].reverse(), [...edges].reverse()))).toBe(
      JSON.stringify(frames),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Early MMO fixture — Table A / A′ / B', () => {
  const { nodes, edges, eligible } = toInputs(mmoDoc as unknown as RawDoc)
  const stages = analyzeStages(nodes, edges)!
  const frames = suggestFrames(nodes, edges)

  it('Table A — raw LP + merge-small + split-big = [28, 18, 13, 10, 7, 7, 4, 3]', () => {
    expect(stages.tableA).toEqual([28, 18, 13, 10, 7, 7, 4, 3])
  })

  it("Table A′ — spatial cohesion splits the interleaved communities into 12 clean candidates and drops 7", () => {
    expect(stages.candidates).toEqual([10, 8, 7, 6, 4, 4, 4, 4, 3, 3, 3, 3])
    const noGap = stages.drops.filter((d) => d.reason === 'contaminated: no valid spatial gap')
    expect(noGap.map((d) => d.size).sort((a, b) => b - a)).toEqual([7, 6, 4, 4, 4, 3, 3])
  })

  it('Table B — exactly 6 frames, sizes {10, 8, 7, 6, 4, 4}, coverage 39/90', () => {
    expect(frames.length).toBe(6)
    expect(frames.map((f) => f.members.length).sort((a, b) => b - a)).toEqual([10, 8, 7, 6, 4, 4])
    expect(frames.reduce((s, f) => s + f.members.length, 0)).toBe(39)
    expect(eligible).toBe(90)
  })

  it('every retained frame satisfies the acceptance contract (S3/S4/S8 + overlap)', () => {
    assertAcceptanceContract(frames, nodes, eligible)
    // measured: max foreign / member is 0.50, max pairwise overlap is 0 %
    const maxFM = Math.max(...frames.map((f) => frameForeign(f, nodes) / f.members.length))
    expect(maxFM).toBeLessThanOrEqual(0.5 + 1e-9)
  })

  it('6 clean candidates lost to the MAX_FRAMES ceiling (a ceiling, not a target)', () => {
    const ceiling = stages.drops.filter((d) => d.reason === 'MAX_FRAMES ceiling reached')
    expect(ceiling.map((d) => d.size).sort((a, b) => b - a)).toEqual([4, 4, 3, 3, 3, 3])
  })

  it('coverage is in the reported range 0.35–0.50 (NOT back up toward 0.92)', () => {
    const cov = frames.reduce((s, f) => s + f.members.length, 0) / eligible
    expect(cov).toBeGreaterThanOrEqual(0.35)
    expect(cov).toBeLessThanOrEqual(0.5)
  })

  it('deterministic under input-array reversal', () => {
    expect(JSON.stringify(suggestFrames([...nodes].reverse(), [...edges].reverse()))).toBe(
      JSON.stringify(frames),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('canonical geometry — `measured` never changes the result (§AF8 / S9)', () => {
  for (const [name, doc] of [
    ['Coffee', coffeeDoc],
    ['MMO', mmoDoc],
  ] as [string, unknown][]) {
    it(`${name}: measured ∈ {150×40, unset, 320×96, 1×1} → byte-identical frames`, () => {
      const base = toInputs(doc as RawDoc, { width: 150, height: 40 })
      const ref = JSON.stringify(suggestFrames(base.nodes, base.edges))
      for (const m of [undefined, { width: 320, height: 96 }, { width: 1, height: 1 }] as AFNode['measured'][]) {
        const v = toInputs(doc as RawDoc, m)
        expect(JSON.stringify(suggestFrames(v.nodes, v.edges))).toBe(ref)
      }
    })
  }
})
