import { describe, expect, it } from 'vitest'
import {
  AUTO_FRAME_MIN,
  AUTO_FRAME_PAD,
  foreignBudget,
  frameForeign,
  MAX_FRAME_FRACTION,
  MAX_FRAMES,
  MIN_FRAME_NODES,
  suggestFrames,
  WORTH_IT_FLOOR,
  type AFEdge,
  type AFNode,
  type AutoFrameDrop,
} from './autoFrames'

// docs/large-graph-readability-auto-frames.md §AF3 / §AF8 — the pure clustering
// algorithm. Deterministic; model nodes excluded; drop-not-merge cap.

const n = (id: string, x: number, y: number, kind = 'pool'): AFNode =>
  ({ id, kind, position: { x, y }, measured: { width: 100, height: 40 } })
const e = (source: string, target: string): AFEdge => ({ source, target })

/** two well-separated blobs of `size` nodes each, chained; blob A around x=0,
 *  blob B around x=`sep`. Enough nodes to clear WORTH_IT_FLOOR. */
function twoBlobs(size: number, sep: number): { nodes: AFNode[]; edges: AFEdge[] } {
  const nodes: AFNode[] = []
  const edges: AFEdge[] = []
  for (let b = 0; b < 2; b++) {
    const base = b === 0 ? 0 : sep
    for (let i = 0; i < size; i++) {
      nodes.push(n(`${b}_${i}`, base + i * 30, b * 10, 'pool'))
      if (i > 0) edges.push(e(`${b}_${i - 1}`, `${b}_${i}`))
    }
    // make each blob dense so it stays one group
    for (let i = 0; i < size; i++) for (let j = i + 2; j < size; j++) edges.push(e(`${b}_${i}`, `${b}_${j}`))
  }
  // one thin bridge between the blobs
  edges.push(e(`0_${size - 1}`, `1_0`))
  return { nodes, edges }
}

describe('suggestFrames — determinism (§AF8)', () => {
  it('identical (nodes, edges) in ANY array order → byte-identical output', () => {
    const { nodes, edges } = twoBlobs(6, 4000)
    const a = suggestFrames(nodes, edges)
    const b = suggestFrames([...nodes].reverse(), [...edges].reverse())
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    // shuffle deterministically and re-check
    const shuffled = [...nodes].sort((x, y) => (x.id.split('').reverse().join('') < y.id.split('').reverse().join('') ? -1 : 1))
    expect(JSON.stringify(suggestFrames(shuffled, edges))).toBe(JSON.stringify(a))
  })

  it('frames are ordered by (rect.y, rect.x, first member id) and area is 1-based', () => {
    const { nodes, edges } = twoBlobs(6, 4000)
    const frames = suggestFrames(nodes, edges)
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames.map((f) => f.area)).toEqual(frames.map((_, i) => i + 1))
    for (let i = 1; i < frames.length; i++) {
      const p = frames[i - 1].rect
      const q = frames[i].rect
      expect(p.y < q.y || (p.y === q.y && p.x <= q.x)).toBe(true)
    }
  })
})

describe('suggestFrames — model nodes never take part (§AF3.5)', () => {
  it('parameter / register nodes are excluded from every frame', () => {
    const { nodes, edges } = twoBlobs(6, 4000)
    nodes.push(n('p1', 10, 500, 'parameter'), n('r1', 40, 500, 'register'))
    edges.push(e('p1', '0_0'), e('r1', '1_0')) // even if wired by a drawn edge
    const frames = suggestFrames(nodes, edges)
    for (const f of frames) {
      expect(f.members).not.toContain('p1')
      expect(f.members).not.toContain('r1')
    }
  })

  it('a graph of only parameters / registers → no frames, no throw', () => {
    const nodes = [n('p1', 0, 0, 'parameter'), n('r1', 100, 0, 'register'), n('p2', 200, 0, 'parameter')]
    expect(suggestFrames(nodes, [])).toEqual([])
  })
})

describe('suggestFrames — the "worth it" floor (§AF2.2)', () => {
  it('a component below WORTH_IT_FLOOR yields no frame for it', () => {
    const nodes: AFNode[] = []
    const edges: AFEdge[] = []
    for (let i = 0; i < WORTH_IT_FLOOR - 1; i++) {
      nodes.push(n(`s${i}`, i * 30, 0))
      if (i > 0) edges.push(e(`s${i - 1}`, `s${i}`))
    }
    expect(suggestFrames(nodes, edges)).toEqual([])
  })
})

describe('suggestFrames — the MAX_FRAMES ceiling drops, never merges (§AF3.6 rule 4)', () => {
  it('9 clean well-separated blobs → exactly 6 frames, the other 3 DROPPED (not merged)', () => {
    // 9 dense blobs of 5, far apart, DISCONNECTED — LP keeps them as 9 groups,
    // none is contaminated (far apart), so 9 clean candidates reach rule 4.
    const nodes: AFNode[] = []
    const edges: AFEdge[] = []
    const B = 9
    const S = 5
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < S; i++) {
        nodes.push(n(`${b}_${i}`, b * 5000 + i * 30, 0))
        for (let j = i + 1; j < S; j++) edges.push(e(`${b}_${i}`, `${b}_${j}`))
      }
    }
    const drops: AutoFrameDrop[] = []
    const frames = suggestFrames(nodes, edges, drops)
    expect(frames.length).toBe(MAX_FRAMES) // exactly 6
    for (const f of frames) expect(f.members.length).toBe(S)
    // the leftover 3 groups were DROPPED at the ceiling, not merged into a kept frame
    const ceiling = drops.filter((d) => d.reason === 'MAX_FRAMES ceiling reached')
    expect(ceiling.length).toBe(3)
    expect(frames.reduce((s, f) => s + f.members.length, 0)).toBe(6 * S) // 30 framed, 15 unframed
  })
})

describe('suggestFrames — spatial cohesion: split, or DROP (§AF3.6 rule 3, review boundary 5)', () => {
  it('a contaminated group that cannot be cleanly bisected is DROPPED, not kept', () => {
    // two topological communities fully interleaved along one row: A at even x,
    // B at odd x, no spatial gap to cut on. Each community bbox is full of the
    // other's nodes → contaminated → no valid cut → dropped.
    const nodes: AFNode[] = []
    const edges: AFEdge[] = []
    for (let i = 0; i < 8; i++) {
      nodes.push(n(`A${i}`, i * 200, 0))
      nodes.push(n(`B${i}`, i * 200 + 90, 0))
      for (let j = i + 1; j < 8; j++) {
        edges.push(e(`A${i}`, `A${j}`))
        edges.push(e(`B${i}`, `B${j}`))
      }
    }
    const drops: AutoFrameDrop[] = []
    const frames = suggestFrames(nodes, edges, drops)
    // every RETAINED frame is spatially clean
    for (const f of frames) {
      const foreign = frameForeign(f, nodes)
      expect(foreign).toBeLessThanOrEqual(foreignBudget(f.members.length))
    }
    expect(drops.some((d) => d.reason === 'contaminated: no valid spatial gap')).toBe(true)
    // the interleaved pathology yields almost nothing — a correct result
    expect(frames.reduce((s, f) => s + f.members.length, 0)).toBeLessThan(nodes.length / 2)
  })

  it('S3 gate (rule 3b): a spatially-clean survivor > 55 % of eligible is DROPPED', () => {
    // 9 blobs strung on single-edge bridges → LP collapses them into one blob;
    // split-big recurses only twice, leaving a > 55 %-of-graph group that is
    // spatially clean (foreign 0). Rule 3b drops it.
    const nodes: AFNode[] = []
    const edges: AFEdge[] = []
    const B = 9
    const S = 6
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < S; i++) {
        nodes.push(n(`${b}_${i}`, b * 5000 + i * 30, (b % 2) * 10))
        for (let j = i + 1; j < S; j++) edges.push(e(`${b}_${i}`, `${b}_${j}`))
      }
      if (b > 0) edges.push(e(`${b - 1}_${S - 1}`, `${b}_0`))
    }
    const drops: AutoFrameDrop[] = []
    const frames = suggestFrames(nodes, edges, drops)
    const eligible = nodes.length
    for (const f of frames) expect(f.members.length).toBeLessThanOrEqual(MAX_FRAME_FRACTION * eligible)
    expect(drops.some((d) => d.reason === 'exceeds MAX_FRAME_FRACTION: not spatially separable')).toBe(true)
  })
})

describe('suggestFrames — rect (§AF3.6 rule 4)', () => {
  it('the rect is the member bbox + AUTO_FRAME_PAD on each side, integer coords', () => {
    const { nodes, edges } = twoBlobs(6, 4000)
    const [f] = suggestFrames(nodes, edges)
    expect(Number.isInteger(f.rect.x)).toBe(true)
    expect(Number.isInteger(f.rect.w)).toBe(true)
    // members all inside the rect
    for (const id of f.members) {
      const node = nodes.find((nn) => nn.id === id)!
      expect(node.position.x).toBeGreaterThanOrEqual(f.rect.x)
      expect(node.position.x + 100).toBeLessThanOrEqual(f.rect.x + f.rect.w + 1)
    }
    expect(f.rect.w).toBeGreaterThanOrEqual(AUTO_FRAME_MIN)
    expect(f.rect.h).toBeGreaterThanOrEqual(AUTO_FRAME_MIN)
    // pad is applied
    const xs = f.members.map((id) => nodes.find((nn) => nn.id === id)!.position.x)
    expect(f.rect.x).toBe(Math.round(Math.min(...xs) - AUTO_FRAME_PAD))
  })
})

describe('suggestFrames — no mega-frame, no confetti (runtime properties S3/S4)', () => {
  it('one big weakly-structured component is split, not one giant frame', () => {
    // a long dense chain across a wide x-span with a big empty band in the middle
    const nodes: AFNode[] = []
    const edges: AFEdge[] = []
    const half = 12
    for (let i = 0; i < half; i++) {
      nodes.push(n(`L${i}`, i * 40, 0))
      if (i > 0) edges.push(e(`L${i - 1}`, `L${i}`))
      for (let j = i + 2; j < half; j++) if ((i + j) % 3 === 0) edges.push(e(`L${i}`, `L${j}`))
    }
    for (let i = 0; i < half; i++) {
      nodes.push(n(`R${i}`, 3000 + i * 40, 0)) // 3000px gap
      if (i > 0) edges.push(e(`R${i - 1}`, `R${i}`))
      for (let j = i + 2; j < half; j++) if ((i + j) % 3 === 0) edges.push(e(`R${i}`, `R${j}`))
    }
    edges.push(e(`L${half - 1}`, `R0`))
    const frames = suggestFrames(nodes, edges)
    const framed = frames.reduce((s, f) => s + f.members.length, 0)
    for (const f of frames) {
      expect(f.members.length).toBeGreaterThanOrEqual(MIN_FRAME_NODES) // no confetti
      expect(f.members.length / framed).toBeLessThan(0.75) // no single mega-frame
    }
    expect(frames.length).toBeGreaterThanOrEqual(2)
  })
})
