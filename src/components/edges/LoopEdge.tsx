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

const FALLBACK: LoopEdgeData = { kind: 'resource', flow: '1' }
const FAST_MS = 300
const LABEL_HIDE_ZOOM = 0.6

const fmtAmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

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
  const lowZoom = useStore((s) => s.transform[2] < LABEL_HIDE_ZOOM)

  const d = (data as LoopEdgeData | undefined) ?? FALLBACK
  const isState = d.kind === 'state'

  let text: string
  if (d.kind === 'resource') text = d.flow || '1'
  else if (d.mode === 'trigger') text = '✳'
  else if (d.mode === 'activator') text = d.expr || '≥'
  else text = d.expr || '±'

  const rm = reducedMotion()
  const flowing = amount > 0 && !isState && (status === 'running' || status === 'paused')
  const showToken = flowing && !rm
  const fast = speedMs <= FAST_MS
  const dur = Math.min(Math.max(speedMs * 0.7, 150), 680)
  const anim = { dur: `${dur}ms`, repeatCount: 1, fill: 'freeze' as const, path }

  // start-of-flow dot only when the edge is selected; never at plain rest
  const startDot = selected && !isState && !showToken
  const sx = sourceX + (targetX - sourceX) * 0.08
  const sy = sourceY + (targetY - sourceY) * 0.08

  // labels drop out when zoomed out to scan structure — kept for a selected edge
  const showLabel = !lowZoom || selected

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected
            ? 'var(--edge-selected)'
            : isState
              ? 'var(--edge-state)'
              : 'var(--edge-resource)',
          strokeWidth: selected ? 2 : isState ? 1 : 1.5,
          strokeDasharray: isState ? '5 4' : undefined,
        }}
      />

      {/* reduced motion: no travel — a one-step edge emphasis instead */}
      {flowing && rm ? (
        <path key={`p-${id}-${stepIndex}`} className="flow-edge-pulse" d={path} fill="none" />
      ) : null}

      {startDot ? <circle className="flow-rest" cx={sx} cy={sy} r="2.5" /> : null}

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
            className={`edge-label${isState ? ' edge-label--state' : ''}${
              selected ? ' is-selected' : ''
            }`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const edgeTypes: EdgeTypes = {
  loop: LoopEdge,
}
