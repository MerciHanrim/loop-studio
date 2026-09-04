import { useEffect, useRef } from 'react'
import type { Viewport } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'

// SPIKE (docs/dense-graph-pan.md) — a transparent pan-capture layer over the
// canvas. Active on mobile (always) and on desktop when Pan mode is on. It does
// the tap-vs-drag discrimination itself (PAN_SLOP px), drives `setViewport` on a
// drag, resolves a tap to a node GEOMETRICALLY (not via `elementFromPoint` — RF
// makes non-draggable nodes non-hit-testable) and selects it, and steps aside
// for a two-finger gesture so React Flow's own pinch-zoom runs.
//
// `setViewport` / `getViewport` are passed in from `Canvas` (whose
// `useReactFlow()` is the connected one — a bare `useReactFlow()` from a
// component rendered outside `<ReactFlow>`'s subtree silently no-ops, the same
// issue `ModelPanels` hit).

const PAN_SLOP = 8
const DEFAULT_W = 60
const DEFAULT_H = 40

type NodeBox = { id: string; x: number; y: number; w: number; h: number }

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

    /** screen point → the top-most node whose box contains it (last painted wins). */
    const nodeAt = (clientX: number, clientY: number): string | null => {
      const rect = el.getBoundingClientRect()
      const vp = getViewport()
      const fx = (clientX - rect.left - vp.x) / vp.zoom
      const fy = (clientY - rect.top - vp.y) / vp.zoom
      const ns = useGraphStore.getState().nodes as unknown as {
        id: string
        position: { x: number; y: number }
        measured?: { width?: number; height?: number }
        hidden?: boolean
      }[]
      let hitId: string | null = null
      for (const n of ns) {
        if (n.hidden) continue
        const b: NodeBox = {
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? DEFAULT_W,
          h: n.measured?.height ?? DEFAULT_H,
        }
        if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) hitId = b.id
      }
      return hitId
    }

    const onDown = (e: PointerEvent) => {
      down.add(e.pointerId)
      if (down.size >= 2) {
        // a second finger — abandon any pan and let React Flow's pinch take
        // over: drop our pointer-events so both touches reach the RF pane.
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
        /* unsupported */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (multi || e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) < PAN_SLOP) return
      moved = true
      // RF's viewport translate is in screen px, same units as the pointer delta
      setViewport({ x: startVp.x + dx, y: startVp.y + dy, zoom: startVp.zoom })
    }

    const finish = (e: PointerEvent) => {
      down.delete(e.pointerId)
      if (down.size === 0) {
        multi = false
        el.style.pointerEvents = ''
      }
      if (e.pointerId !== pointerId) return
      pointerId = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      if (moved) return // a pan — no selection change
      // a tap — geometric hit-test, then select (or clear on empty canvas)
      const g = useGraphStore.getState()
      const id = nodeAt(e.clientX, e.clientY)
      if (id) {
        g.setSelection(id, null)
        g.onNodesChange(
          g.nodes.map((n) =>
            n.selected === (n.id === id) ? null : { id: n.id, type: 'select' as const, selected: n.id === id },
          ).filter(Boolean) as never,
        )
      } else {
        g.setSelection(null, null)
        g.onNodesChange(
          g.nodes.filter((n) => n.selected).map((n) => ({ id: n.id, type: 'select' as const, selected: false })) as never,
        )
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
      el.style.pointerEvents = ''
    }
  }, [active, setViewport, getViewport])

  return <div ref={ref} className={`pan-surface${active ? ' pan-surface--active' : ''}`} aria-hidden="true" />
}
