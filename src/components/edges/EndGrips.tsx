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
//   • CLICK or TAP a grip (or press Enter / Space on it): the four sides of
//     that end's node are offered as buttons around the node, the current one
//     marked; choosing one moves the end to that side and closes them; Esc or a
//     press elsewhere closes them unchanged. Focus returns to the grip.
//
// A drag in progress is cancelled, applying nothing, if the grips go away
// under it (the connection is deselected or deleted, the edit lock is turned
// on). Shown only on a desktop canvas that is not locked (the caller decides).

import { useCallback, useEffect, useRef, useState } from 'react'
import { EdgeLabelRenderer, Position, useStoreApi, type Connection } from '@xyflow/react'
import { XYHandle, type FinalConnectionState } from '@xyflow/system'
import { useT, type MessageKey } from '../../i18n'
import { useEndGripNotice } from '../../store/endGripNotice'
import { endMoveVerdict, type EndMoveVerdict } from '../../model/endMove'
import { defaultFace, edgePortKind, faceOf, parseHandleId, PORT_FACES, type PortEnd } from '../../model/ports'
import type { PortFace } from '../../model/types'
import { useGraphStore } from '../../store/graphStore'
import { nameFootprintsOf, portPoint } from '../../store/routeMap'

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
  /** a refused drop's reason, said in the canvas live region */
  announce: (v: Extract<EndMoveVerdict, { ok: false }>, end: PortEnd) => void
}

const SIDE_KEY: Record<PortFace, MessageKey> = {
  top: 'inspector.ends.side.top',
  right: 'inspector.ends.side.right',
  bottom: 'inspector.ends.side.bottom',
  left: 'inspector.ends.side.left',
}
const POS: Record<PortFace, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
const OUT: Record<PortFace, { x: number; y: number }> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
/** how far outside its face a side button sits, flow px */
const PICK_OFFSET = 22
/** how far past the node's outside name a side button sits when the name is
 *  on that side, flow px (the button's centre) */
const PICK_CLEAR = 12

type Drag = { end: PortEnd; cancelled: boolean; touch: boolean; started: boolean }

export function EndGrips(p: Props) {
  const t = useT()
  const store = useStoreApi()
  const moveEdgeEnds = useGraphStore((s) => s.moveEdgeEnds)
  const drag = useRef<Drag | null>(null)
  // a click that follows a real drag (released on the grip itself) is not a pick
  const justDragged = useRef(false)
  const [picking, setPicking] = useState<PortEnd | null>(null)
  const grips = useRef<Record<PortEnd, HTMLButtonElement | null>>({ source: null, target: null })
  const pickerRef = useRef<HTMLDivElement | null>(null)

  // the end a handle under the pointer would make: its node and its face
  const endAt = useCallback((nodeId: string, handleId: string | null, end: PortEnd) => {
    const e = useGraphStore.getState().edges.find((x) => x.id === p.edgeId)
    const kind = e ? edgePortKind(e) : 'resource'
    return { node: nodeId, face: parseHandleId(handleId).face ?? defaultFace(kind, end) }
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
    drag.current = { end, cancelled: false, touch: 'touches' in event, started: false }
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
        if (drag.current) drag.current.started = true
        justDragged.current = true
      },
      onConnectEnd: () => {},
      onReconnectEnd: (_evt: MouseEvent | TouchEvent, state: FinalConnectionState) => {
        const d = drag.current
        drag.current = null
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

  // ── the side picker ──────────────────────────────────────────────────────
  const closePicker = useCallback((end: PortEnd) => {
    setPicking(null)
    grips.current[end]?.focus()
  }, [])

  useEffect(() => {
    if (!picking) return
    // the current side takes focus; Esc or a press elsewhere closes, unchanged
    const current = pickerRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      closePicker(picking)
    }
    const onDown = (ev: PointerEvent) => {
      if (pickerRef.current?.contains(ev.target as Node) || grips.current[picking]?.contains(ev.target as Node)) return
      setPicking(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [picking, closePicker])

  const picker = (end: PortEnd) => {
    const g = useGraphStore.getState()
    const e = g.edges.find((x) => x.id === p.edgeId)
    const n = g.nodes.find((x) => x.id === (end === 'source' ? p.source : p.target))
    if (!e || !n) return null
    const kind = edgePortKind(e)
    const port = kind === 'state' ? 'state' : end === 'source' ? 'out' : 'in'
    const now = faceOf(e, end)
    const name = nameFootprintsOf([n])[0]?.name ?? null
    return (
      <div ref={pickerRef} className="end-picker" role="group" aria-label={t('inspector.ends.side')} data-end={end}>
        {PORT_FACES.map((f) => {
          const at = portPoint(n, POS[f], port)
          let x = at.x + OUT[f].x * PICK_OFFSET
          let y = at.y + OUT[f].y * PICK_OFFSET
          // the node's outside name on this side is not covered: past it
          if (name && x >= name.x && x <= name.x + name.w && y >= name.y && y <= name.y + name.h) {
            if (f === 'bottom') y = name.y + name.h + PICK_CLEAR
            else if (f === 'top') y = name.y - PICK_CLEAR
            else if (f === 'right') x = name.x + name.w + PICK_CLEAR * 2
            else x = name.x - PICK_CLEAR * 2
          }
          return (
            <button
              key={f}
              type="button"
              className="end-picker__side nodrag nopan"
              data-face={f}
              aria-pressed={f === now}
              style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
              onClick={() => {
                if (f !== now) moveEdgeEnds(p.edgeId, { [end]: { node: n.id, face: f } })
                closePicker(end)
              }}
            >
              {t(SIDE_KEY[f])}
            </button>
          )
        })}
      </div>
    )
  }

  const grip = (end: PortEnd, x: number, y: number) => (
    <button
      key={end}
      ref={(el) => {
        grips.current[end] = el
      }}
      type="button"
      className="end-grip nodrag nopan"
      data-end={end}
      aria-label={t(end === 'source' ? 'canvas.endGrip.source' : 'canvas.endGrip.target')}
      aria-expanded={picking === end}
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
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

  return (
    <EdgeLabelRenderer>
      {grip('source', p.sourceX, p.sourceY)}
      {grip('target', p.targetX, p.targetY)}
      {picking ? picker(picking) : null}
    </EdgeLabelRenderer>
  )
}
