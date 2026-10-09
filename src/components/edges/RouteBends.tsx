import { useEffect, useMemo, useRef, useState } from 'react'
import { EdgeLabelRenderer, useReactFlow } from '@xyflow/react'
import { useT } from '../../i18n'
import { snapPoint, GRID } from '../../model/layout/grid'
import { useGraphStore, type GestureSnapshot } from '../../store/graphStore'
import { useRouteEditStore } from '../../store/routeEditStore'
import { beginLiveLayout, bendRejection, endLiveLayout } from '../../store/routeMap'
import { createKeyGesture, type GestureEndReason } from '../../ui/keyGestureLifetime'

// issue #344 step 3 (docs/diagram-layout.md §DL4, docs/edge-routing.md §ER16) —
// the bend points of the selected Manual orthogonal connection, as handles.
//
//   • DRAG     — a pointer drag moves one bend point, snapped to the 16 px grid
//                (Alt: free). One explicit history transaction: the snapshot at
//                pointer-down, silent writes while moving, ONE entry at the drop
//                when the point really moved.
//   • KEYS     — on a focused handle the arrow keys move it one grid step,
//                Shift four; a held key is one gesture and one entry (the shared
//                key-gesture lifetime). Delete / Backspace removes the point
//                (one entry); the last one removed makes the route automatic.
//   • ESCAPE   — cancels the drag or key gesture in progress: the point goes back.
//   • REFUSED  — a drop inside a node or on the connection's own port stub puts
//                the point back where it was; nothing is adjusted or recorded.
//
// Rendered only on a desktop canvas that is not locked (the caller decides);
// the store refuses every write under the lock anyway.

type Pt = { x: number; y: number }
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

type Gesture = { snapshot: GestureSnapshot; start: Pt[]; index: number; at: Pt; free: boolean }

export function RouteBends({ edgeId, waypoints }: { edgeId: string; waypoints: Pt[] }) {
  const t = useT()
  const { screenToFlowPosition } = useReactFlow()
  const focusedBend = useRouteEditStore((s) => (s.bend?.edgeId === edgeId ? s.bend.index : null))
  const selectBend = useRouteEditStore((s) => s.selectBend)
  const [invalidAt, setInvalidAt] = useState<number | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const store = () => useGraphStore.getState()
  const rejected = (p: Pt) => {
    const g = store()
    return bendRejection(g.nodes, g.edges, edgeId, p) !== null
  }
  const write = (wps: Pt[]) => store().setEdgeRoutingSilently(edgeId, { route: 'orthogonal', waypoints: wps })

  /** open a transaction on bend `index` */
  const open = (index: number): Gesture => {
    const g: Gesture = { snapshot: store().captureGestureSnapshot(), start: waypoints.map((p) => ({ ...p })), index, at: { ...waypoints[index] }, free: false }
    gestureRef.current = g
    beginLiveLayout()
    return g
  }
  /** close it: commit when the point moved to an allowed place, else put it back */
  const close = (commit: boolean) => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    setInvalidAt(null)
    const from = g.start[g.index]
    const moved = g.at.x !== from.x || g.at.y !== from.y
    if (commit && moved && !rejected(g.at)) store().pushGestureEntry(g.snapshot)
    else if (moved) write(g.start)
    endLiveLayout()
  }
  const moveTo = (g: Gesture, p: Pt) => {
    g.at = p
    const wps = g.start.map((q, i) => (i === g.index ? p : q))
    write(wps)
    setInvalidAt(rejected(p) ? g.index : null)
  }

  // the latest `close`, for the gesture lifetime and the unmount clean-up
  const closeRef = useRef(close)
  closeRef.current = close
  const keyGesture = useMemo(() => createKeyGesture((reason: GestureEndReason) => closeRef.current(reason !== 'cancel')), [])
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (ARROWS[e.key]) keyGesture.release(e.key)
    }
    const onBlur = () => keyGesture.end('blur')
    const onVisibility = () => keyGesture.end('visibility')
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      keyGesture.end('blur')
      closeRef.current(true)
    }
  }, [keyGesture])

  useEffect(() => {
    if (focusedBend != null) buttons.current[focusedBend]?.focus()
  }, [focusedBend])

  return (
    <EdgeLabelRenderer>
      {waypoints.map((p, i) => (
        <button
          key={i}
          ref={(el) => {
            buttons.current[i] = el
          }}
          type="button"
          className={`route-bend nodrag nopan${focusedBend === i ? ' is-focused' : ''}${invalidAt === i ? ' is-invalid' : ''}`}
          data-edge-id={edgeId}
          data-bend={i}
          aria-label={t('canvas.route.bend', { n: i + 1, total: waypoints.length })}
          style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
          onFocus={() => selectBend({ edgeId, index: i })}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.preventDefault()
            keyGesture.end('pointerdown')
            // the handle takes the keys, so Escape reaches it mid-drag
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            selectBend({ edgeId, index: i })
            const g = open(i)
            g.free = e.altKey
          }}
          onPointerMove={(e) => {
            const g = gestureRef.current
            if (!g || g.index !== i || keyGesture.active) return
            const f = screenToFlowPosition({ x: e.clientX, y: e.clientY })
            moveTo(g, e.altKey ? f : snapPoint(f))
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
            if (!keyGesture.active) close(true)
          }}
          onPointerCancel={() => {
            if (!keyGesture.active) close(false)
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const dir = ARROWS[e.key]
            if (dir) {
              e.preventDefault()
              e.stopPropagation()
              let g = gestureRef.current
              if (!g || !keyGesture.active || g.index !== i) {
                keyGesture.end('superseded')
                closeRef.current(true)
                g = open(i)
              }
              const step = e.shiftKey ? GRID * 4 : GRID
              keyGesture.press(e.key)
              moveTo(g, snapPoint({ x: g.at.x + dir[0] * step, y: g.at.y + dir[1] * step }))
              return
            }
            if (e.key === 'Escape') {
              if (gestureRef.current) {
                e.preventDefault()
                e.stopPropagation()
                if (keyGesture.active) keyGesture.end('cancel')
                else close(false)
              }
              return
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault()
              e.stopPropagation()
              if (gestureRef.current) return
              const rest = waypoints.filter((_, k) => k !== i)
              store().setEdgeRouting(edgeId, { route: 'orthogonal', waypoints: rest })
              selectBend(rest.length ? { edgeId, index: Math.max(0, i - 1) } : null)
            }
          }}
        />
      ))}
    </EdgeLabelRenderer>
  )
}
