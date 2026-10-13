// docs/simulation-playback.md §PB4.8 — where each connection's travelling `+N`
// badge sits at L2: ONE of four places beside its token, chosen per connection
// from the layout before a step runs and never changed while the token moves
// (the approved "T3 without tail", 2026-10-13). Pure geometry in flow px; the
// caller samples the routes (an SVG path is the only source of a curve's
// points) and keeps the plan for as long as the layout is unchanged.

import { BADGE_PLACES, badgeBoxAt, type BadgePlace, type Box, overlaps } from './playbackBadge'

type Pt = { x: number; y: number }

/** one connection: its fan (connections leaving the same port of the same
 *  node), its route sampled at equal steps along its length, its end bodies */
export type PlanEdge = { id: string; fan: string; pts: Pt[]; from: string; to: string; source: Box; target: Box }

/** what a badge should not cover: every node's outside name and every node's
 *  body (a value is inside its body), tagged with the node they belong to */
export type PlanMark = Box & { node: string; kind: 'name' | 'body' }

/** samples along a fan compared at the same fraction of their routes, as their
 *  tokens travel together — an assumption: a staggered onset (§PBO2) puts
 *  them at different fractions (docs/simulation-playback.md §PB4.8 says what
 *  is guaranteed) */
const FAN_SAMPLES = 100
/** the most members tried exhaustively (4^5 = 1024 combinations); a larger fan
 *  is placed member by member */
const EXHAUSTIVE_MAX = 5

/** the badge is shown only while its WHOLE box is clear of both end bodies */
export const badgeClearOfEnds = (box: Box, source: Box, target: Box): boolean => !overlaps(box, source) && !overlaps(box, target)

type Scored = { shown: boolean[]; covers: number; share: number }

function score(e: PlanEdge, place: BadgePlace, width: number, marks: PlanMark[]): Scored {
  const shown = e.pts.map((p) => badgeClearOfEnds(badgeBoxAt(p.x, p.y, width, place), e.source, e.target))
  // only the marks this route can reach: its bounding box, grown by a badge
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of e.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  const reach: Box = { x0: x0 - width - 12, y0: y0 - 30, x1: x1 + width + 12, y1: y1 + 30 }
  // an end body is never met while the badge is shown; the end names count
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

/** lexicographic: fewer badge-on-badge moments in the fan, then fewer covered
 *  names and bodies, then the longer shown share, then today's place */
const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return false
}

function fanCost(members: PlanEdge[], combo: BadgePlace[], scored: Map<string, Scored>[], width: number): number[] {
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

/**
 * Choose each connection's badge place. `width` is the planning width of a
 * badge (a two-digit amount), so a plan does not depend on the amounts of one
 * step. Deterministic: the same layout always gives the same places.
 */
export function planBadgePlaces(edges: PlanEdge[], marks: PlanMark[], width: number): Map<string, BadgePlace> {
  const out = new Map<string, BadgePlace>()
  const fans = new Map<string, PlanEdge[]>()
  for (const e of edges) (fans.get(e.fan) ?? fans.set(e.fan, []).get(e.fan)!).push(e)
  for (const members of fans.values()) {
    members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const scored = members.map((m) => new Map(BADGE_PLACES.map((p) => [p, score(m, p, width, marks)] as const)))
    let best: { combo: BadgePlace[]; cost: number[] } | null = null
    if (members.length <= EXHAUSTIVE_MAX) {
      let combos: BadgePlace[][] = [[]]
      for (let i = 0; i < members.length; i++) combos = combos.flatMap((c) => BADGE_PLACES.map((p) => [...c, p]))
      for (const combo of combos) {
        const cost = fanCost(members, combo, scored, width)
        if (!best || better(cost, best.cost)) best = { combo, cost }
      }
    } else {
      // member by member, twice over, from today's place
      const combo: BadgePlace[] = members.map(() => 'up-right')
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < members.length; i++) {
          let pick = combo[i]!
          let pickCost = fanCost(members, combo, scored, width)
          for (const p of BADGE_PLACES) {
            const trial = combo.slice()
            trial[i] = p
            const cost = fanCost(members, trial, scored, width)
            if (better(cost, pickCost)) { pick = p; pickCost = cost }
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
