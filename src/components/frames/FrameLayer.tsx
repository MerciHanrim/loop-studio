import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import {
  useFrameStore,
  FRAME_COLORS,
  type FrameRect,
  type FrameColor,
} from '../../store/frameStore'
import { useAutoFrameStore } from '../../store/autoFrameStore'
import { useGraphStore, type GestureSnapshot } from '../../store/graphStore'
import { useUiStore } from '../../store/uiStore'
import { useT, type MessageKey } from '../../i18n'
import { useIsMobile } from '../../ui/media'
import { FRAME_MIN_SCREEN_PX, frameIsCreatable, normaliseRect } from './frameGeom'
import { applyMoveDelta, captureMoveOrigin, moveTargets, type MoveOrigin, type Pt } from './frameMoveGesture'

// docs/large-graph-readability.md §LGR6 (transient) + …-auto-frames.md §AF (auto).
// One render layer for BOTH frame kinds:
//
//   • BEHIND layer  — a full-pane <svg> at z-index 0 (below the RF pane), so
//     frames always paint behind every node and edge. `pointer-events: none`:
//     a click on a frame's interior falls straight through. AUTO frames paint
//     first, MANUAL over them (§AF5 R2 — the user's own rectangle wins the tie).
//   • CHROME layer  — a <ViewportPortal> (on top), interactive parts only: four
//     thin edge hit-strips (select / move), the label chip (inline rename), and
//     — when selected — a resize corner and a ✕ (delete for manual, DISMISS for
//     auto). Same order: auto chrome first, manual over it.
//   • DRAW           — the 4a Frame tool, unchanged.
//   • PROMOTE        — committing a rename OR a move / resize of an AUTO frame
//     converts it to a manual frame (§AF5 R5); a cancelled edit leaves it auto
//     (§AF5 R6).
//   • MOVE / RESIZE  — §LGR6.5 / LGR-D9 (2026-09-20): an edge drag CARRIES the
//     frame's contents (derived at pointer-down — `frameMoveGesture.ts`), and
//     both gestures run as ONE explicit history transaction:
//       pointer-down  captures the origin + `captureGestureSnapshot()`
//       every move    origin + absolute Δ, applied at most once per animation
//                     frame through SILENT store writes
//       pointer-up    the exact final Δ, then `pushGestureEntry()` ONCE — only
//                     if the final rect differs from the origin (an out-and-
//                     back gesture is a no-op; an auto frame promotes inside
//                     the same entry)
//       Esc / pointercancel  the origin is written back, nothing is pushed.
//     Alt held at pointer-down (frozen for the gesture) moves the frame alone.
//   • EDIT-LOCK / MOBILE — every action that changes SAVED state (the tool,
//     move, resize, rename, colour, delete, promote) is off; a frame can still
//     be selected and looked at (D6).
//   • KEYBOARD — §LGR6.6 (2026-09-20). The CONTAINER is the focus unit:
//     `role="group"`, a localized `aria-roledescription`, the name
//     "<label>, N nodes", ONE tab stop per frame. The label / ✕ / swatches /
//     resize handle are POST-SELECTION tab stops (so the rename path survives:
//     select, Tab to the label, Enter); the four edge strips stay unfocusable
//     and `aria-hidden`. Enter / Space select, Escape deselects when no gesture
//     is running. Arrow = 5 px, Shift+Arrow = 20 px — a move carries exactly
//     what a pointer drag carries, and the resize handle's arrows change width
//     / height by the same steps. Both run through the SAME gesture
//     transaction as the pointer: captured on the first keydown, silent origin
//     + accumulated absolute Δ while keys repeat, ONE entry when the last
//     arrow comes up and the rect really changed, nothing for an out-and-back,
//     nothing for Escape (the origin is written back), and a focus loss /
//     visibility change commits so a lost keyup can never leave one open.
//
// Nothing here touches the engine, the digest of what a run computes, or
// `simulationRev` — a carried node moves exactly like a hand-dragged one.

const rectEq = (a: FrameRect, b: FrameRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

// §LGR6.6 — the same steps React Flow gives a node's arrow keys, so one canvas
// never teaches two rules.
const KEY_STEP = 5
const KEY_STEP_FAST = 20
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}
/** how long after the last key the settled position / size is announced */
const ANNOUNCE_MS = 300

// three SHARED descriptions (one per state) rather than one per frame — the
// text is identical for every frame in that state, so `aria-describedby` just
// points at the right one.
const DESC_ID = 'lgr-frame-desc'
const DESC_SELECTED_ID = 'lgr-frame-desc-selected'
const DESC_READONLY_ID = 'lgr-frame-desc-readonly'

/** a keyboard move / resize in flight — the transaction the pointer path uses,
 *  driven by keydown / keyup instead of pointerdown / pointerup. */
type KeyGesture = {
  kind: 'move' | 'resize'
  id: string
  isAuto: boolean
  /** the RAW label — what a promotion stores (empty ⇒ the locale default) */
  label: string
  /** the DISPLAY name — what an announcement reads out */
  name: string
  snapshot: GestureSnapshot
  /** the arrow keys currently held; the gesture ends when it empties */
  keys: Set<string>
  dx: number
  dy: number
  /** move only — the pre-gesture geometry of everything the gesture carries */
  origin: MoveOrigin | null
  /** the dragged frame's own pre-gesture rect */
  orig: FrameRect
  current: FrameRect
}

// §FC4 — accessible names for the swatch buttons (colour is never the sole tell)
const COLOR_KEY: Record<'neutral' | FrameColor, MessageKey> = {
  neutral: 'canvas.frame.color.neutral',
  slate: 'canvas.frame.color.slate',
  sage: 'canvas.frame.color.sage',
  gold: 'canvas.frame.color.gold',
  violet: 'canvas.frame.color.violet',
  rose: 'canvas.frame.color.rose',
}

type Drag =
  | { kind: 'draw'; start: Pt }
  | {
      kind: 'move'
      id: string
      isAuto: boolean
      label: string
      origin: MoveOrigin
      snapshot: GestureSnapshot
      last: Pt | null
      raf: number | null
      /** the dragged frame's rect at the last applied Δ (an auto frame's draft / the promote rect) */
      current: FrameRect
    }
  | {
      kind: 'resize'
      id: string
      isAuto: boolean
      label: string
      anchor: Pt
      orig: FrameRect
      snapshot: GestureSnapshot
      last: Pt | null
      raf: number | null
      current: FrameRect
    }

export function FrameLayer() {
  const frames = useFrameStore((s) => s.frames)
  const selectedId = useFrameStore((s) => s.selectedId)
  const toolArmed = useFrameStore((s) => s.toolArmed)
  const addFrame = useFrameStore((s) => s.addFrame)
  const adoptFrame = useFrameStore((s) => s.adoptFrame)
  const adoptFrameSilently = useFrameStore((s) => s.adoptFrameSilently)
  const disarmTool = useFrameStore((s) => s.disarmTool)
  const selectFrame = useFrameStore((s) => s.selectFrame)
  const renameFrame = useFrameStore((s) => s.renameFrame)
  const setRectsSilently = useFrameStore((s) => s.setRectsSilently)
  const setFrameColor = useFrameStore((s) => s.setFrameColor)
  const removeFrame = useFrameStore((s) => s.removeFrame)

  const autoFrames = useAutoFrameStore((s) => s.autoFrames)
  const dismissAuto = useAutoFrameStore((s) => s.dismissAuto)
  const removeAuto = useAutoFrameStore((s) => s.removeAuto)
  const t = useT()
  // §AF-INV-7 — on mobile a suggested (auto) frame is DISPLAY-ONLY: no select,
  // no rename, no resize (promote / dismiss are desktop-only, like 4a frame
  // drawing); the session-only "Clear suggested" stays in the More sheet.
  const isMobile = useIsMobile()
  // D6 (2026-09-20) — on mobile, or while the desktop Canvas is edit-locked,
  // nothing that changes SAVED frame state is offered: no move / resize /
  // rename / colour / delete / promote. Select + view only.
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  const editable = !isMobile && !canvasLocked

  const [tx, ty, zoom] = useStore((s) => s.transform)
  const { screenToFlowPosition } = useReactFlow()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)

  // ── draw / drag / resize interaction ────────────────────────────────────
  const [draft, setDraft] = useState<FrameRect | null>(null)
  // an AUTO frame being moved / resized shows its provisional rect here until
  // the drag commits (→ promote) or is cancelled (→ stays auto).
  const [autoDraft, setAutoDraft] = useState<{ id: string; rect: FrameRect } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // §LGR6.6 — the keyboard transaction + its polite announcement
  const keyRef = useRef<KeyGesture | null>(null)
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const flowPt = useCallback(
    (e: PointerEvent | React.PointerEvent): Pt => screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    [screenToFlowPosition],
  )

  /** apply a move / resize gesture at pointer position `p`: origin + absolute Δ */
  const applyGesture = useCallback(
    (d: Extract<Drag, { kind: 'move' | 'resize' }>, p: Pt) => {
      const G = useGraphStore.getState()
      if (d.kind === 'move') {
        const dx = p.x - d.origin.anchor.x
        const dy = p.y - d.origin.anchor.y
        const r = applyMoveDelta(d.origin, dx, dy)
        d.current = r.rect
        setRectsSilently(r.frameRects)
        G.applyGesturePositions(r.nodePositions, r.edgeWaypoints)
        if (d.isAuto) setAutoDraft({ id: d.id, rect: r.rect })
      } else {
        const next: FrameRect = {
          x: d.orig.x,
          y: d.orig.y,
          w: Math.max(1, d.orig.w + (p.x - d.anchor.x)),
          h: Math.max(1, d.orig.h + (p.y - d.anchor.y)),
        }
        d.current = next
        if (d.isAuto) setAutoDraft({ id: d.id, rect: next })
        else setRectsSilently({ [d.id]: next })
      }
    },
    [setRectsSilently],
  )

  /** write the origin back (a cancelled gesture) — nothing is pushed */
  const restoreGesture = useCallback(
    (d: Extract<Drag, { kind: 'move' | 'resize' }>) => {
      const G = useGraphStore.getState()
      if (d.kind === 'move') {
        setRectsSilently(d.origin.frameRects)
        G.applyGesturePositions(d.origin.nodePositions, d.origin.edgeWaypoints)
      } else if (!d.isAuto) {
        setRectsSilently({ [d.id]: d.orig })
      }
      if (d.isAuto) setAutoDraft(null)
    },
    [setRectsSilently],
  )

  /** the settled position / size, announced once the burst stops (D11) */
  const announceLater = useCallback(
    (key: 'canvas.frame.a11y.moved' | 'canvas.frame.a11y.resized', params: Record<string, string | number>) => {
      if (announceTimer.current) clearTimeout(announceTimer.current)
      announceTimer.current = setTimeout(() => {
        announceTimer.current = null
        setAnnouncement(t(key, params))
      }, ANNOUNCE_MS)
    },
    [t],
  )

  /** open the transaction: the pre-gesture snapshot + the pre-gesture geometry */
  const beginKeyGesture = useCallback(
    (kind: 'move' | 'resize', id: string, rect: FrameRect, isAuto: boolean, label: string, name: string) => {
      const G = useGraphStore.getState()
      const snapshot = G.captureGestureSnapshot()
      const origin =
        kind === 'move'
          ? captureMoveOrigin({
              frameId: id,
              rect,
              isAuto,
              frameOnly: false, // §LGR6.6 — no keyboard frame-only escape hatch; Alt stays a pointer contract
              anchor: { x: 0, y: 0 }, // unused: the keyboard supplies an absolute Δ directly
              frames: useFrameStore.getState().frames,
              nodes: G.nodes,
              edges: G.edges,
            })
          : null
      keyRef.current = { kind, id, isAuto, label, name, snapshot, keys: new Set(), dx: 0, dy: 0, origin, orig: { ...rect }, current: { ...rect } }
      if (isAuto) setAutoDraft({ id, rect: { ...rect } })
    },
    [],
  )

  /** origin + the accumulated absolute Δ, through the same silent writes */
  const applyKeyGesture = useCallback(
    (g: KeyGesture) => {
      if (g.kind === 'move' && g.origin) {
        const r = applyMoveDelta(g.origin, g.dx, g.dy)
        g.current = r.rect
        setRectsSilently(r.frameRects)
        useGraphStore.getState().applyGesturePositions(r.nodePositions, r.edgeWaypoints)
        if (g.isAuto) setAutoDraft({ id: g.id, rect: r.rect })
        announceLater('canvas.frame.a11y.moved', { label: g.name, x: Math.round(r.rect.x), y: Math.round(r.rect.y) })
      } else {
        // the pointer contract exactly: the top-left is the anchor, w / h grow,
        // and a resize never moves the contents
        const next: FrameRect = {
          x: g.orig.x,
          y: g.orig.y,
          w: Math.max(1, g.orig.w + g.dx),
          h: Math.max(1, g.orig.h + g.dy),
        }
        g.current = next
        if (g.isAuto) setAutoDraft({ id: g.id, rect: next })
        else setRectsSilently({ [g.id]: next })
        announceLater('canvas.frame.a11y.resized', { label: g.name, w: Math.round(next.w), h: Math.round(next.h) })
      }
    },
    [setRectsSilently, announceLater],
  )

  /** close the transaction. `commit: false` (Escape) always restores the origin;
   *  a committed gesture that ended where it started restores too and pushes
   *  nothing — an out-and-back is a no-op and never promotes (D6 / D7). */
  const endKeyGesture = useCallback(
    (commit: boolean) => {
      const g = keyRef.current
      if (!g) return
      keyRef.current = null
      if (announceTimer.current) {
        clearTimeout(announceTimer.current)
        announceTimer.current = null
      }
      const changed = !rectEq(g.current, g.orig)
      if (!commit || !changed) {
        if (g.kind === 'move' && g.origin) {
          setRectsSilently(g.origin.frameRects)
          useGraphStore.getState().applyGesturePositions(g.origin.nodePositions, g.origin.edgeWaypoints)
        } else if (g.kind === 'resize' && !g.isAuto) {
          setRectsSilently({ [g.id]: g.orig })
        }
        if (g.isAuto) setAutoDraft(null)
        return
      }
      useGraphStore.getState().pushGestureEntry(g.snapshot)
      if (g.isAuto) {
        // §AF5 R5 — a real final change promotes, inside this one entry
        adoptFrameSilently(g.current, g.label)
        removeAuto(g.id)
        setAutoDraft(null)
      }
      setAnnouncement(
        g.kind === 'move'
          ? t('canvas.frame.a11y.moved', { label: g.name, x: Math.round(g.current.x), y: Math.round(g.current.y) })
          : t('canvas.frame.a11y.resized', { label: g.name, w: Math.round(g.current.w), h: Math.round(g.current.h) }),
      )
    },
    [setRectsSilently, adoptFrameSilently, removeAuto, t],
  )

  /** one arrow press (or repeat) on a frame or on its resize handle */
  const pressArrow = useCallback(
    (kind: 'move' | 'resize', rf: { id: string; rect: FrameRect; auto: boolean; label: string }, name: string, e: React.KeyboardEvent) => {
      const dir = ARROWS[e.key]
      if (!dir) return false
      e.preventDefault()
      e.stopPropagation()
      let g = keyRef.current
      if (!g || g.id !== rf.id || g.kind !== kind) {
        endKeyGesture(true) // a different target / mode closes the previous one cleanly
        beginKeyGesture(kind, rf.id, rf.rect, rf.auto, rf.label, name)
        g = keyRef.current!
      }
      const step = e.shiftKey ? KEY_STEP_FAST : KEY_STEP
      g.keys.add(e.key)
      g.dx += dir[0] * step
      g.dy += dir[1] * step
      applyKeyGesture(g)
      return true
    },
    [beginKeyGesture, applyKeyGesture, endKeyGesture],
  )

  // the gesture ends when the last arrow comes up — and defensively when focus
  // or the page goes away, so a lost keyup can never leave a transaction open.
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      const g = keyRef.current
      if (!g || !ARROWS[e.key]) return
      g.keys.delete(e.key)
      if (g.keys.size === 0) endKeyGesture(true)
    }
    const settle = () => {
      if (keyRef.current) endKeyGesture(true)
    }
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', settle)
    document.addEventListener('visibilitychange', settle)
    return () => {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', settle)
      document.removeEventListener('visibilitychange', settle)
      if (announceTimer.current) clearTimeout(announceTimer.current)
    }
  }, [endKeyGesture])

  useEffect(() => {
    const cancelRaf = (d: Extract<Drag, { kind: 'move' | 'resize' }>) => {
      if (d.raf !== null) cancelAnimationFrame(d.raf)
      d.raf = null
    }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const p = flowPt(e)
      if (d.kind === 'draw') {
        setDraft(normaliseRect(d.start, p))
        return
      }
      // at most one store write per animation frame; the LAST pointer position wins
      d.last = p
      if (d.raf === null) {
        d.raf = requestAnimationFrame(() => {
          d.raf = null
          if (dragRef.current === d && d.last) applyGesture(d, d.last)
        })
      }
    }
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (d.kind === 'draw') {
        const rect = normaliseRect(d.start, flowPt(e))
        setDraft(null)
        if (frameIsCreatable(rect, zoom, nodes)) addFrame(rect)
        else disarmTool()
        return
      }
      cancelRaf(d)
      applyGesture(d, flowPt(e)) // the exact final Δ, whatever the last frame showed
      // commit iff the FINAL rect differs from the origin — a click, an unmoved
      // press, or an out-and-back gesture is a no-op: origin written back, no
      // entry, no promotion (never a sticky "moved" flag)
      const originRect = d.kind === 'move' ? d.origin.rect : d.orig
      if (rectEq(d.current, originRect)) {
        restoreGesture(d)
        return
      }
      // ONE entry for the whole gesture — the pre-gesture snapshot
      useGraphStore.getState().pushGestureEntry(d.snapshot)
      if (d.isAuto) {
        // §AF5 R5/R6 — a moved / resized auto frame PROMOTES, inside the same entry
        adoptFrameSilently(d.current, d.label)
        removeAuto(d.id)
        setAutoDraft(null)
      }
    }
    // Esc / pointercancel while a move / resize is in flight: put the origin
    // back, push nothing (D12). The draw tool has its own cancel below.
    const onCancel = (e: Event) => {
      const d = dragRef.current
      if (!d || d.kind === 'draw') return
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      e.preventDefault()
      dragRef.current = null
      cancelRaf(d)
      restoreGesture(d)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onCancel)
    }
  }, [flowPt, zoom, nodes, addFrame, disarmTool, adoptFrameSilently, removeAuto, applyGesture, restoreGesture])

  // 4a Frame tool — draw on empty canvas
  useEffect(() => {
    if (!toolArmed) return
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return
    const onDown = (ev: Event) => {
      const start = flowPt(ev as PointerEvent)
      dragRef.current = { kind: 'draw', start }
      setDraft({ x: start.x, y: start.y, w: 0, h: 0 })
    }
    const onCancel = (e: Event) => {
      if ((e as KeyboardEvent).key && (e as KeyboardEvent).key !== 'Escape') return
      e.preventDefault()
      dragRef.current = null
      setDraft(null)
      disarmTool()
    }
    pane.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onCancel)
    window.addEventListener('contextmenu', onCancel)
    return () => {
      pane.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onCancel)
      window.removeEventListener('contextmenu', onCancel)
    }
  }, [toolArmed, flowPt, disarmTool])

  // clear a stale selection (a selected frame that was dismissed / promoted /
  // re-suggested / cleared)
  useEffect(() => {
    if (selectedId === null) return
    const live = frames.some((f) => f.id === selectedId) || autoFrames.some((f) => f.id === selectedId)
    if (!live) selectFrame(null)
  }, [selectedId, frames, autoFrames, selectFrame])

  const startChromeDrag =
    (kind: 'move' | 'resize', id: string, orig: FrameRect, isAuto: boolean, label = '') =>
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      selectFrame(id)
      if (!editable) return // D6 — select only
      const G = useGraphStore.getState()
      const anchor = flowPt(e)
      const snapshot = G.captureGestureSnapshot()
      if (kind === 'move') {
        const origin = captureMoveOrigin({
          frameId: id,
          rect: orig,
          isAuto,
          frameOnly: e.altKey, // frozen for the whole gesture (D5)
          anchor,
          frames: useFrameStore.getState().frames,
          nodes: G.nodes,
          edges: G.edges,
        })
        dragRef.current = { kind, id, isAuto, label, origin, snapshot, last: null, raf: null, current: orig }
      } else {
        dragRef.current = { kind, id, isAuto, label, anchor, orig, snapshot, last: null, raf: null, current: orig }
      }
      if (isAuto) setAutoDraft({ id, rect: orig })
    }

  type RenderFrame = {
    id: string
    rect: FrameRect
    label: string
    ord: number
    auto: boolean
    color?: FrameColor
  }
  const manualRF: RenderFrame[] = frames.map((f) => ({
    id: f.id,
    rect: f.rect,
    label: f.label,
    ord: f.n,
    auto: false,
    color: f.color,
  }))
  const autoRF: RenderFrame[] = autoFrames.map((f) => ({
    id: f.id,
    rect: autoDraft && autoDraft.id === f.id ? autoDraft.rect : f.rect,
    label: f.label,
    ord: f.area,
    auto: true,
  }))
  // paint order: auto BEHIND manual (§AF5 R2)
  const ordered = [...autoRF, ...manualRF]

  const commitLabel = (rf: RenderFrame, v: string) => {
    if (rf.auto) {
      // any rename commit promotes (§AF5 R5); default fallback = empty label
      const def = t('canvas.frame.areaName', { n: rf.ord })
      adoptFrame(rf.rect, v === def ? '' : v)
      removeAuto(rf.id)
    } else {
      const def = t('canvas.frame.defaultName', { n: rf.ord })
      renameFrame(rf.id, v === def ? '' : v)
    }
  }

  // §FC5 — pick an accent (or `null` for neutral). On a MANUAL frame it just
  // sets the colour. On an AUTO frame, picking an accent PROMOTES it (§AF5 R5);
  // picking neutral is a no-op — the frame stays auto (§AF5 R6).
  const pickColor = (rf: RenderFrame, color: FrameColor | null) => {
    if (rf.auto) {
      if (color === null) return
      adoptFrame(rf.rect, rf.label, color)
      removeAuto(rf.id)
    } else {
      setFrameColor(rf.id, color)
    }
  }

  return (
    <>
      {/* §LGR6.6 — one polite region for every frame gesture, and the three
          shared descriptions the containers point at. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-frame-announce>
        {announcement}
      </div>
      <div className="sr-only" aria-hidden="true">
        <span id={DESC_ID}>{t('canvas.frame.a11y.desc')}</span>
        <span id={DESC_SELECTED_ID}>{t('canvas.frame.a11y.descSelected')}</span>
        <span id={DESC_READONLY_ID}>{t('canvas.frame.a11y.descReadonly')}</span>
      </div>

      {/* BEHIND — visual only, below the pane, never hit-testable */}
      <svg className="lgr-frame-back" aria-hidden="true">
        <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
          {ordered.map((rf) => (
            <rect
              key={rf.id}
              className={`lgr-frame__fill${rf.auto ? ' lgr-frame__fill--auto' : ''}${rf.id === selectedId ? ' is-selected' : ''}`}
              data-color={rf.color ?? undefined}
              x={rf.rect.x}
              y={rf.rect.y}
              width={rf.rect.w}
              height={rf.rect.h}
              rx={6}
            />
          ))}
          {draft ? (
            <rect
              className="lgr-frame__fill lgr-frame__fill--draft"
              x={draft.x}
              y={draft.y}
              width={draft.w}
              height={draft.h}
              rx={6}
            />
          ) : null}
        </g>
      </svg>

      {/* CHROME — interactive parts only, on top of the nodes */}
      <ViewportPortal>
        {ordered.map((rf) => {
          const sel = rf.id === selectedId
          // §AF-INV-7 — a mobile auto frame has no hit-test surface at all
          const selectable = !(rf.auto && isMobile)
          // D6 — anything that changes saved state needs an editable canvas
          const canEdit = editable
          const def = rf.auto
            ? t('canvas.frame.areaName', { n: rf.ord })
            : t('canvas.frame.defaultName', { n: rf.ord })
          // §FC4 — the accent picker: desktop only, on a selected frame.
          const showSwatches = sel && canEdit
          // §LGR6.6 — the accessible name carries what the frame holds right
          // now. Derived, never stored (R5-D3), exactly like the drag's own
          // membership rule.
          const held = moveTargets(rf.rect, rf.id, frames, nodes, edges).nodeIds.length
          return (
            <div
              key={rf.id}
              className={`lgr-frame${rf.auto ? ' lgr-frame--auto' : ''}${sel ? ' is-selected' : ''}`}
              data-color={rf.color ?? undefined}
              style={{ transform: `translate(${rf.rect.x}px, ${rf.rect.y}px)`, width: rf.rect.w, height: rf.rect.h }}
              // the focus unit. Present on a locked / mobile canvas too — role,
              // name, focus and selection are the read-only minimum; only the
              // editing paths below are gated (D6 / §LGR6.6).
              {...(selectable ? { tabIndex: 0 } : {})}
              role="group"
              aria-roledescription={t(rf.auto ? 'canvas.frame.a11y.roledescriptionAuto' : 'canvas.frame.a11y.roledescription')}
              aria-label={t('canvas.frame.a11y.name', { label: rf.label || def, n: held })}
              aria-describedby={!canEdit ? DESC_READONLY_ID : sel ? DESC_SELECTED_ID : DESC_ID}
              onKeyDown={(e) => {
                // only the container's own keys — an Enter on the label button
                // or a swatch must reach that control, not be swallowed here
                if (e.target !== e.currentTarget) return
                if (e.key === 'Escape') {
                  if (keyRef.current) {
                    e.preventDefault()
                    e.stopPropagation()
                    endKeyGesture(false) // origin back, no entry, no promotion
                    return
                  }
                  if (sel) {
                    e.preventDefault()
                    selectFrame(null)
                  }
                  return
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectFrame(rf.id)
                  return
                }
                if (!ARROWS[e.key]) return
                if (!canEdit || !sel) return
                pressArrow('move', rf, rf.label || def, e)
              }}
              onBlur={(e) => {
                // focus left the frame entirely (not just moved to its own
                // chrome): settle any open transaction
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                if (keyRef.current && keyRef.current.id === rf.id) endKeyGesture(true)
              }}
            >
              {selectable
                ? (['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <div
                      key={side}
                      className={`lgr-frame__edge-hit lgr-frame__edge-hit--${side}`}
                      aria-hidden="true"
                      onPointerDown={startChromeDrag('move', rf.id, rf.rect, rf.auto, rf.label)}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectFrame(rf.id)
                      }}
                    />
                  ))
                : null}

              <FrameLabel
                def={def}
                label={rf.label}
                editable={canEdit}
                selected={sel}
                onCommit={(v) => commitLabel(rf, v)}
                onSelect={() => selectFrame(rf.id)}
              />

              {sel && canEdit ? (
                <>
                  <button
                    type="button"
                    className="lgr-frame__del"
                    aria-label={rf.auto ? t('canvas.frame.dismiss') : t('canvas.frame.delete')}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (rf.auto) dismissAuto(rf.id)
                      else removeFrame(rf.id)
                    }}
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    className="lgr-frame__resize"
                    aria-label={t('canvas.frame.a11y.resize', {
                      label: rf.label || def,
                      w: Math.round(rf.rect.w),
                      h: Math.round(rf.rect.h),
                    })}
                    onPointerDown={startChromeDrag('resize', rf.id, rf.rect, rf.auto, rf.label)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && keyRef.current) {
                        e.preventDefault()
                        e.stopPropagation()
                        endKeyGesture(false)
                        return
                      }
                      if (!ARROWS[e.key]) return
                      pressArrow('resize', rf, rf.label || def, e)
                    }}
                    onBlur={() => {
                      if (keyRef.current && keyRef.current.id === rf.id && keyRef.current.kind === 'resize') endKeyGesture(true)
                    }}
                  />
                </>
              ) : null}

              {showSwatches ? (
                <div
                  className="lgr-frame__swatches"
                  role="group"
                  aria-label={t('canvas.frame.colorRow')}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {([null, ...FRAME_COLORS] as (FrameColor | null)[]).map((c) => {
                    const active = (rf.color ?? null) === c
                    return (
                      <button
                        key={c ?? 'neutral'}
                        type="button"
                        className={`lgr-frame__swatch${active ? ' is-active' : ''}`}
                        data-color={c ?? undefined}
                        aria-label={t(COLOR_KEY[c ?? 'neutral'])}
                        aria-pressed={active}
                        onClick={(e) => {
                          e.stopPropagation()
                          pickColor(rf, c)
                        }}
                      />
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </ViewportPortal>
    </>
  )
}

/** the top-left caption chip. Empty ⇒ the locale default (`Group N` manual /
 *  `Area N` auto — passed in as `def`). */
function FrameLabel({
  def,
  label,
  editable,
  selected,
  onCommit,
  onSelect,
}: {
  def: string
  label: string
  editable: boolean
  /** §LGR6.6 — the container is the frame's single tab stop; the label joins
   *  the tab order only once the frame is selected, next to ✕ / the swatches /
   *  the resize handle, so the keyboard rename path is kept without a
   *  duplicate stop on every frame. */
  selected: boolean
  onCommit: (v: string) => void
  onSelect: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    onCommit(draft.trim())
  }

  // §AF-INV-7 / D6 — a non-editable label (a mobile auto frame, or any frame
  // on a locked / mobile canvas) is a plain span
  if (!editable) {
    return <span className="lgr-frame__label lgr-frame__label--static">{label || def}</span>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="lgr-frame__label lgr-frame__label--edit"
        defaultValue={label || def}
        onChange={(e) => setDraft(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setEditing(false)
            setDraft(label)
          }
        }}
        onBlur={commit}
      />
    )
  }
  return (
    <button
      type="button"
      className="lgr-frame__label"
      tabIndex={selected ? 0 : -1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
        setDraft(label)
        setEditing(true)
      }}
    >
      {label || def}
    </button>
  )
}

export { FRAME_MIN_SCREEN_PX }
