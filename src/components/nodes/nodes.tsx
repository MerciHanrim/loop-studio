import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Handle,
  Position,
  useConnection,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import { BASE_NODE_H, clampNodeHeight, silhouettePath } from './silhouette'
import { formatRegisterValue, readParameterData, readRegisterData } from '../../model/model'
import { useGraphStore } from '../../store/graphStore'
import { useRegisterOutcome } from '../../store/registers'
import { useSimStore } from '../../store/simStore'
import { useT } from '../../i18n'
import { useI18n } from '../../i18n/store'
import { usePhrasedTitle } from './phraseTitle'
import type {
  ConverterData,
  DrainData,
  GateData,
  NodeKind,
  PoolData,
  SourceData,
} from '../../model/types'
import { useLod } from '../lod'
import { useNodeActivityOpacity } from '../frames/useActivityTint'

// ── N1 "Vessel" silhouettes ──────────────────────────────────────────────
// The outer shape carries the node's role. Type colour is used only on a small
// chip, never to fill the silhouette. Selection and firing are separate cues.
// The viewBox is `0 0 120 h` — `h` is the measured body height (>= 64 once a
// title wraps to two lines). `./silhouette` regenerates each of the seven paths
// for `h`, keeping stroke / radius / notch fixed (docs/mmo-multilingual-layout.md
// §MML1b); at h = 64 it returns the historic path verbatim.

// docs/visual-language.md §VL7.2 — three detail levels at fixed world-zoom
// thresholds; the classifier lives in ../lod so nodes, edges and playback all
// share it. Elision only fades supplementary TEXT; the silhouette, rings,
// invalid flag, run cues, footprint and hit target are identical at every
// level (§VL7.1 / §VL12.5).

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

function useFiring(id: string): boolean {
  return useSimStore((s) => s.firedNodeIds.includes(id))
}

// docs/large-graph-readability.md §LGR5 — the lighter run weight: a node the
// engine *evaluated* as an execution target this step but that did **not** act
// (`activated \ fired`). Node-only in v1, flow-execution nodes only (Parameter /
// Register are never in `activated`). Always on when a committed `StepReport`
// exists; cleared on the next commit / Reset with the rest of the run cues.
function useEvaluated(id: string): boolean {
  return useSimStore(
    (s) => s.activatedNodeIds.includes(id) && !s.firedNodeIds.includes(id),
  )
}

/** 'up' | 'down' for ~320ms after `value` changes */
function useValueDir(value: number): 'up' | 'down' | null {
  const prev = useRef(value)
  const [dir, setDir] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (value === prev.current) return
    setDir(value > prev.current ? 'up' : 'down')
    prev.current = value
    const t = window.setTimeout(() => setDir(null), 320)
    return () => window.clearTimeout(t)
  }, [value])
  return dir
}

type FrameProps = {
  nodeId: string
  kind: NodeKind
  title: string
  value?: string
  valueDir?: 'up' | 'down' | null
  /** loop-model/2 §M2 — an advisory display unit shown right after `value`
   *  (space + unit, e.g. `464 kKRW/day`). Absent ⇒ the value renders exactly as
   *  before. Never engine- / digest-affecting. */
  unit?: string
  sub?: string
  selected?: boolean
  firing?: boolean
  /** §LGR5 — `evaluated`: activated this step but did not fire. A small static
   *  bottom-left corner bracket, lower weight than `firing`'s outline pulse;
   *  ignored while `firing` is true. */
  evaluated?: boolean
  /** §LGR6-cues — the opt-in Activity overlay's per-node tint: a faint
   *  primary-fill copy of the silhouette at this opacity (0…~0.15). 0 / absent
   *  ⇒ nothing renders. Never covers the run cues / rings (drawn after it). */
  activity?: number
  arriving?: boolean
  /** §VL3 — the model layer's `invalid` state (a Register the engine can't
   *  evaluate, or an unreadable model node). A `--warning` dashed outline + a
   *  top-right `!` flag; carries no value (the caller passes `—`). */
  invalid?: boolean
  stepKey: number
}

function NodeFrame({
  nodeId,
  kind,
  title,
  value,
  valueDir,
  unit,
  sub,
  selected,
  firing,
  evaluated,
  activity,
  arriving,
  invalid,
  stepKey,
}: FrameProps) {
  const tip = useT()
  const lod = useLod()
  const mapOnly = lod === 'L0' // no text at all — silhouette + type dot
  // §MML1 — render-time phrase segmentation for JA / ZH titles (display only)
  const locale = useI18n((s) => s.activeLocale)
  const { node: titleNode, phrased } = usePhrasedTitle(title, locale)
  // per-direction: is a state edge already wired to this node's in / out port?
  const stateInWired = useStore((s) =>
    s.edges.some((e) => e.target === nodeId && e.targetHandle === 'state-target'),
  )
  const stateOutWired = useStore((s) =>
    s.edges.some((e) => e.source === nodeId && e.sourceHandle === 'state-source'),
  )
  // reveal every node's state target while a state connection is being dragged
  const draggingState = useConnection(
    (c) =>
      c.inProgress &&
      (c.fromHandle?.id === 'state-source' || c.fromHandle?.id === 'state-target'),
  )
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const isSelected = useGraphStore((s) => s.selectedNodeId === nodeId)
  const frameRef = useRef<HTMLDivElement>(null)

  // docs/mmo-multilingual-layout.md §MML1b — the body grows once a title wraps
  // to two lines. Measure the resolved box height (layout px, pre-zoom — the
  // React Flow zoom transform is on an ancestor), clamp it to this kind's
  // silhouette range, and redraw the vessel + handles at that height. The
  // ResizeObserver settles in one pass: the SVG is `position: absolute`, so a
  // viewBox change never feeds back into the box height.
  const updateNodeInternals = useUpdateNodeInternals()
  const stackRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [boxH, setBoxH] = useState(BASE_NODE_H)
  useLayoutEffect(() => {
    const stack = stackRef.current
    const label = titleRef.current
    if (!stack || !label) return
    const read = () => {
      // The box only grows once the TITLE actually wraps (offsetHeight past ~1.5
      // lines). A one-line title + a `sub` line stays at the 64px base — its
      // content sits within the vessel exactly as before. When the title wraps,
      // the box takes the real content height + the body's 12px padding + a few
      // px of breathing room, clamped to this kind's silhouette range.
      const oneLine = label.offsetHeight < 24
      const next = oneLine
        ? BASE_NODE_H
        : clampNodeHeight(kind, stack.offsetHeight + 12 + 4)
      setBoxH((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(stack)
    return () => ro.disconnect()
  }, [kind])
  useEffect(() => {
    updateNodeInternals(nodeId)
  }, [boxH, nodeId, updateNodeInternals])
  const grown = boxH > BASE_NODE_H

  // keyboard focus lands on React Flow's node wrapper, an ancestor of this div
  useEffect(() => {
    const rfNode = frameRef.current?.closest('.react-flow__node')
    if (!rfNode) return
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    rfNode.addEventListener('focusin', on)
    rfNode.addEventListener('focusout', off)
    return () => {
      rfNode.removeEventListener('focusin', on)
      rfNode.removeEventListener('focusout', off)
    }
  }, [])

  const path = silhouettePath(kind, boxH)
  // state ports are invisible at rest; they surface on hover / selection /
  // keyboard focus / while a state wire is being dragged. A port that already
  // carries a state edge stays faintly visible so the wiring reads.
  const revealed = hovered || focused || isSelected || selected === true || draggingState
  const opIn = revealed ? 1 : stateInWired ? 0.5 : 0
  const opOut = revealed ? 1 : stateOutWired ? 0.5 : 0
  // §VL3 stacking — every state is its own layer, so a Register that is
  // selected AND keyboard-focused AND invalid shows all three cues at once:
  // the outer --warning invalid ring, the solid selection ring, the inset
  // dashed focus ring, and the corner `!` flag. The accessible name carries
  // `invalid` too (not colour / shape alone).
  const aria =
    `${kind} ${title}` +
    (invalid ? ', invalid' : '') +
    (selected ? ', selected' : '') +
    (focused ? ', focused' : '')
  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={aria}
      className={
        `nodef nodef--${kind} lod-${lod}` +
        (selected ? ' is-selected' : '') +
        (focused ? ' is-focused' : '') +
        (invalid ? ' is-invalid' : '')
      }
      data-invalid={invalid ? '' : undefined}
      style={grown ? { height: boxH } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* state ports (diamonds) — top in, bottom out; hidden until needed */}
      <Handle
        type="target"
        position={Position.Top}
        id="state-target"
        className="h h--state"
        style={{ opacity: opIn }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="state-source"
        className="h h--state"
        style={{ opacity: opOut }}
      />

      <svg
        className="nodef__shape"
        viewBox={`0 0 120 ${boxH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="nodef__fill" d={path} />
        {/* docs/visual-language.md §VL0 follow-up — the node-type hue wash: a
            faint (see --node-hue-opacity) ambient fill, always weaker than the
            Activity tint drawn right after it. Shape + `.nodef__chip` remain
            the primary type tell; this is a secondary assist only. */}
        <path className="nodef__hue" d={path} />
        {/* §LGR6-cues — the opt-in Activity overlay tint: a faint primary-fill
            copy of the silhouette, above the fill but UNDER the stroke and
            every run / selection / focus cue below. Shape-accurate (never a
            rectangle overflowing an auto-width node wrapper). */}
        {activity ? (
          <path className="nodef__activity" d={path} style={{ opacity: activity }} />
        ) : null}
        <path className="nodef__stroke" d={path} />
        {kind === 'end' ? (
          <line className="nodef__endbar" x1="95" y1="15" x2="95" y2={boxH - 15} />
        ) : null}
        {/* §VL3 — invalid: a --warning dashed outline (dash pattern is the
            non-colour tell). Sits under the selection / focus rings. */}
        {invalid ? <path className="nodef__invalid" d={path} /> : null}
        {selected ? <path className="nodef__sel" d={path} /> : null}
        {/* §VL3 — keyboard focus: a DASHED ring, inside the (solid) selection
            ring; dashed-vs-solid is the non-colour tell. */}
        {focused ? <path className="nodef__focus" d={path} /> : null}
        {firing ? <path key={`w${stepKey}`} className="nodef__wave" d={path} /> : null}
        {arriving ? (
          <circle
            key={`a${stepKey}`}
            className="nodef__arrival"
            cx="60"
            cy={boxH / 2}
            r="15"
          />
        ) : null}
        {/* L0 map: type colour collapses to one dot inside the silhouette */}
        {mapOnly ? <circle className="nodef__cdot" cx="60" cy={boxH / 2} r="9" /> : null}
      </svg>

      {/* §VL4 — one persistent flag, top-right, non-colour tell for `invalid` */}
      {invalid ? (
        <span className="nodef__flag" aria-hidden="true" title={tip('node.invalidFlag')}>
          !
        </span>
      ) : null}

      {/* §LGR5 — `evaluated`: activated this step but did not act. A small
          BOTTOM-LEFT corner bracket (a rounded L: border-left + border-bottom
          only) — deliberately NOT a closed ring and NOT a circle, so it reads
          as neither a connection handle / type dot (circles), nor the
          selection / focus / invalid rings (full perimeter), nor the top-right
          `!` flag. Lower weight than the `firing` outline pulse; static in
          every motion mode; a `forced-colors` rule keeps the two strokes.
          Ignored while `firing`; not lod-gated — a run cue stays at every zoom
          (§VL7.1) and is exempt from `lgr-deemph` dimming (LGR-INV-6). */}
      {evaluated && !firing ? (
        <span className="nodef__eval" aria-hidden="true" title={tip('node.evaluatedCue')} />
      ) : null}

      {/* The body is ALWAYS in the DOM so the node's footprint / hit target is
          byte-identical across L2 / L1 / L0 (§VL7.1). The `lod-*` class fades
          the elided text: L1 hides `sub`, L0 hides the whole body — the
          silhouette + `cdot` carry the map view. */}
      <div className="nodef__body">
        <div className="nodef__stack" ref={stackRef}>
        <span className="nodef__head">
          <span className="nodef__chip" />
          <span
            className={phrased ? 'nodef__title nodef__title--phrased' : 'nodef__title'}
            ref={titleRef}
          >
            {titleNode}
          </span>
        </span>
        {value != null ? (
          <span className={`nodef__value${valueDir ? ` nodef__value--${valueDir}` : ''}`}>
            {value}
            {unit ? <span className="nodef__unit">{' '}{unit}</span> : null}
          </span>
        ) : null}
        {sub ? <span className="nodef__sub">{sub}</span> : null}
        </div>
      </div>
    </div>
  )
}

function PoolNode({ id, data, selected }: NodeProps) {
  const d = data as PoolData
  const live = useSimStore((s) => (s.values ? s.values[id] : undefined))
  const shown = live ?? d.initial
  const stepKey = useSimStore((s) => s.stepIndex)
  const arriving = useSimStore((s) => s.arrivedPoolIds.includes(id))
  // Pool's face is its count; mode / capacity stay in the inspector
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="pool"
        title={d.label}
        value={fmt(shown)}
        valueDir={useValueDir(shown)}
        sub={d.capacity != null ? `≤ ${d.capacity}` : undefined}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        arriving={arriving}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function SourceNode({ id, data, selected }: NodeProps) {
  const d = data as SourceData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="source"
        title={d.label}
        sub={`${d.activation} · ${d.mode}`}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function DrainNode({ id, data, selected }: NodeProps) {
  const d = data as DrainData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="drain"
        title={d.label}
        sub={`${d.activation} · ${d.mode}`}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

function GateNode({ id, data, selected }: NodeProps) {
  const d = data as GateData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="gate"
        title={d.label}
        sub={d.distribution}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function ConverterNode({ id, data, selected }: NodeProps) {
  const d = data as ConverterData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="converter"
        title={d.label}
        sub={d.mode}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function EndNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string }
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="end"
        title={d.label}
        selected={selected}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

// ── loop-model/1 annotation nodes — no ports, never fire ─────────────────

/** Shown when a `parameter` / `register` node's `data` cannot be read
 *  (`SEMANTICS-R2.md §R2-1.1`). Never displays a stand-in value — no `0`, no
 *  `"0"` — just the silhouette + an explicit "unreadable" cue. */
function UnreadableModelNode({
  id,
  kind,
  selected,
}: {
  id: string
  kind: 'parameter' | 'register'
  selected?: boolean
}) {
  const t = useT()
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <NodeFrame
      nodeId={id}
      kind={kind}
      title={t('node.unreadable.title', { kind })}
      sub={t('node.unreadable.sub')}
      selected={selected}
      invalid
      stepKey={stepKey}
    />
  )
}

function ParameterNode({ id, data, selected }: NodeProps) {
  const stepKey = useSimStore((s) => s.stepIndex)
  const read = readParameterData(data)
  if (!read.ok) return <UnreadableModelNode id={id} kind="parameter" selected={selected} />
  const d = read.data
  return (
    <NodeFrame
      nodeId={id}
      kind="parameter"
      title={d.label || 'Parameter'}
      value={fmt(d.value)}
      sub={d.unit || undefined}
      selected={selected}
      stepKey={stepKey}
    />
  )
}

function RegisterNode({ id, data, selected }: NodeProps) {
  const stepKey = useSimStore((s) => s.stepIndex)
  const outcome = useRegisterOutcome(id)
  const numeric = outcome && !outcome.invalid ? outcome.value : Number.NaN
  const dir = useValueDir(Number.isFinite(numeric) ? numeric : 0)
  const read = readRegisterData(data)
  if (!read.ok) return <UnreadableModelNode id={id} kind="register" selected={selected} />
  const d = read.data
  // §M3.5 — the value shown is R(currentStepIndex). §M6.2 — an invalid Register
  // shows NO number (never 0, never a stale value): a `—` placeholder.
  const invalid = !outcome || outcome.invalid
  return (
    <NodeFrame
      nodeId={id}
      kind="register"
      title={d.label || 'Register'}
      value={invalid ? '—' : formatRegisterValue(numeric, d.format)}
      valueDir={invalid ? null : dir}
      unit={invalid ? undefined : d.unit || undefined}
      sub={`= ${d.expr}`}
      selected={selected}
      invalid={invalid}
      stepKey={stepKey}
    />
  )
}

export const nodeTypes: NodeTypes = {
  pool: PoolNode,
  source: SourceNode,
  drain: DrainNode,
  gate: GateNode,
  converter: ConverterNode,
  end: EndNode,
  parameter: ParameterNode,
  register: RegisterNode,
}
