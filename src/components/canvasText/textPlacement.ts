// docs/canvas-text-layer.md — where the canvas text layer puts a zone's name
// and the selected node's name, as pure functions over screen boxes (the
// layer's own coordinates: 0,0 is the pane's top-left). The rules are the
// colour review's text basis (2026-11-11): `t8`, zone names kept on the top
// border (`ztop` + `zstick`), one selected name on a background chip (`nbg`),
// zone names first during a drag (`zprio`), and the canvas edge, option (ii).

/** a box in layer px: left, top, width, height */
export type Box = { x: number; y: number; w: number; h: number }

/** a label is drawn on the layer only while the text it stands for is under
 *  this many px on screen (`t8`) */
export const TEXT_SHOW_PX = 8
/** the zone name chip's own font size on the canvas (index.css `.lgr-frame__label`) */
export const ZONE_TEXT_PX = 11
/** a node name's font size on the canvas */
export const NODE_TEXT_PX = 13
/** the selected name's distance from its node: 8 px, then 14 px if every side covers something */
export const NODE_GAPS = [8, 14] as const

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (r: Box, pane: Box): boolean => r.x >= pane.x && r.x + r.w <= pane.x + pane.w && r.y >= pane.y && r.y + r.h <= pane.y + pane.h
/** how many line points (x, y pairs) lie strictly inside `r` */
export function pointsIn(r: Box, pts: ArrayLike<number>): number {
  let n = 0
  const x1 = r.x + r.w, y1 = r.y + r.h
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1]
    if (x > r.x && x < x1 && y > r.y && y < y1) n++
  }
  return n
}

/** what a placement must keep off: node symbols, line points, labels placed before it */
export type Obstacles = { pane: Box; nodes: Box[]; pts: ArrayLike<number>; placed: Box[] }

/** whether a zone's name goes on the layer: its chip's text under 8 px on
 *  screen, and at least half the zone in view */
export function zoneOnLayer(zoom: number, zone: Box, pane: Box): boolean {
  if (ZONE_TEXT_PX * zoom >= TEXT_SHOW_PX) return false
  const vw = Math.max(0, Math.min(zone.x + zone.w, pane.x + pane.w) - Math.max(zone.x, pane.x))
  const vh = Math.max(0, Math.min(zone.y + zone.h, pane.y + pane.h) - Math.max(zone.y, pane.y))
  return vw * vh >= 0.5 * zone.w * zone.h
}

/** whether the selected node's name goes on the layer */
export const nodeOnLayer = (zoom: number): boolean => NODE_TEXT_PX * zoom < TEXT_SHOW_PX

/** a zone name's kept place: standing on the top border (row 0) or hanging just inside it (row 1), at `frac` of the zone's width */
export type ZoneSlot = { row: 0 | 1; frac: number }
export type ZonePlacement = { at: Box; slot: ZoneSlot; fallback: boolean; rechosen: '' | 'fit' | 'node' | 'label' }

/**
 * A zone name of size `w`×`h` on zone `zone`. A kept place stays (a pan moves
 * zone and name together; a route change is no reason); it is chosen again
 * only when, there, the name would no longer fit the zone's width, or would
 * cover a node or a label placed before it — and during a drag, only for the
 * width (zone names first: a node passing under a name never moves it). A
 * place is chosen along the top border, left to right, standing on it, then
 * hanging inside it: the first that covers no node, label or line; else the one
 * that crosses the fewest line points and covers no node.
 */
export function placeZone(zone: Box, w: number, h: number, kept: ZoneSlot | null, o: Obstacles, dragging: boolean): ZonePlacement {
  const at = (s: ZoneSlot): Box => ({ x: zone.x + s.frac * zone.w, y: s.row === 0 ? zone.y - h : zone.y + 2, w, h })
  let rechosen: ZonePlacement['rechosen'] = ''
  if (kept) {
    const r = at(kept)
    const why = r.x + r.w > zone.x + zone.w + 0.5 ? 'fit' : o.nodes.some((b) => overlaps(r, b)) ? 'node' : o.placed.some((b) => overlaps(r, b)) ? 'label' : ''
    if (!why || (dragging && why !== 'fit')) return { at: r, slot: kept, fallback: false, rechosen: '' }
    rechosen = why
  }
  const room = Math.max(0, zone.w - w)
  const steps = Math.max(1, Math.round(room / 8))
  const cands: ZoneSlot[] = []
  for (const row of [0, 1] as const) for (let k = 0; k <= steps; k++) cands.push({ row, frac: room ? (k * room) / steps / zone.w : 0 })
  for (const s of cands) {
    const r = at(s)
    if (inside(r, o.pane) && pointsIn(r, o.pts) === 0 && !o.nodes.some((b) => overlaps(r, b)) && !o.placed.some((b) => overlaps(r, b))) return { at: r, slot: s, fallback: false, rechosen }
  }
  let best = Infinity, pick = cands[0]
  for (const s of cands) {
    const r = at(s)
    const n = pointsIn(r, o.pts) + (o.nodes.some((b) => overlaps(r, b)) ? 1e6 : 0)
    if (n < best) { best = n; pick = s }
  }
  return { at: at(pick), slot: pick, fallback: true, rechosen }
}

/** the selected name's kept side: index into the eight directions, and its distance */
export type NodeSlot = { id: string; k: number; g: number }
export type NodeHidden = '' | 'offscreen' | 'cover-node' | 'cover-ring' | 'cover-label' | 'edge'
export type NodePlacement = { at: Box; slot: NodeSlot; hidden: NodeHidden; fallback: boolean; rechosen: '' | 'node' | 'ring' | 'label'; shifted: boolean }

/** the eight places around a node's box `nf`, `g` px out: below, right, left, above, then the diagonals */
export function nodeDirs(nf: Box, w: number, h: number, g: number): Box[] {
  const cx = nf.x + nf.w / 2, cy = nf.y + nf.h / 2
  const right = nf.x + nf.w, bottom = nf.y + nf.h
  return ([
    [cx - w / 2, bottom + g], [right + g, cy - h / 2], [nf.x - g - w, cy - h / 2], [cx - w / 2, nf.y - g - h],
    [right + g, bottom + g], [nf.x - g - w, bottom + g], [right + g, nf.y - g - h], [nf.x - g - w, nf.y - g - h],
  ] as const).map(([x, y]) => ({ x, y, w, h }))
}

/**
 * The selected node's name, `w`×`h`, around its box `nf` (its symbol `own`,
 * its selection ring `ring`). `o.nodes` holds every node's symbol, its own
 * included. The rules (`zprio`, edge option ii):
 *  - its node off screen: hidden, its side kept;
 *  - a kept side that covers another node, the ring or a label: during a drag
 *    hidden there (side kept); otherwise chosen again, once;
 *  - a new side: 8 px out, then 14, never off the pane, on a node, a label or
 *    the ring; the one crossing the fewest line points;
 *  - at the canvas edge: slid inward on the SAME side just enough to be whole,
 *    shown only if there it covers no node (its own included), the ring or a
 *    label; otherwise hidden — never cut, never moved to another side.
 */
export function placeNode(id: string, nf: Box, own: Box, ring: Box, w: number, h: number, kept: NodeSlot | null, o: Obstacles, dragging: boolean): NodePlacement {
  const others = o.nodes.filter((b) => !(b.x === own.x && b.y === own.y && b.w === own.w && b.h === own.h))
  let slot = kept && kept.id === id ? kept : null
  let at: Box | null = null
  let hidden: NodeHidden = ''
  let rechosen: NodePlacement['rechosen'] = ''
  let fallback = false
  const off = own.x + own.w < o.pane.x || own.x > o.pane.x + o.pane.w || own.y + own.h < o.pane.y || own.y > o.pane.y + o.pane.h
  if (off) {
    hidden = 'offscreen'
    at = nodeDirs(nf, w, h, slot?.g ?? NODE_GAPS[0])[slot?.k ?? 0]
    return { at, slot: slot ?? { id, k: 0, g: NODE_GAPS[0] }, hidden, fallback, rechosen, shifted: false }
  }
  if (slot) {
    const r = nodeDirs(nf, w, h, slot.g)[slot.k]
    const why = others.some((b) => overlaps(r, b)) ? 'node' : overlaps(r, ring) ? 'ring' : o.placed.some((b) => overlaps(r, b)) ? 'label' : ''
    if (!why) at = r
    else if (dragging) { at = r; hidden = `cover-${why}` }
    else { rechosen = why; slot = null }
  }
  if (!at) {
    for (const g of NODE_GAPS) {
      let best = Infinity
      nodeDirs(nf, w, h, g).forEach((r, k) => {
        if (!inside(r, o.pane) || o.nodes.some((b) => overlaps(r, b)) || o.placed.some((b) => overlaps(r, b)) || overlaps(r, ring)) return
        const n = pointsIn(r, o.pts)
        if (n < best) { best = n; at = r; slot = { id, k, g } }
      })
      if (at) break
    }
  }
  if (!at || !slot) { at = nodeDirs(nf, w, h, NODE_GAPS[0])[0]; slot = { id, k: 0, g: NODE_GAPS[0] }; fallback = true }
  let shifted = false
  if (!hidden && !inside(at, o.pane)) {
    const fits = w <= o.pane.w && h <= o.pane.h
    const s: Box = { x: Math.min(Math.max(at.x, o.pane.x), o.pane.x + o.pane.w - w), y: Math.min(Math.max(at.y, o.pane.y), o.pane.y + o.pane.h - h), w, h }
    if (!fits || o.nodes.some((b) => overlaps(s, b)) || overlaps(s, ring) || o.placed.some((b) => overlaps(s, b))) hidden = 'edge'
    else { at = s; shifted = true }
  }
  return { at, slot, hidden, fallback, rechosen, shifted }
}
