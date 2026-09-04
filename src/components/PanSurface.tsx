import { useEffect, useRef } from 'react'
import type { EdgeChange, NodeChange, Viewport } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { LoopEdge, LoopNode } from '../model/types'

// docs/dense-graph-pan.md — a transparent pan-capture layer over the canvas.
// Live on mobile (always — view / run only) and on desktop while Pan mode is
// on. It does the tap-vs-drag split itself (`PAN_SLOP` px): a drag drives
// `setViewport`; a tap resolves a target and selects it, in the order
// node → edge → empty canvas (§DGP-C1):
//   - node: GEOMETRICALLY — screen → flow coords → each node's
//     `{ position, measured }` box. DOM `elementFromPoint` can't be used
//     because React Flow makes non-draggable nodes non-hit-testable.
//   - edge: the nearest `.react-flow__edge-path` within `EDGE_TAP_TOL` (edges
//     are inside the `pointer-events: none` viewport, so `elementFromPoint`
//     misses them too). A pure-arithmetic reject on each edge's endpoint
//     bounding box narrows the candidates to a handful first, then only those
//     paths are sampled (`getPointAtLength` → shared `getScreenCTM()`), so a
//     graph with hundreds of edges still resolves a tap in well under a frame.
// A second pointer drops the overlay's `pointer-events` so React Flow's own
// pinch-zoom runs; it is restored when every pointer lifts.
//
// Zoom is deliberately left untouched (DGP0): `wheel` (plain and ctrl/trackpad-
// pinch) is forwarded to `.react-flow__pane` so d3-zoom still runs under the
// overlay. Double-click-to-zoom is suppressed while Pan mode is on — wheel /
// pinch / the Controls +/- cover it.
//
// `setViewport` / `getViewport` come from `Canvas`'s `useReactFlow()` (the
// connected one — a bare `useReactFlow()` from a component rendered outside
// `<ReactFlow>`'s subtree silently no-ops, the same issue `ModelPanels` hit).

const PAN_SLOP = 8
const DEFAULT_W = 60
const DEFAULT_H = 40
/** how close (screen px) a tap must land to an edge path to select it */
const EDGE_TAP_TOL = 14

export function PanSurface({
  active,
  setViewport,
  getViewport,
}: {
  active: boolean
  setViewport: (vp: Viewport) => void
  getViewport: () => Viewport
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let startVp: Viewport = { x: 0, y: 0, zoom: 1 }
    let moved = false
    let multi = false
    const down = new Set<number>()

    const restorePE = () => {
      el.style.pointerEvents = ''
    }

    /** screen point → id of the top-most (last-painted) visible node whose box
     *  contains it, or null. */
    const nodeAt = (clientX: number, clientY: number): string | null => {
      const rect = el.getBoundingClientRect()
      const vp = getViewport()
      const fx = (clientX - rect.left - vp.x) / vp.zoom
      const fy = (clientY - rect.top - vp.y) / vp.zoom
      let hit: string | null = null
      for (const n of useGraphStore.getState().nodes as LoopNode[]) {
        if (n.hidden) continue
        const w = n.measured?.width ?? DEFAULT_W
        const h = n.measured?.height ?? DEFAULT_H
        if (fx >= n.position.x && fx <= n.position.x + w && fy >= n.position.y && fy <= n.position.y + h) {
          hit = n.id
        }
      }
      return hit
    }

    /** screen point → id of the nearest edge whose drawn path passes within
     *  `EDGE_TAP_TOL` px, or null.
     *
     *  Two passes so a dense graph (many hundreds of edges) stays snappy on a
     *  tap:
     *   1. a pure-arithmetic reject on each edge's ENDPOINT bounding box — the
     *      `source` / `target` node boxes from the store, generously padded for
     *      Bézier bulge / orthogonal detours. No DOM, no layout.
     *   2. only for the few survivors, the precise test: sample the drawn
     *      `.react-flow__edge-path` and map each sample to screen space through
     *      the shared `getScreenCTM()` (every edge path sits in the one
     *      `.react-flow__viewport`, so the matrix is computed once).
     *  Pass 2 is authoritative; pass 1 only widens the candidate set, so a
     *  detour that escapes the padded box just costs one extra precise test.
     *
     *  Profiled against the 144-edge Early-MMO example: `getPointAtLength` is
     *  the entire cost (~28µs/call — DOM read, not layout) — arithmetic,
     *  `querySelectorAll`, `getTotalLength` are each < 2ms even unfiltered. So
     *  BOTH levers that cut total `getPointAtLength` calls matter: a tight
     *  pass-1 pad (route-aware — a default Bézier bulges far less than an
     *  orthogonal detour) and sampling every ~half an `EDGE_TAP_TOL` of path
     *  length instead of a fixed fraction of it (a full-tolerance spacing
     *  measured faster but occasionally picked the wrong one of two edges
     *  crossing a few px apart — this density is where that stopped). On the
     *  144-edge Early-MMO example a worst-case tap (dense crossing, ~35
     *  candidates) now costs ~900 total `getPointAtLength` calls / < 40ms —
     *  down from the un-tuned first pass's 3,887 calls / ~110ms. */
    const BEZIER_PAD = 60
    const ORTHOGONAL_PAD = 220
    const edgeAt = (clientX: number, clientY: number): string | null => {
      const rf = el.closest('.react-flow')
      if (!rf) return null
      const g = useGraphStore.getState()
      const rect = el.getBoundingClientRect()
      const vp = getViewport()
      const fx = (clientX - rect.left - vp.x) / vp.zoom
      const fy = (clientY - rect.top - vp.y) / vp.zoom
      const tapTolFlow = EDGE_TAP_TOL / vp.zoom

      const nbox = new Map<string, { x: number; y: number; w: number; h: number }>()
      for (const n of g.nodes as LoopNode[]) {
        if (n.hidden) continue
        nbox.set(n.id, {
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? DEFAULT_W,
          h: n.measured?.height ?? DEFAULT_H,
        })
      }
      const candidates = new Set<string>()
      for (const e of g.edges) {
        const s = nbox.get(e.source)
        const t = nbox.get(e.target)
        if (!s || !t) continue
        let minX = Math.min(s.x, t.x)
        let maxX = Math.max(s.x + s.w, t.x + t.w)
        let minY = Math.min(s.y, t.y)
        let maxY = Math.max(s.y + s.h, t.y + t.h)
        const routing = (e.data as { route?: 'orthogonal'; waypoints?: { x: number; y: number }[] } | undefined) ?? {}
        for (const w of routing.waypoints ?? []) {
          minX = Math.min(minX, w.x)
          maxX = Math.max(maxX, w.x)
          minY = Math.min(minY, w.y)
          maxY = Math.max(maxY, w.y)
        }
        const pad = tapTolFlow + (routing.route === 'orthogonal' ? ORTHOGONAL_PAD : BEZIER_PAD)
        if (fx >= minX - pad && fx <= maxX + pad && fy >= minY - pad && fy <= maxY + pad) candidates.add(e.id)
      }
      if (!candidates.size) return null

      // one forward scan of the (already-existing) edge list, skipping non-
      // candidates by a Set lookup — NOT one `querySelector` per candidate,
      // which on a dense graph was slower than the single-pass original.
      let hit: string | null = null
      let bestD = EDGE_TAP_TOL
      let ctm: DOMMatrix | null = null
      for (const gEl of rf.querySelectorAll<SVGGElement>('.react-flow__edge')) {
        const id = gEl.getAttribute('data-id')
        if (!id || !candidates.has(id)) continue
        const path = gEl.querySelector<SVGPathElement>('path.react-flow__edge-path')
        if (!path || typeof path.getTotalLength !== 'function') continue
        if (!ctm) ctm = path.getScreenCTM()
        const len = path.getTotalLength()
        if (!ctm || !len || !Number.isFinite(len)) continue
        // spaced ~half a tolerance-width apart. A full tolerance-width spacing
        // (half this density) measured faster but occasionally picked the
        // wrong one of two edges crossing within a few px of each other — this
        // is the density where that stopped happening on a 144-edge profile.
        const steps = Math.min(48, Math.max(6, Math.ceil(len / Math.max(tapTolFlow / 2, 8))))
        for (let i = 0; i <= steps; i += 1) {
          const p = path.getPointAtLength((len * i) / steps)
          const sx = ctm.a * p.x + ctm.c * p.y + ctm.e
          const sy = ctm.b * p.x + ctm.d * p.y + ctm.f
          const d = Math.hypot(sx - clientX, sy - clientY)
          if (d < bestD) {
            bestD = d
            hit = id
          }
        }
      }
      return hit
    }

    /** node → edge → empty; selects exactly one (or clears both). */
    const applySelection = (nodeId: string | null, edgeId: string | null) => {
      const g = useGraphStore.getState()
      g.setSelection(nodeId, edgeId)
      const nc: NodeChange<LoopNode>[] = []
      for (const n of g.nodes) {
        const want = n.id === nodeId
        if (Boolean(n.selected) !== want) nc.push({ id: n.id, type: 'select', selected: want })
      }
      if (nc.length) g.onNodesChange(nc)
      const ec: EdgeChange<LoopEdge>[] = []
      for (const ed of g.edges) {
        const want = ed.id === edgeId
        if (Boolean(ed.selected) !== want) ec.push({ id: ed.id, type: 'select', selected: want })
      }
      if (ec.length) g.onEdgesChange(ec)
    }

    const onDown = (e: PointerEvent) => {
      down.add(e.pointerId)
      if (down.size >= 2) {
        // a second finger — abandon any pan; drop our pointer-events so both
        // touches reach React Flow's pane and its pinch-zoom runs.
        multi = true
        pointerId = null
        el.style.pointerEvents = 'none'
        return
      }
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startVp = getViewport()
      moved = false
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported — window listeners below still finish the gesture */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (multi || e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) < PAN_SLOP) return
      moved = true
      // the viewport translate is in screen px, same units as the pointer delta
      setViewport({ x: startVp.x + dx, y: startVp.y + dy, zoom: startVp.zoom })
    }

    const onUp = (e: PointerEvent) => {
      const wasTracked = down.delete(e.pointerId)
      if (down.size === 0 && multi) {
        multi = false
        restorePE()
      }
      if (e.pointerId !== pointerId) return
      pointerId = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      if (!wasTracked || moved || multi) return // a pan (or a stale event) — no selection change
      // a tap — node beats edge beats empty canvas (§DGP-C1)
      const nid = nodeAt(e.clientX, e.clientY)
      applySelection(nid, nid ? null : edgeAt(e.clientX, e.clientY))
    }

    // Belt-and-braces: if a pointerup / cancel is ever missed (capture lost, an
    // OS gesture stole it) the `down` set would wedge the overlay into the
    // two-finger hand-off. A fresh single-pointer down with leftovers present
    // clears them; window-level up / cancel catches releases outside the box.
    const onDownGuard = (e: PointerEvent) => {
      if (down.size > 0 && !multi && ![...down].some((id) => el.hasPointerCapture?.(id))) {
        down.clear()
      }
      onDown(e)
    }
    const onCancel = (e: PointerEvent) => {
      moved = false
      onUp(e)
    }
    const onLost = () => {
      down.clear()
      pointerId = null
      multi = false
      restorePE()
    }

    // Zoom stays with React Flow (DGP0). d3-zoom's wheel handler is bound to
    // `.react-flow__pane`, which the overlay covers — so forward a clone of the
    // wheel there (deltas + client point + `ctrlKey` for trackpad pinch). The
    // pane is a sibling inside the same `.react-flow`.
    const pane = (): HTMLElement | null => el.closest('.react-flow')?.querySelector('.react-flow__pane') ?? null
    const onWheel = (e: WheelEvent) => {
      const p = pane()
      if (!p) return
      e.preventDefault()
      p.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          bubbles: true,
          cancelable: true,
        }),
      )
    }

    el.addEventListener('pointerdown', onDownGuard)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('lostpointercapture', onLost)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDownGuard)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('lostpointercapture', onLost)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      restorePE()
    }
  }, [active, setViewport, getViewport])

  return <div ref={ref} className={`pan-surface${active ? ' pan-surface--active' : ''}`} aria-hidden="true" />
}
