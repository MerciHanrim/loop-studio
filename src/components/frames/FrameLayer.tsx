import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import { useFrameStore, type FrameRect } from '../../store/frameStore'
import { useGraphStore } from '../../store/graphStore'
import { useT } from '../../i18n'
import { FRAME_MIN_SCREEN_PX, frameIsCreatable, normaliseRect } from './frameGeom'

// docs/large-graph-readability.md §LGR6 — the transient group-frame render layer.
//
//   • BEHIND layer  — a full-pane <svg> at z-index 0 (below the RF pane), so
//     frames always paint behind every node and edge. `pointer-events: none`:
//     a click on a frame's interior falls straight through to the node / edge /
//     pane beneath it (§LGR6 answer).
//   • CHROME layer  — a <ViewportPortal> (on top), carrying ONLY the
//     interactive parts: four thin edge hit-strips (select / drag the rect),
//     the label chip (inline rename), and — when selected — a resize corner and
//     a delete ✕. The frame body in this layer has no element, so it never
//     intercepts a node / edge click.
//   • DRAW           — while the Frame tool is armed, a pane `pointerdown`
//     (empty canvas only — never a node / edge / handle) rubber-bands a rect;
//     on release it becomes a frame iff it clears `frameIsCreatable`
//     (≥ 48 px on screen AND ≥ 1 node fully inside). Esc / right-click / a
//     second tool click cancels. One-shot: the tool disarms after one frame.
//
// Nothing here touches the GraphDoc, node positions, undo, or the digest.

type Pt = { x: number; y: number }

export function FrameLayer() {
  const frames = useFrameStore((s) => s.frames)
  const selectedId = useFrameStore((s) => s.selectedId)
  const toolArmed = useFrameStore((s) => s.toolArmed)
  const addFrame = useFrameStore((s) => s.addFrame)
  const disarmTool = useFrameStore((s) => s.disarmTool)
  const selectFrame = useFrameStore((s) => s.selectFrame)
  const renameFrame = useFrameStore((s) => s.renameFrame)
  const resizeFrame = useFrameStore((s) => s.resizeFrame)
  const removeFrame = useFrameStore((s) => s.removeFrame)
  const t = useT()

  const [tx, ty, zoom] = useStore((s) => s.transform)
  const { screenToFlowPosition } = useReactFlow()
  const nodes = useGraphStore((s) => s.nodes)

  // ── draw / drag / resize interaction ────────────────────────────────────
  const [draft, setDraft] = useState<FrameRect | null>(null)
  const dragRef = useRef<{ kind: 'draw' | 'move' | 'resize'; id?: string; start: Pt; orig?: FrameRect } | null>(null)

  const flowPt = useCallback(
    (e: PointerEvent | React.PointerEvent): Pt => screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    [screenToFlowPosition],
  )

  // pointer move / up during any drag — attached to window so it survives
  // leaving the element
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const p = flowPt(e)
      if (d.kind === 'draw') {
        setDraft(normaliseRect(d.start, p))
      } else if (d.kind === 'move' && d.id && d.orig) {
        resizeFrame(d.id, { ...d.orig, x: d.orig.x + (p.x - d.start.x), y: d.orig.y + (p.y - d.start.y) })
      } else if (d.kind === 'resize' && d.id && d.orig) {
        resizeFrame(d.id, {
          x: d.orig.x,
          y: d.orig.y,
          w: Math.max(1, d.orig.w + (p.x - d.start.x)),
          h: Math.max(1, d.orig.h + (p.y - d.start.y)),
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
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [flowPt, zoom, nodes, addFrame, disarmTool, resizeFrame])

  // start a draw when the Frame tool is armed and the user presses EMPTY canvas
  useEffect(() => {
    if (!toolArmed) return
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return
    const onDown = (ev: Event) => {
      const e = ev as PointerEvent
      // `.react-flow__pane` only receives the event when the press is NOT on a
      // node / edge / handle (those sit above it) — so this is already
      // "empty canvas only".
      const start = flowPt(e)
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

  const startChromeDrag =
    (kind: 'move' | 'resize', id: string, orig: FrameRect) => (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      selectFrame(id)
      dragRef.current = { kind, id, start: flowPt(e), orig }
    }

  const rects = draft ? [...frames.map((f) => f.rect), draft] : frames.map((f) => f.rect)
  void rects // (kept for readability; both layers iterate `frames` + `draft`)

  return (
    <>
      {/* BEHIND — visual only, below the pane, never hit-testable */}
      <svg className="lgr-frame-back" aria-hidden="true">
        <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
          {frames.map((f) => (
            <rect
              key={f.id}
              className={`lgr-frame__fill${f.id === selectedId ? ' is-selected' : ''}`}
              x={f.rect.x}
              y={f.rect.y}
              width={f.rect.w}
              height={f.rect.h}
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
        {frames.map((f) => {
          const sel = f.id === selectedId
          return (
            <div
              key={f.id}
              className={`lgr-frame${sel ? ' is-selected' : ''}`}
              style={{
                transform: `translate(${f.rect.x}px, ${f.rect.y}px)`,
                width: f.rect.w,
                height: f.rect.h,
              }}
            >
              {/* four edge hit-strips: click selects, drag moves the rect */}
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div
                  key={side}
                  className={`lgr-frame__edge-hit lgr-frame__edge-hit--${side}`}
                  onPointerDown={startChromeDrag('move', f.id, f.rect)}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectFrame(f.id)
                  }}
                />
              ))}

              <FrameLabel
                n={f.n}
                label={f.label}
                onCommit={(v) => renameFrame(f.id, v)}
                onSelect={() => selectFrame(f.id)}
              />

              {sel ? (
                <>
                  <button
                    type="button"
                    className="lgr-frame__del"
                    aria-label={t('canvas.frame.delete')}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFrame(f.id)
                    }}
                  >
                    ✕
                  </button>
                  <div
                    className="lgr-frame__resize"
                    role="presentation"
                    onPointerDown={startChromeDrag('resize', f.id, f.rect)}
                  />
                </>
              ) : null}
            </div>
          )
        })}
      </ViewportPortal>
    </>
  )
}

/** the top-left caption chip. Empty ⇒ the locale default `Group N` / `그룹 N`. */
function FrameLabel({
  n,
  label,
  onCommit,
  onSelect,
}: {
  n: number
  label: string
  onCommit: (v: string) => void
  onSelect: () => void
}) {
  const t = useT()
  const def = t('canvas.frame.defaultName', { n })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    // empty ⇒ fall back to the default for this frame (identity is the id, not
    // the label — duplicates are fine)
    onCommit(v === def ? '' : v)
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

// draw-mode min-size hint for callers that want to surface it
export { FRAME_MIN_SCREEN_PX }
