import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react'
import { useSimStore } from '../../store/simStore'
import type { LoopEdgeData } from '../../model/types'
import type { StateEvent } from '../../engine'

const FALLBACK: LoopEdgeData = { kind: 'resource', flow: '1' }
const FAST_MS = 300
const LABEL_HIDE_ZOOM = 0.6

const fmtAmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const fmtSigned = (n: number) => `${n > 0 ? '+' : ''}${fmtAmt(n)}`

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function LoopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const amount = useSimStore((s) => s.activeByEdge[id] ?? 0)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const status = useSimStore((s) => s.status)
  const stateEvent = useSimStore((s) => s.stateEvents.find((e) => e.edgeId === id))
  const lowZoom = useStore((s) => s.transform[2] < LABEL_HIDE_ZOOM)

  const d = (data as LoopEdgeData | undefined) ?? FALLBACK
  const isState = d.kind === 'state'

  let text: string
  if (d.kind === 'resource') text = d.flow || '1'
  else if (d.mode === 'trigger') text = '✳'
  else if (d.mode === 'activator') text = d.expr || '≥'
  else text = d.expr || '±'

  const rm = reducedMotion()
  const running = status === 'running' || status === 'paused'
  const flowing = amount > 0 && !isState && running
  const showToken = flowing && !rm
  const fast = speedMs <= FAST_MS
  const dur = Math.min(Math.max(speedMs * 0.7, 150), 680)
  const anim = { dur: `${dur}ms`, repeatCount: 1, fill: 'freeze' as const, path }

  // ── state-edge feedback (SEMANTICS-S.md §S9 / SEMANTICS-S2.md §S2-9) ──
  // a live step's event drives it; Reset / edit clear `stateEvents` so it goes
  // away, and every animated node is keyed on `stepIndex` so nothing stacks.
  const sv = isState ? stateVisual(stateEvent) : null
  const activatorOn = sv?.kind === 'activator' ? sv.satisfied : undefined

  // start-of-flow dot only when the edge is selected; never at plain rest
  const startDot = selected && !isState && !showToken
  const sx = sourceX + (targetX - sourceX) * 0.08
  const sy = sourceY + (targetY - sourceY) * 0.08

  // labels drop out when zoomed out to scan structure — kept for a selected edge
  const showLabel = !lowZoom || selected

  const baseStroke = selected
    ? 'var(--edge-selected)'
    : activatorOn === true
      ? 'var(--signal-primary)'
      : isState
        ? 'var(--edge-state)'
        : 'var(--edge-resource)'

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: baseStroke,
          strokeWidth: selected ? 2 : activatorOn === true ? 1.8 : isState ? 1 : 1.5,
          strokeDasharray: isState ? '4 4' : undefined,
          strokeLinecap: isState ? 'butt' : 'round',
          opacity: activatorOn === false ? 0.5 : 1,
        }}
      />

      {/* reduced motion: no travel — a one-step edge emphasis instead */}
      {flowing && rm ? (
        <path key={`p-${id}-${stepIndex}`} className="flow-edge-pulse" d={path} fill="none" />
      ) : null}

      {/* state edge, reduced motion: static one-step highlight for pulse / flash */}
      {sv && (sv.kind === 'trigger' || sv.kind === 'label') && rm ? (
        <path
          key={`sp-${id}-${stepIndex}`}
          className={`state-edge-pulse${sv.kind === 'trigger' && !sv.applied ? ' state-edge-pulse--blocked' : ''}`}
          d={path}
          fill="none"
        />
      ) : null}

      {startDot ? <circle className="flow-rest" cx={sx} cy={sy} r="2.5" /> : null}

      {/* state edge, full motion: trigger pulse on the delivery step */}
      {sv?.kind === 'trigger' && !rm ? (
        <g
          key={`trig-${id}-${stepIndex}`}
          className={`state-pulse${sv.applied ? '' : ' state-pulse--blocked'}`}
        >
          <circle className="state-pulse__bead" r={sv.applied ? 4 : 3.4} />
          <animateMotion {...anim} rotate="auto" />
        </g>
      ) : null}

      {/* state edge, full motion: label flash — direction is raw `delta` only */}
      {sv?.kind === 'label' && !rm && sv.delta !== 0 ? (
        <g
          key={`lbl-${id}-${stepIndex}`}
          className={`state-flash state-flash--${sv.delta > 0 ? 'in' : 'out'}`}
        >
          <circle className="state-flash__bead" r="3.4" />
          <animateMotion
            {...anim}
            keyPoints={sv.delta > 0 ? '0;1' : '1;0'}
            keyTimes="0;1"
            calcMode="linear"
          />
        </g>
      ) : null}

      {showToken ? (
        <g key={`t-${id}-${stepIndex}`} className={`flow-move${fast ? ' flow-move--fast' : ''}`}>
          {fast ? (
            <g>
              <rect className="flow-trail" x="-11" y="-2.5" width="22" height="5" rx="2.5" />
              <animateMotion {...anim} rotate="auto" />
            </g>
          ) : null}
          <g>
            {fast ? (
              <rect className="flow-bead flow-bead--fast" x="-6" y="-2" width="12" height="4" rx="2" />
            ) : (
              <circle className="flow-bead" r="3.6" />
            )}
            <animateMotion {...anim} rotate="auto" />
          </g>
          {amount > 1 ? (
            <g>
              <text className="flow-token__n" dy="-8">
                {fmtAmt(amount)}
              </text>
              <animateMotion {...anim} />
            </g>
          ) : null}
        </g>
      ) : null}

      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            data-edge-id={id}
            className={`edge-label${isState ? ' edge-label--state' : ''}${
              selected ? ' is-selected' : ''
            }${activatorOn === true ? ' edge-label--on' : ''}${
              sv?.kind === 'trigger' && !sv.applied ? ' edge-label--blocked' : ''
            }`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {text}
            {sv?.kind === 'label' && sv.delta !== 0 ? (
              <span className="edge-label__delta">{fmtSigned(sv.delta)}</span>
            ) : null}
            {sv?.kind === 'label' && sv.clampAdjustment !== 0 ? (
              <span className="edge-label__clamp" title="removed by the target Pool's single end-of-Phase-0 clamp">
                clamp {fmtSigned(sv.clampAdjustment)}
              </span>
            ) : null}
            {sv?.kind === 'trigger' && !sv.applied ? (
              <span className="edge-label__blocked" title="delivered, but the target could not fire (wrong activation, or an activator held it closed)">
                blocked
              </span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

type StateVisual =
  | { kind: 'trigger'; applied: boolean }
  | { kind: 'activator'; satisfied: boolean }
  | { kind: 'label'; delta: number; clampAdjustment: number }

function stateVisual(ev: StateEvent | undefined): StateVisual | null {
  if (!ev) return null
  if (ev.effect.kind === 'trigger') return { kind: 'trigger', applied: ev.effect.applied }
  if (ev.effect.kind === 'activator') return { kind: 'activator', satisfied: ev.effect.satisfied }
  return { kind: 'label', delta: ev.effect.delta, clampAdjustment: ev.effect.clampAdjustment }
}

export const edgeTypes: EdgeTypes = {
  loop: LoopEdge,
}
