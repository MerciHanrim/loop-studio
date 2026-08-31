import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { useSimStore } from '../../store/simStore'
import { currentRouteMap } from '../../store/routeMap'
import { useLod } from '../lod'
import type { LoopEdgeData } from '../../model/types'
import type { StateEvent } from '../../engine'
import { EDGE_MARKER } from './EdgeMarkers'

const FALLBACK: LoopEdgeData = { kind: 'resource', flow: '1' }
// docs/visual-language.md §VL7.2 — the flow / condition chip is L2-only detail;
// the edge class (solid vs dashed) and the direction marker are the §VL7.1
// required set and are never hidden. A selected edge keeps its label at any zoom.
const LABEL_L2_MIN = 0.8

// docs/simulation-playback.md Slice 2 — the token walks the `travel` beat of the
// τ axis. The store owns τ (Slice 1); this layer only reads it.
const PB_TRAVEL_START = 0.15
const PB_TRAVEL_END = 0.8

const fmtAmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const fmtSigned = (n: number) => `${n > 0 ? '+' : ''}${fmtAmt(n)}`

// A detached <path> reused to sample any `d` string at a length fraction. Works
// on a non-mounted element in every SVG-capable browser; `document`-guarded so
// SSR / jsdom never touch it.
let _pbPath: SVGPathElement | null = null
function pointOnPath(d: string, t: number): { x: number; y: number } {
  if (typeof document === 'undefined') return { x: 0, y: 0 }
  if (!_pbPath) _pbPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  if (_pbPath.getAttribute('d') !== d) _pbPath.setAttribute('d', d)
  let len = 0
  try {
    len = _pbPath.getTotalLength()
  } catch {
    return { x: 0, y: 0 }
  }
  const p = _pbPath.getPointAtLength(Math.max(0, Math.min(1, t)) * len)
  return { x: p.x, y: p.y }
}
/** τ → position fraction along the edge: held at the source through `depart`,
 *  linear across `travel`, held at the target through `arrive` / `settle`. */
const travelFraction = (tau: number): number => {
  if (tau <= PB_TRAVEL_START) return 0
  if (tau >= PB_TRAVEL_END) return 1
  return (tau - PB_TRAVEL_START) / (PB_TRAVEL_END - PB_TRAVEL_START)
}

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
}: EdgeProps) {
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // loop-revision/3 §R3-2 / docs/edge-routing.md — an `orthogonal` edge takes
  // its `d` from the atomic route map (§ER3.9); everything else (marker, bead,
  // pulse, rings, LOD) just consumes the `path` string.
  const routeMode = (data as { route?: unknown } | undefined)?.route
  const gNodes = useGraphStore((s) => s.nodes)
  const gEdges = useGraphStore((s) => s.edges)
  const route = routeMode === 'orthogonal' ? currentRouteMap(gNodes, gEdges).get(id) : undefined
  const path = route ? route.d : bezierPath
  const labelX = route ? route.mid.x : bezierLabelX
  const labelY = route ? route.mid.y : bezierLabelY

  const amount = useSimStore((s) => s.activeByEdge[id] ?? 0)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const status = useSimStore((s) => s.status)
  const stateEvent = useSimStore((s) => s.stateEvents.find((e) => e.edgeId === id))
  // docs/simulation-playback.md Slice 2 — a READ-ONLY consumer of the in-flight
  // transition. Only an edge that carries flow / a state effect this step
  // re-renders per τ frame; every other edge's selector returns null both frames
  // (so selecting a node, panning, etc. never re-render an idle edge's token).
  const edgeKind = (data as { kind?: unknown } | undefined)?.kind
  const transition = useSimStore((s) => {
    const t = s.transition
    if (!t) return null
    if (edgeKind === 'state') return t
    return (t.flowByEdge[id] ?? 0) > 0 ? t : null
  })
  const lowZoom = useStore((s) => s.transform[2] < LABEL_L2_MIN)
  // §PB4.4 — the L0 ("map") level shares the canvas-wide LOD classifier (../lod);
  // no second copy of the 0.45 threshold. At L0 the sub-pixel travelling dot is
  // elided, the ordered depart / path-pulse / arrive cues still play, and
  // `settle` still commits.
  const atL0 = useLod() === 'L0'

  const d = (data as LoopEdgeData | undefined) ?? FALLBACK
  const isState = d.kind === 'state'

  let text: string
  if (d.kind === 'resource') text = d.flow || '1'
  else if (d.mode === 'trigger') text = '✳'
  else if (d.mode === 'activator') text = d.expr || '≥'
  else text = d.expr || '±'

  const rm = reducedMotion()
  const running = status === 'running' || status === 'paused'
  // reduced-motion substitute for a travelling token: a held highlight on the
  // edge that carried flow this (committed) step — set once the step settles,
  // stays through Pause, clears on Reset (docs/visual-language.md §VL9). The
  // choreography scheduler settles a reduced-motion step near-instantly.
  const rmHeldPulse = rm && !isState && amount > 0 && running
  const dur = Math.min(Math.max(speedMs * 0.7, 150), 680)
  const anim = { dur: `${dur}ms`, repeatCount: 1, fill: 'freeze' as const, path }

  // ── Slice 2 choreography — the token walks the real `d` in step with τ ──
  // The scheduler owns τ / phase / commit (Slice 1); this layer only reads.
  const pbPhase = transition && !isState ? transition.phase : null
  const pbFlow = transition && !isState ? (transition.flowByEdge[id] ?? 0) : 0
  // the ordered phase cues (depart ring · travel path-pulse · arrive ring) —
  // shown whenever a resource transition is in flight and motion is allowed,
  // at every zoom including L0.
  const pbCueOn = pbFlow > 0 && !rm && !!pbPhase
  // the travelling dot itself — elided at L0 (§PB4.4).
  const pbToken = pbCueOn && !atL0
  const pbFrac = transition ? travelFraction(transition.tau) : 0
  const pbPt = pbToken ? pointOnPath(path, pbFrac) : null
  const pbEndPt = pbCueOn && pbPhase === 'arrive' ? pointOnPath(path, 1) : null
  const pbAll = selected && transition && !isState ? transition.events.filter((e) => e.edgeId === id) : []
  const pbBreakdown = pbAll.slice(0, 8)
  const pbBreakdownRest = pbAll.length - pbBreakdown.length

  // ── state-edge feedback (SEMANTICS-S.md §S9 / SEMANTICS-S2.md §S2-9) ──
  // a live step's event drives it; Reset / edit clear `stateEvents` so it goes
  // away, and every animated node is keyed on `stepIndex` so nothing stacks.
  const sv = isState ? stateVisual(stateEvent) : null
  const activatorOn = sv?.kind === 'activator' ? sv.satisfied : undefined

  // start-of-flow dot only when the edge is selected and idle; hidden during a
  // transition so it never doubles up with the token.
  const startDot = selected && !isState && transition == null
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

  // §VL6 — the renderer owns the direction marker (see EdgeMarkers.tsx); it is
  // always drawn and tracks the edge class so the arrow is tokenised in both
  // themes, never React Flow's fixed grey.
  const markerId = selected
    ? EDGE_MARKER.selected
    : isState
      ? EDGE_MARKER.state
      : EDGE_MARKER.resource

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${markerId})`}
        className={
          route
            ? `route-${route.routeClass}${route.invalidWaypoint ? ' route-invalid' : ''}`
            : undefined
        }
        style={{
          stroke: baseStroke,
          strokeWidth: selected ? 2 : activatorOn === true ? 1.8 : isState ? 1 : 1.5,
          strokeDasharray: isState ? '4 4' : undefined,
          strokeLinecap: isState ? 'butt' : 'round',
          opacity: activatorOn === false ? 0.5 : 1,
        }}
      />

      {/* docs/edge-routing.md §ER4 — a route point inside a node. The dashed
          `--warning` stroke is the colour tell; this `!` badge at the route
          midpoint is the NON-colour tell (a glyph, present-or-absent — survives
          `forced-colors` / greyscale and never collides with a dashed state
          edge), and it carries the accessible name. */}
      {route?.invalidWaypoint ? (
        <g
          className="route-invalid-flag"
          transform={`translate(${labelX}, ${labelY})`}
          role="img"
          aria-label="invalid route — a route point is inside a node"
        >
          <circle r="7.5" />
          <text textAnchor="middle" dominantBaseline="central" dy="0.5">
            !
          </text>
        </g>
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

      {/* Slice 2 — the τ-synced choreography (Step AND Play take this same
          path). Every position is a pure function of `transition.tau`, so Pause
          freezes it, a speed change re-rates it, and a discard removes it — no
          token-specific state. `data-playback-phase` makes the beat observable.
          Slice 3 — at L0 the moving `<g>` is elided; the depart / travel-pulse /
          arrive cues below still play in order (§PB4.4). */}
      {pbCueOn ? (
        <>
          {/* depart: a cue at the source */}
          {pbPhase === 'depart' ? (
            <circle
              className="pb-cue pb-cue--depart"
              data-playback-phase="depart"
              cx={sourceX}
              cy={sourceY}
              r="6"
            />
          ) : null}
          {/* travel, L0 only: a directional path pulse in place of the dot */}
          {pbPhase === 'travel' && atL0 ? (
            <path
              className="pb-l0-pulse"
              data-playback-phase="travel"
              d={path}
              fill="none"
            />
          ) : null}
          {/* arrive: a cue at the target */}
          {pbPhase === 'arrive' && pbEndPt ? (
            <circle
              className="pb-cue pb-cue--arrive"
              data-playback-phase="arrive"
              cx={pbEndPt.x}
              cy={pbEndPt.y}
              r="6"
            />
          ) : null}
          {pbToken && pbPt ? (
            <g
              className={`pb-move pb-move--${pbPhase}`}
              data-playback-phase={pbPhase}
              transform={`translate(${pbPt.x} ${pbPt.y})`}
            >
              <circle className="flow-bead" r="3.6" />
              {pbFlow > 1 ? (
                <text className="flow-token__n" dy="-8">
                  {fmtAmt(pbFlow)}
                </text>
              ) : null}
            </g>
          ) : null}
        </>
      ) : null}

      {/* reduced motion: no travel. During a transition, the ordered beat is
          still information (§PB9.1), so the depart ring, the path emphasis and
          the arrive ring are shown together (timing is collapsed, so "all at
          once" — not padded). `data-playback-phase` still tracks the live beat.
          Clears on settle; the held post-settle pulse below takes over. */}
      {transition && !isState && pbFlow > 0 && rm ? (
        <g key={`pbrm-${id}-${transition.fromStep}`} data-playback-phase={pbPhase}>
          <path className="flow-edge-pulse" data-playback-phase={pbPhase} d={path} fill="none" />
          <circle className="pb-cue pb-cue--depart" cx={sourceX} cy={sourceY} r="5" />
          <circle className="pb-cue pb-cue--arrive" cx={targetX} cy={targetY} r="5" />
        </g>
      ) : null}
      {/* reduced motion: the held static substitute for the travelling token —
          shown once the step has settled, kept through Pause, cleared on Reset
          (§PB9 / docs/visual-language.md §VL9). A synchronous Step-from-idle
          under reduced motion settles instantly and lands straight here. */}
      {rmHeldPulse && transition == null ? (
        <path key={`p-${id}-${stepIndex}`} className="flow-edge-pulse" d={path} fill="none" />
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
            {/* §PB4.5 — the token merges into one dot, but a selected edge shows
                the per-transfer breakdown (emission order, capped) so causality
                is not lost. The dot's own label always shows the exact sum. */}
            {pbAll.length > 1 ? (
              <span className="edge-label__breakdown" title="this step's transfers along this edge">
                {pbBreakdown.map((e, i) => (
                  <span key={i} className="edge-label__bd">
                    +{fmtAmt(e.amount)}
                  </span>
                ))}
                {pbBreakdownRest > 0 ? (
                  <span className="edge-label__bd edge-label__bd--more">+{pbBreakdownRest}</span>
                ) : null}
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
