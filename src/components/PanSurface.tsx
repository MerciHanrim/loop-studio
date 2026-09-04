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
//
// PINCH IS HANDLED HERE, NOT HANDED OFF TO REACT FLOW. The first cut dropped
// `pointer-events` on a 2nd pointer so RF's own pane would see both touches
// and run its own `zoomOnPinch` — real-device testing showed this never
// actually zooms. Root cause: the 1st finger's `pointerdown` was captured by
// THIS element (`setPointerCapture`) while the overlay was still the hit
// target, so `.react-flow__pane` never receives that finger's down/move at
// all, capture or no capture — d3-zoom's pinch math needs both touches on the
// SAME element and only ever sees the 2nd. So the overlay now computes pinch
// zoom itself from the two live pointers' distance and midpoint, incrementally
// each move (previous distance/midpoint → this move's, not a fixed gesture-
// start baseline — that also naturally covers translating while pinching).
//
// The mode state machine:
//   0 pointers down  → 'idle'
//   1 pointer down    → 'pan' (existing tap-vs-drag path)
//   2 pointers down   → 'pinch' (cancels any in-progress 'pan'; a 3rd+ finger
//                        is tracked but ignored — the first two pointer ids
//                        that started the pinch keep driving it)
//   2 → 1 (mid-pinch)  → 'settling': the remaining finger does NOTHING (no pan
//                        resumes, no jump) until it also lifts
//   settling → 0        → 'idle', ready for a genuinely fresh gesture
// A `pointercancel` / `lostpointercapture` at any point resets straight to
// 'idle' without resolving a tap (§DGP-C2) — the next fresh pointerdown always
// starts clean, whichever mode the interruption happened in.
//
// Zoom via wheel is deliberately left untouched (DGP0): `wheel` (plain and
// ctrl/trackpad-pinch) is forwarded to `.react-flow__pane` so d3-zoom still
// runs under the overlay for that input — wheel is a single continuous stream
// on one element, so it doesn't hit the two-touches-on-two-elements problem
// pinch does. Double-click-to-zoom is suppressed while Pan mode is on — wheel
// / pinch / the Controls +/- cover it.
//
// `setViewport` / `getViewport` come from `Canvas`'s `useReactFlow()` (the
// connected one — a bare `useReactFlow()` from a component rendered outside
// `<ReactFlow>`'s subtree silently no-ops, the same issue `ModelPanels` hit).

const PAN_SLOP = 8
const DEFAULT_W = 60
const DEFAULT_H = 40
/** how close (screen px) a tap must land to an edge path to select it */
const EDGE_TAP_TOL = 14
/** below this pointer separation (px) a distance RATIO is too noisy to trust —
 *  hold the zoom steady rather than divide by a near-zero denominator */
const PINCH_MIN_DIST = 4

export function PanSurface({
  active,
  setViewport,
  getViewport,
  minZoom,
  maxZoom,
}: {
  active: boolean
  setViewport: (vp: Viewport) => void
  getViewport: () => Viewport
  minZoom: number
  maxZoom: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    type Mode = 'idle' | 'pan' | 'pinch' | 'settling'
    let mode: Mode = 'idle'
    const pointers = new Map<number, { x: number; y: number }>()

    // 'pan' state
    let panId: number | null = null
    let startX = 0
    let startY = 0
    let startVp: Viewport = { x: 0, y: 0, zoom: 1 }
    let moved = false

    // 'pinch' state — the two pointer ids driving it, and the PREVIOUS
    // midpoint / distance (updated every move) so zoom + pan are computed
    // incrementally frame-to-frame, not against a fixed gesture-start baseline
    let pinchIds: [number, number] | null = null
    let pinchMid = { x: 0, y: 0 }
    let pinchDist = 0

    const resetAll = () => {
      pointers.clear()
      mode = 'idle'
      panId = null
      pinchIds = null
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

    const startPinch = (id1: number, id2: number) => {
      mode = 'pinch'
      pinchIds = [id1, id2]
      const p1 = pointers.get(id1)!
      const p2 = pointers.get(id2)!
      pinchMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      pinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    }

    /** distance-ratio zoom + midpoint-tracks-the-same-flow-point pan, computed
     *  incrementally from THIS move's distance/midpoint vs the previous one —
     *  not a fixed gesture-start baseline, so translating while pinching (real
     *  fingers rarely hold a perfectly still centre) falls out for free. */
    const updatePinch = () => {
      if (!pinchIds) return
      const p1 = pointers.get(pinchIds[0])
      const p2 = pointers.get(pinchIds[1])
      if (!p1 || !p2) return
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (dist < PINCH_MIN_DIST || pinchDist < PINCH_MIN_DIST) {
        pinchMid = mid
        pinchDist = dist
        return
      }
      const vp = getViewport()
      const zoom = Math.min(maxZoom, Math.max(minZoom, vp.zoom * (dist / pinchDist)))
      // the flow point under the PREVIOUS midpoint, read against the CURRENT
      // (pre-update) viewport, re-anchored under THIS move's midpoint
      const flowX = (pinchMid.x - vp.x) / vp.zoom
      const flowY = (pinchMid.y - vp.y) / vp.zoom
      setViewport({ x: mid.x - flowX * zoom, y: mid.y - flowY * zoom, zoom })
      pinchMid = mid
      pinchDist = dist
    }

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported — window listeners below still finish the gesture */
      }
      if (pointers.size === 1) {
        if (mode === 'settling') return // still waiting for the last finger to lift
        mode = 'pan'
        panId = e.pointerId
        startX = e.clientX
        startY = e.clientY
        startVp = getViewport()
        moved = false
      } else if (pointers.size === 2) {
        // a 2nd finger — abandon any single-pointer pan and start pinch;
        // ignore a 3rd+ (kept in `pointers` so it un-wedges cleanly on lift,
        // but the original pair keeps driving the gesture)
        panId = null
        const ids = [...pointers.keys()]
        startPinch(ids[0], ids[1])
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (mode === 'pinch') {
        updatePinch()
        return
      }
      if (mode !== 'pan' || e.pointerId !== panId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) < PAN_SLOP) return
      moved = true
      // the viewport translate is in screen px, same units as the pointer delta
      setViewport({ x: startVp.x + dx, y: startVp.y + dy, zoom: startVp.zoom })
    }

    /** a pointer physically lifted — may resolve a tap. Never runs the tap
     *  path out of a pinch (or its 2→1 `settling` tail): only a clean single-
     *  pointer 'pan' gesture that never crossed `PAN_SLOP` is a tap. */
    const onUp = (e: PointerEvent) => {
      const wasTracked = pointers.delete(e.pointerId)
      // the window-level listeners exist to catch OUR pointer releasing
      // outside the element's box — an id we never tracked is unrelated
      // window noise and must not perturb `mode` (e.g. a stray up firing
      // mid-pinch that isn't one of the two pinching fingers).
      if (!wasTracked) return
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      if (mode === 'pinch') {
        // only a release of one of the two DRIVING fingers ends the pinch —
        // an incidental 3rd finger lifting leaves the actual pinch untouched
        const wasDriver = pinchIds != null && (e.pointerId === pinchIds[0] || e.pointerId === pinchIds[1])
        if (wasDriver) {
          mode = pointers.size === 0 ? 'idle' : 'settling' // 2→1: wait, don't resume a pan
          if (pointers.size === 0) pinchIds = null
        }
        return
      }
      if (mode === 'settling') {
        if (pointers.size === 0) mode = 'idle'
        return
      }
      // mode === 'pan'
      if (e.pointerId !== panId) return
      panId = null
      mode = 'idle'
      if (moved) return // a completed drag — no selection change
      // a tap — node beats edge beats empty canvas (§DGP-C1)
      const nid = nodeAt(e.clientX, e.clientY)
      applySelection(nid, nid ? null : edgeAt(e.clientX, e.clientY))
    }

    // Belt-and-braces: if a pointerup / cancel is ever missed (an OS gesture
    // stole it without one) leftover entries would wedge the overlay. The
    // signal is `isPrimary` — the user agent's OWN "no other same-type
    // pointer is currently active" flag (spec-defined, unaffected by whether
    // our own `setPointerCapture` calls happened to succeed — capture can
    // silently not take, and a synthetic test event never gets it at all, so
    // that isn't a reliable "is this pointer still really down" signal). A
    // pointerdown the browser itself considers primary while we still have
    // tracked pointers means those are ghosts from a missed cleanup — clear
    // them (§DGP-C2); window-level up / cancel catches releases outside the
    // box for pointers that ARE still legitimately ours.
    const onDownGuard = (e: PointerEvent) => {
      if (e.isPrimary && pointers.size > 0) {
        resetAll()
      }
      onDown(e)
    }
    // A cancel is an INTERRUPTION (the OS took the touch), never a completed
    // gesture — clean up but never resolve a tap (§DGP-C2).
    const onCancel = (e: PointerEvent) => {
      const wasTracked = pointers.delete(e.pointerId)
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      if (!wasTracked) return
      if (pointers.size === 0) {
        resetAll()
        return
      }
      if (mode === 'pan' && e.pointerId === panId) {
        mode = 'settling' // the panning finger itself was interrupted
        panId = null
      } else if (mode === 'pinch') {
        // same "only a driving finger ends it" rule as onUp
        const wasDriver = pinchIds != null && (e.pointerId === pinchIds[0] || e.pointerId === pinchIds[1])
        if (wasDriver) {
          mode = 'settling'
          pinchIds = null
        }
      }
    }
    const onLost = () => {
      resetAll()
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
    }
  }, [active, setViewport, getViewport, minZoom, maxZoom])

  return <div ref={ref} className={`pan-surface${active ? ' pan-surface--active' : ''}`} aria-hidden="true" />
}
