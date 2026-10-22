// docs/edge-routing.md §ER18 — the canvas end grips of the ONE selected
// connection. Two ways to move an end, both through the SAME check and change
// as the Inspector's Ends group (`endMoveVerdict`, `moveEdgeEnds`):
//
//   • DRAG a grip onto a face of a node. The drag is React Flow's own
//     connection engine (`XYHandle`, the one its edge reconnection uses),
//     started from a mouse press OR a touch start, so a pen and a touch screen
//     take the same path as a mouse (React Flow's own anchors listen to the
//     mouse only). A drop on an allowed face moves the end (one undo step); on
//     a refused face nothing changes and the reason is said; elsewhere, or
//     after Esc, nothing changes and nothing is recorded.
//   • CLICK or TAP a grip (or press Enter / Space on it): a small popover names
//     the end (From / To) and its node and offers the node's four sides, the
//     current one marked; choosing one moves the end to that side and closes
//     it; Esc or a press elsewhere closes it unchanged. Focus returns to the
//     grip. The popover stays inside the canvas.
//
// WHERE A GRIP SITS. On the connection's own line, near its end: the nearest
// of a few spots along the line (from just past the port, a short way in) whose
// whole pointer target meets nothing else a press could mean — another
// connection's line, a port, a node, the other grip — and covers no text (a
// connection label, this one's included, or a node's outside name). Tested with the
// browser's own hit testing (`elementsFromPoint`), so it is what a press would
// actually reach. When no spot near the end is free, that end gets NO grip (a
// large transparent target would take presses meant for the lines around it);
// a small mark shows the end, and the Ends group says to move it from there.
//
// A drag in progress is cancelled, applying nothing, if the grips go away
// under it (the connection is deselected or deleted, the edit lock is turned
// on). Shown only on a desktop canvas that is not locked (the caller decides).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EdgeLabelRenderer, useStore, useStoreApi, type Connection } from '@xyflow/react'
import { XYHandle, type FinalConnectionState } from '@xyflow/system'
import { useT, type MessageKey } from '../../i18n'
import { useEndGripNotice } from '../../store/endGripNotice'
import { endMoveVerdict, type EndMoveVerdict } from '../../model/endMove'
import { edgePortKind, faceOf, faceOfHandle, type PortEnd } from '../../model/ports'
import type { PortFace } from '../../model/types'
import { useGraphStore } from '../../store/graphStore'
import { useCoarsePointer } from '../../ui/media'
import { holdConnectTouch, releaseConnectTouch } from './connectTouchHold'

type Props = {
  edgeId: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** the path the connection is drawn with (flow px): a grip sits on it */
  path: string
  /** a refused drop's reason, said in the canvas live region */
  announce: (v: Extract<EndMoveVerdict, { ok: false }>, end: PortEnd) => void
}

const SIDE_KEY: Record<PortFace, MessageKey> = {
  top: 'inspector.ends.side.top',
  right: 'inspector.ends.side.right',
  bottom: 'inspector.ends.side.bottom',
  left: 'inspector.ends.side.left',
}
/** the screen gap between a port and the nearest grip spot's target, px */
const GRIP_GAP = 2
/** the spots tried along the line, SCREEN px past the nearest one (half the
 *  target plus `GRIP_GAP` off the port), near the end first. At most
 *  `NEAR_MAX` further in — one mouse target's width: past that the dot no
 *  longer reads as this end's (its centre is then at most 38 px from the port
 *  with a mouse, 48 px with touch) — and never past the middle of the line,
 *  where the other end's grip belongs. No free spot within that: no grip, and
 *  the Ends group moves that end. */
const SPOTS = [0, 8, 16, 24] as const
const NEAR_MAX = 24
/** the hit-test grid's spacing over a candidate target, screen px: under a
 *  port's own hit area (the handle plus 5 px each way, rotated with a state
 *  port), so no port a press could reach slips between two samples (measured
 *  2026-10-19: a 5 × 5 grid over a 24 px grip missed the state port that
 *  shares a symbol's face anchor with the end) */
const GRID_STEP = 3

type Pt = { x: number; y: number }
type Drag = { end: PortEnd; cancelled: boolean; touch: boolean }

let sampler: SVGPathElement | null = null

/** whether anything other than this connection, its grips and the canvas
 *  background is reached at the screen point */
function busyAt(x: number, y: number, edgeId: string): boolean {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('.end-grip, .end-picker')) continue
    const edge = el.closest('.react-flow__edge') as HTMLElement | null
    if (edge) {
      if (edge.dataset.id !== edgeId) return true
      continue
    }
    if (el.closest('.edge-label, .react-flow__handle, .react-flow__node')) return true
  }
  return false
}

export function EndGrips(p: Props) {
  const t = useT()
  const store = useStoreApi()
  const moveEdgeEnds = useGraphStore((s) => s.moveEdgeEnds)
  const drag = useRef<Drag | null>(null)
  // a click that follows a real drag (released on the grip itself) is not a pick
  const justDragged = useRef(false)
  const [picking, setPickingOnly] = useState<PortEnd | null>(null)
  // where the side popover sits; measured once it is open, forgotten as it closes
  const [popAt, setPopAt] = useState<(Pt & { maxH: number; maxW: number }) | null>(null)
  const setPicking = (v: PortEnd | null | ((cur: PortEnd | null) => PortEnd | null)) => {
    setPickingOnly(v)
    setPopAt(null)
  }
  const grips = useRef<Record<PortEnd, HTMLButtonElement | null>>({ source: null, target: null })
  const popRef = useRef<HTMLDivElement | null>(null)
  const ids = useId()
  // the grips keep their SCREEN size at every zoom (a pointer target of 24 px,
  // 44 px for touch, in CSS): they live in the zoomed flow layer, so each is
  // scaled back by the zoom
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const coarse = useCoarsePointer()
  const size = coarse ? 44 : 24
  const unzoom = (x: number, y: number) => `translate(${x}px, ${y}px) scale(${1 / zoom}) translate(-50%, -50%)`

  // ── where each grip sits: the nearest free spot along the line ────────────
  // undefined until measured; null for an end with no free spot
  const [spots, setSpots] = useState<{ source: Pt | null; target: Pt | null } | undefined>(undefined)
  useLayoutEffect(() => {
    const dom = store.getState().domNode
    if (typeof document === 'undefined' || !dom || !p.path) return
    sampler ??= document.createElementNS('http://www.w3.org/2000/svg', 'path')
    sampler.setAttribute('d', p.path)
    let len = 0
    try {
      len = sampler.getTotalLength()
    } catch {
      return
    }
    const r = dom.getBoundingClientRect()
    const toScreen = (q: Pt) => ({ x: r.left + tx + q.x * zoom, y: r.top + ty + q.y * zoom })
    const taken: { x: number; y: number }[] = []
    // text a grip must not cover even where a press passes through it: every
    // connection label (this one's too), every node's outside name and the
    // line beside a symbol (a capacity, a unit, a value written in full)
    const texts = [...document.querySelectorAll('.edge-label, .nodef__name, .nodef__aux')].map((el) => el.getBoundingClientRect())
    const coversText = (c: Pt) => texts.some((b) => c.x - size / 2 < b.right && b.left < c.x + size / 2 && c.y - size / 2 < b.bottom && b.top < c.y + size / 2)
    const pick = (end: PortEnd): Pt | null => {
      for (const extra of SPOTS) {
        const along = (size / 2 + GRIP_GAP + extra) / zoom
        if (extra > NEAR_MAX || along > len / 2) break
        const q = sampler!.getPointAtLength(end === 'source' ? along : len - along)
        const c = toScreen({ x: q.x, y: q.y })
        // the other grip's target is not shared
        if (taken.some((o) => Math.abs(o.x - c.x) < size && Math.abs(o.y - c.y) < size)) continue
        if (coversText(c)) continue
        // the samples run from rim to rim (0.5 px inside), so a port reaching
        // only the target's edge is still found
        let busy = false
        const n = Math.ceil(size / GRID_STEP) + 1
        const at = (k: number) => 0.5 + (k * (size - 1)) / (n - 1) - size / 2
        for (let i = 0; i < n && !busy; i++) {
          for (let j = 0; j < n && !busy; j++) {
            busy = busyAt(c.x + at(i), c.y + at(j), p.edgeId)
          }
        }
        if (!busy) {
          taken.push(c)
          return { x: q.x, y: q.y }
        }
      }
      return null
    }
    const next = { source: pick('source'), target: pick('target') }
    // a measurement of the drawn page (what a press would reach) can only be
    // taken after it is drawn, so it is stored here; unchanged spots keep the
    // same object and render nothing again
    setSpots((cur) => {
      const same = (a: Pt | null | undefined, b: Pt | null) => (a == null || b == null ? a === b : Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01)
      return cur && same(cur.source, next.source) && same(cur.target, next.target) ? cur : next
    })
  }, [p.path, p.edgeId, tx, ty, zoom, size, store])

  // the Ends group says which end has no grip here
  useEffect(() => {
    if (!spots) return
    const ends = (['source', 'target'] as const).filter((e) => spots[e] == null)
    useEndGripNotice.getState().setNoSpot(ends.length ? { edgeId: p.edgeId, ends } : null)
  }, [spots, p.edgeId])
  useEffect(() => () => useEndGripNotice.getState().setNoSpot(null), [])

  // the end a handle under the pointer would make: its node and the face the
  // HANDLE is on — a plain id is its own port's default face (a state port
  // drawn at a face this connection's kind would not default to is still on
  // that face)
  const endAt = useCallback((nodeId: string, handleId: string | null, end: PortEnd) => {
    const e = useGraphStore.getState().edges.find((x) => x.id === p.edgeId)
    return { node: nodeId, face: faceOfHandle(handleId, end, e ? edgePortKind(e) : 'resource') }
  }, [p.edgeId])

  const verdictFor = useCallback((conn: Connection, end: PortEnd) => {
    const g = useGraphStore.getState()
    const to = end === 'source' ? endAt(conn.source, conn.sourceHandle, 'source') : endAt(conn.target, conn.targetHandle, 'target')
    return endMoveVerdict(g.nodes, g.edges, p.edgeId, { [end]: to })
  }, [endAt, p.edgeId])

  // end a drag in progress, applying nothing: the engine listens until the
  // button or finger is released, so its own release is sent to it
  const cancelDrag = useCallback(() => {
    const d = drag.current
    if (!d) return
    d.cancelled = true
    drag.current = null
    if (d.touch) releaseConnectTouch()
    document.dispatchEvent(d.touch ? new TouchEvent('touchend', { touches: [] }) : new MouseEvent('mouseup'))
    store.getState().cancelConnection()
  }, [store])

  // Esc during a drag cancels it; the grips going away (deselected, deleted,
  // locked) cancel it too
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !drag.current) return
      ev.stopPropagation()
      cancelDrag()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      cancelDrag()
    }
  }, [cancelDrag])

  const start = (event: React.MouseEvent | React.TouchEvent, end: PortEnd) => {
    if ('button' in event && event.button !== 0) return
    event.stopPropagation()
    setPicking(null)
    const s = store.getState()
    // the FIXED end is where the drag is anchored, as in React Flow's reconnection
    const fixed: PortEnd = end === 'source' ? 'target' : 'source'
    const fixedNode = fixed === 'source' ? p.source : p.target
    const fixedHandle = fixed === 'source' ? p.sourceHandle : p.targetHandle
    drag.current = { end, cancelled: false, touch: 'touches' in event }
    // a touch drag holds that touch's moves until it ends, so the next tap is
    // still a click (connectTouchHold.ts; measured on these grips 2026-10-22)
    if ('touches' in event) holdConnectTouch(event.nativeEvent)
    justDragged.current = false
    useEndGripNotice.getState().set(null, null)
    XYHandle.onPointerDown(event.nativeEvent, {
      autoPanOnConnect: s.autoPanOnConnect,
      connectionMode: s.connectionMode,
      connectionRadius: s.connectionRadius,
      domNode: s.domNode,
      handleId: fixedHandle,
      nodeId: fixedNode,
      nodeLookup: s.nodeLookup,
      isTarget: fixed === 'target',
      edgeUpdaterType: fixed,
      lib: s.lib,
      flowId: s.rfId,
      cancelConnection: s.cancelConnection,
      panBy: s.panBy,
      isValidConnection: (conn) => verdictFor(conn as Connection, end).ok,
      onConnect: (conn) => {
        const d = drag.current
        if (!d || d.cancelled) return
        const v = verdictFor(conn, end)
        if (v.ok) moveEdgeEnds(p.edgeId, { [end]: end === 'source' ? endAt(conn.source, conn.sourceHandle, 'source') : endAt(conn.target, conn.targetHandle, 'target') })
      },
      onConnectStart: () => {
        justDragged.current = true
      },
      onConnectEnd: () => {},
      onReconnectEnd: (_evt: MouseEvent | TouchEvent, state: FinalConnectionState) => {
        const d = drag.current
        drag.current = null
        if (d?.touch) releaseConnectTouch()
        // a click the browser sends right after this release (on the grip) is
        // the drag's own; any later click is a pick again
        setTimeout(() => {
          justDragged.current = false
        }, 0)
        if (!d || d.cancelled) return
        // a drop on a face the check refuses: say why (nothing was changed)
        const to = (state as { toHandle?: { nodeId: string; id?: string | null } | null }).toHandle
        if (!state.isValid && to) {
          const g = useGraphStore.getState()
          const v = endMoveVerdict(g.nodes, g.edges, p.edgeId, { [end]: endAt(to.nodeId, to.id ?? null, end) })
          if (!v.ok) {
            useEndGripNotice.getState().set(p.edgeId, v)
            p.announce(v, end)
          }
        }
      },
      updateConnection: s.updateConnection,
      getTransform: () => store.getState().transform,
      getFromHandle: () => store.getState().connection.fromHandle,
      dragThreshold: s.connectionDragThreshold,
      handleDomNode: event.currentTarget as Element,
    })
  }

  // ── the side popover ─────────────────────────────────────────────────────
  const closePicker = useCallback((end: PortEnd) => {
    setPicking(null)
    grips.current[end]?.focus()
  }, [])

  // placed beside the grip, inside the canvas

  const popReady = popAt != null
  useLayoutEffect(() => {
    if (!picking) return
    const dom = store.getState().domNode
    const g = grips.current[picking]
    const pop = popRef.current
    if (!dom || !g || !pop) return
    const r = dom.getBoundingClientRect()
    const gb = g.getBoundingClientRect()
    const M = 8
    const w = Math.min(pop.offsetWidth, r.width - 2 * M)
    // never cut: no taller than the canvas allows; past that it scrolls inside
    const maxH = r.height - 2 * M
    const h = Math.min(pop.scrollHeight, maxH)
    // AWAY from the end's node, so the popover does not cover the node it
    // edits: on the grip's far side from the node's centre, along the axis
    // the grip sits off it; then kept inside the canvas
    const nodeEl = dom.querySelector(`.react-flow__node[data-id="${CSS.escape(picking === 'source' ? p.source : p.target)}"]`)
    const nb = nodeEl?.getBoundingClientRect()
    const gx = (gb.left + gb.right) / 2
    const gy = (gb.top + gb.bottom) / 2
    const dx = nb ? gx - (nb.left + nb.right) / 2 : 1
    const dy = nb ? gy - (nb.top + nb.bottom) / 2 : 0
    let x: number
    let y: number
    if (Math.abs(dx) * (nb ? nb.height : 1) >= Math.abs(dy) * (nb ? nb.width : 1)) {
      // the grip is off a left or right side: beside it, further out
      x = dx >= 0 ? gb.right + 6 : gb.left - 6 - w
      y = gy - h / 2
    } else {
      // off the top or bottom: above or below it
      x = gx - w / 2
      y = dy >= 0 ? gb.bottom + 6 : gb.top - 6 - h
    }
    x = Math.max(M, Math.min(x - r.left, r.width - M - w))
    y = Math.max(M, Math.min(y - r.top, r.height - M - h))
    setPopAt({ x, y, maxH, maxW: r.width - 2 * M })
  }, [picking, tx, ty, zoom, store, p.source, p.target])

  useEffect(() => {
    if (!picking || !popReady) return
    // the current side takes focus; Esc or a press elsewhere closes, unchanged
    popRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      closePicker(picking)
    }
    const onDown = (ev: PointerEvent) => {
      if (popRef.current?.contains(ev.target as Node) || grips.current[picking]?.contains(ev.target as Node)) return
      setPicking(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
    // its own position (a pan or zoom) does not re-run this, nor move focus
  }, [picking, popReady, closePicker])

  const popover = (end: PortEnd) => {
    const dom = store.getState().domNode
    const g = useGraphStore.getState()
    const e = g.edges.find((x) => x.id === p.edgeId)
    const n = g.nodes.find((x) => x.id === (end === 'source' ? p.source : p.target))
    if (!dom || !e || !n) return null
    const now = faceOf(e, end)
    const name = (n.data as { label?: string } | undefined)?.label || n.id
    const titleId = `${ids}-pop-${end}`
    const side = (f: PortFace) => (
      <button
        key={f}
        type="button"
        className={`end-popover__side end-popover__side--${f}`}
        data-face={f}
        data-coarse={coarse ? '' : undefined}
        aria-pressed={f === now}
        onClick={() => {
          if (f !== now) moveEdgeEnds(p.edgeId, { [end]: { node: n.id, face: f } })
          closePicker(end)
        }}
      >
        {t(SIDE_KEY[f])}
      </button>
    )
    return createPortal(
      <div
        ref={popRef}
        className="end-popover end-picker nodrag nopan"
        role="group"
        aria-labelledby={titleId}
        data-end={end}
        style={popAt ? { left: popAt.x, top: popAt.y, maxHeight: popAt.maxH, maxWidth: popAt.maxW, overflowY: 'auto' } : { left: 0, top: 0, visibility: 'hidden' }}
      >
        <p className="end-popover__title" id={titleId}>
          <span className="end-popover__end">{t(end === 'source' ? 'inspector.ends.from' : 'inspector.ends.to')}</span>
          {/* §L9.3 — the user's own text, in its own direction */}
          <bdi className="end-popover__node">{name}</bdi>
        </p>
        <div className="end-popover__sides" role="presentation">
          {side('top')}
          {side('left')}
          {side('right')}
          {side('bottom')}
        </div>
      </div>,
      dom,
    )
  }

  const grip = (end: PortEnd, at: Pt) => (
    <button
      key={end}
      ref={(el) => {
        grips.current[end] = el
      }}
      type="button"
      className="end-grip nodrag nopan"
      data-end={end}
      data-coarse={coarse ? '' : undefined}
      aria-label={t(end === 'source' ? 'canvas.endGrip.source' : 'canvas.endGrip.target')}
      aria-expanded={picking === end}
      style={{ transform: unzoom(at.x, at.y) }}
      onMouseDown={(e) => start(e, end)}
      onTouchStart={(e) => start(e, end)}
      onClick={() => {
        if (justDragged.current) {
          justDragged.current = false
          return
        }
        setPicking((cur) => (cur === end ? null : end))
      }}
    >
      <span className="end-grip__dot" />
    </button>
  )
  // an end with no free spot: a mark that it is this connection's end, not a target
  const none = (end: PortEnd, x: number, y: number) => (
    <span key={`${end}-none`} className="end-grip-none" data-end={end} aria-hidden="true" style={{ transform: unzoom(x, y) }} />
  )

  return (
    <>
      <EdgeLabelRenderer>
        {spots == null ? null : spots.source ? grip('source', spots.source) : none('source', p.sourceX, p.sourceY)}
        {spots == null ? null : spots.target ? grip('target', spots.target) : none('target', p.targetX, p.targetY)}
      </EdgeLabelRenderer>
      {picking && spots?.[picking] ? popover(picking) : null}
    </>
  )
}
