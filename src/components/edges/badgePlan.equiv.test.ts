// docs/simulation-playback.md §PB4.8 — the planner counts a fan's badge
// meetings once per pair of members and pair of places. This keeps the
// planner as it was before that change (moment by moment, every pair per
// combination), frozen as a reference, and asserts both choose the same place
// for every connection of random fans: sizes 1 to 7 (exhaustive up to 5,
// member by member past it), crossing and parallel routes, names and bodies
// around them, ties included (straight parallel lines tie often).

import { describe, expect, it } from 'vitest'
import { badgeClearOfEnds, planBadgePlaces, type PlanEdge, type PlanMark } from './badgePlan'
import { BADGE_PLACES, badgeBoxAt, type BadgePlace, type Box, overlaps } from './playbackBadge'

// ---- the reference: badgePlan.ts at 1a10660, verbatim but for names ----
const FAN_SAMPLES = 100
const EXHAUSTIVE_MAX = 5
type Scored = { shown: boolean[]; covers: number; share: number }

function refScore(e: PlanEdge, place: BadgePlace, width: number, marks: PlanMark[]): Scored {
  const shown = e.pts.map((p) => badgeClearOfEnds(badgeBoxAt(p.x, p.y, width, place), e.source, e.target))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of e.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  const reach: Box = { x0: x0 - width - 12, y0: y0 - 30, x1: x1 + width + 12, y1: y1 + 30 }
  const near = marks.filter((m) => overlaps(m, reach) && !(m.kind === 'body' && (m.node === e.from || m.node === e.to)))
  let covers = 0
  let count = 0
  e.pts.forEach((p, i) => {
    if (!shown[i]) return
    count++
    const b = badgeBoxAt(p.x, p.y, width, place)
    for (const m of near) if (overlaps(b, m)) covers++
  })
  return { shown, covers, share: e.pts.length ? count / e.pts.length : 0 }
}

const refBetter = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return false
}

function refFanCost(members: PlanEdge[], combo: BadgePlace[], scored: Map<string, Scored>[], width: number): number[] {
  let overlap = 0
  for (let k = 0; k <= FAN_SAMPLES && members.length > 1; k++) {
    const boxes = members.map((m, i) => {
      const s = scored[i]!.get(combo[i]!)!
      const j = Math.round((k / FAN_SAMPLES) * (m.pts.length - 1))
      const p = m.pts[j]
      return p && s.shown[j] ? badgeBoxAt(p.x, p.y, width, combo[i]!) : null
    })
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) if (boxes[a] && boxes[b] && overlaps(boxes[a]!, boxes[b]!)) overlap++
  }
  const covers = combo.reduce((s, p, i) => s + scored[i]!.get(p)!.covers, 0)
  const share = combo.reduce((s, p, i) => s + scored[i]!.get(p)!.share, 0) / combo.length
  return [overlap, covers, -Math.round(share * 1000), combo.filter((p) => p !== 'up-right').length]
}

function refPlan(edges: PlanEdge[], marks: PlanMark[], width: number): Map<string, BadgePlace> {
  const out = new Map<string, BadgePlace>()
  const fans = new Map<string, PlanEdge[]>()
  for (const e of edges) (fans.get(e.fan) ?? fans.set(e.fan, []).get(e.fan)!).push(e)
  for (const members of fans.values()) {
    members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const scored = members.map((m) => new Map(BADGE_PLACES.map((p) => [p, refScore(m, p, width, marks)] as const)))
    let best: { combo: BadgePlace[]; cost: number[] } | null = null
    if (members.length <= EXHAUSTIVE_MAX) {
      let combos: BadgePlace[][] = [[]]
      for (let i = 0; i < members.length; i++) combos = combos.flatMap((c) => BADGE_PLACES.map((p) => [...c, p]))
      for (const combo of combos) {
        const cost = refFanCost(members, combo, scored, width)
        if (!best || refBetter(cost, best.cost)) best = { combo, cost }
      }
    } else {
      const combo: BadgePlace[] = members.map(() => 'up-right')
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < members.length; i++) {
          let pick = combo[i]!
          let pickCost = refFanCost(members, combo, scored, width)
          for (const p of BADGE_PLACES) {
            const trial = combo.slice()
            trial[i] = p
            const cost = refFanCost(members, trial, scored, width)
            if (refBetter(cost, pickCost)) { pick = p; pickCost = cost }
          }
          combo[i] = pick
        }
      }
      best = { combo, cost: [] }
    }
    members.forEach((m, i) => out.set(m.id, best!.combo[i]!))
  }
  return out
}
// ---- end of the reference ----

/** a small seeded generator, so a failure names its case */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const polyline = (pts: { x: number; y: number }[], step = 2) => {
  const out: { x: number; y: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

function randomCase(seed: number): { edges: PlanEdge[]; marks: PlanMark[] } {
  const r = rng(seed)
  const edges: PlanEdge[] = []
  const marks: PlanMark[] = []
  const fans = 1 + Math.floor(r() * 3)
  for (let f = 0; f < fans; f++) {
    const sx = Math.round(r() * 600)
    const sy = Math.round(r() * 400)
    const src: Box = { x0: sx, y0: sy, x1: sx + 100, y1: sy + 64 }
    marks.push({ ...src, node: `s${f}`, kind: 'body' })
    marks.push({ x0: sx, y0: sy + 68, x1: sx + 80, y1: sy + 84, node: `s${f}`, kind: 'name' })
    const size = 1 + Math.floor(r() * 7)
    const parallel = r() < 0.4
    for (let m = 0; m < size; m++) {
      const tx = sx + 200 + Math.round(r() * 300)
      const ty = parallel ? sy + m * 8 : sy - 200 + Math.round(r() * 400)
      const tgt: Box = { x0: tx, y0: ty, x1: tx + 100, y1: ty + 64 }
      marks.push({ ...tgt, node: `t${f}-${m}`, kind: 'body' })
      if (r() < 0.5) marks.push({ x0: tx, y0: ty + 68, x1: tx + 90, y1: ty + 84, node: `t${f}-${m}`, kind: 'name' })
      const out = { x: sx + 100, y: sy + 32 }
      const bendX = out.x + 40 + Math.round(r() * 80)
      const pts = parallel ? polyline([out, { x: tx, y: out.y + m * 6 }]) : polyline([out, { x: bendX, y: out.y }, { x: bendX, y: ty + 32 }, { x: tx, y: ty + 32 }])
      edges.push({ id: `f${f}-e${m}`, fan: `s${f}|right`, pts, from: `s${f}`, to: `t${f}-${m}`, source: src, target: tgt })
    }
  }
  return { edges, marks }
}

describe('planBadgePlaces — the per-pair count chooses what the moment-by-moment count chose', () => {
  it('on 150 random fans (sizes 1 to 7), every connection gets the same place', () => {
    let connections = 0
    let notUpRight = 0
    for (let seed = 1; seed <= 150; seed++) {
      const { edges, marks } = randomCase(seed)
      const want = refPlan(edges.map((e) => ({ ...e })), marks, 26)
      const got = planBadgePlaces(edges.map((e) => ({ ...e })), marks, 26)
      for (const e of edges) {
        expect(got.get(e.id), `seed ${seed}, ${e.id}`).toBe(want.get(e.id))
        connections++
        if (want.get(e.id) !== 'up-right') notUpRight++
      }
    }
    // the cases are not all trivial: many connections leave today's place
    expect(connections).toBeGreaterThan(300)
    expect(notUpRight).toBeGreaterThan(50)
    // the reference is the slow planner (about 1.4 s alone); room for a loaded run
  }, 30_000)
})

// Boundaries and ties, where a tiny difference in a route's points could
// change a plan: a badge exactly on a mark's or another badge's edge (boxes
// that touch do not overlap), the same 1e-6 px past it, and costs that tie
// to the last criterion. Each case: both planners agree, and the place is pinned.
describe('planBadgePlaces — on a boundary and on a tie', () => {
  const SRC: Box = { x0: 0, y0: 0, x1: 100, y1: 64 }
  const TGT: Box = { x0: 400, y0: 0, x1: 500, y1: 64 }
  /** a horizontal route at y from x 100 to 400, points exactly 2 px apart */
  const run = (y: number) => Array.from({ length: 151 }, (_, i) => ({ x: 100 + 2 * i, y }))
  const one = (id: string, y: number): PlanEdge => ({ id, fan: 'src|right', pts: run(y), from: 'src', to: `${id}-t`, source: SRC, target: TGT })
  const both = (edges: PlanEdge[], marks: PlanMark[]) => {
    const want = refPlan(edges.map((e) => ({ ...e })), marks, 26)
    const got = planBadgePlaces(edges.map((e) => ({ ...e })), marks, 26)
    for (const e of edges) expect(got.get(e.id), e.id).toBe(want.get(e.id))
    return got
  }

  it('a name whose bottom edge touches the up-right badge’s top is not covered; 1e-6 px lower, it is', () => {
    // the up-right badge at (x, 32) spans y 14.5–27.5
    const name = (y1: number): PlanMark => ({ x0: 180, y0: y1 - 16, x1: 260, y1, node: 'other', kind: 'name' })
    // right and left places are shown for the same number of points (135 each):
    // the costs tie to the last criterion, and today's place wins
    expect(both([one('e', 32)], [name(14.5)]).get('e')).toBe('up-right')
    expect(both([one('e', 32)], [name(14.5 + 1e-6)]).get('e')).toBe('down-right')
  })

  it('two badges of one fan exactly 13 px apart (the badge height) touch and do not meet; 1e-6 px closer, one moves', () => {
    const apart = both([one('a', 32), one('b', 45)], [])
    expect([apart.get('a'), apart.get('b')]).toEqual(['up-right', 'up-right'])
    // the first combination of the lowest cost, in the enumeration order
    const closer = both([one('a', 32), one('b', 45 - 1e-6)], [])
    expect([closer.get('a'), closer.get('b')]).toEqual(['up-right', 'down-right'])
  })

  it('a badge exactly on the target body’s edge is shown; the planner’s shown share counts it', () => {
    // up-right at x = 368 spans x 374–400: it touches the body at 400
    expect(badgeClearOfEnds(badgeBoxAt(368, 32, 26, 'up-right'), SRC, TGT)).toBe(true)
    expect(badgeClearOfEnds(badgeBoxAt(368 + 1e-6, 32, 26, 'up-right'), SRC, TGT)).toBe(false)
    // in the plan: with the body at 400 the right and left places are shown for
    // the same 135 points and today's place wins the tie; with the body 1e-6 px
    // nearer, the right places lose that last point and a left place is longer shown
    expect(both([one('e', 32)], []).get('e')).toBe('up-right')
    const nearer = { ...one('e', 32), target: { ...TGT, x0: 400 - 1e-6 } }
    expect(both([nearer], []).get('e')).toBe('up-left')
  })
})
