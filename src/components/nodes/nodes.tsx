import { useEffect, useRef, useState } from 'react'
import {
  Handle,
  Position,
  useConnection,
  useStore,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import { formatRegisterValue, readParameterData, readRegisterData } from '../../model/model'
import { useGraphStore } from '../../store/graphStore'
import { useRegisterOutcome } from '../../store/registers'
import { useSimStore } from '../../store/simStore'
import type {
  ConverterData,
  DrainData,
  GateData,
  NodeKind,
  PoolData,
  SourceData,
} from '../../model/types'

// ── N1 "Vessel" silhouettes ──────────────────────────────────────────────
// The outer shape carries the node's role. Type colour is used only on a small
// chip, never to fill the silhouette. Selection and firing are separate cues.
// viewBox is 120×64; stroke stays crisp via non-scaling-stroke.
const SILHOUETTE: Record<NodeKind, string> = {
  pool: 'M32 6 H88 Q95 6 96 13 L112 52 Q113 58 107 58 H13 Q7 58 8 52 L24 13 Q25 6 32 6 Z',
  source: 'M14 8 Q8 8 8 14 V50 Q8 56 14 56 H84 L114 32 L84 8 Z',
  drain: 'M6 32 L34 8 H104 Q112 8 112 15 V49 Q112 56 104 56 H34 Z',
  gate: 'M60 3 L117 32 L60 61 L3 32 Z',
  converter:
    'M14 8 H106 Q112 8 112 14 L82 32 L112 50 Q112 56 106 56 H14 Q8 56 8 50 L38 32 L8 14 Q8 8 14 8 Z',
  end: 'M28 8 H92 Q112 8 112 32 Q112 56 92 56 H28 Q8 56 8 32 Q8 8 28 8 Z',
  // loop-model/1 — docs/visual-language.md §VL2.1. `parameter`: a rounded tag
  // with a notched left edge + a short stub. `register`: a plain lozenge (its
  // leading `=` glyph is drawn separately in the node body, not the outline).
  parameter: 'M40 12 H100 Q108 12 108 20 V44 Q108 52 100 52 H40 L28 40 H18 V24 H28 L40 12 Z',
  register: 'M30 12 H98 Q116 12 116 32 Q116 52 98 52 H30 Q14 52 14 32 Q14 12 30 12 Z',
}

// docs/visual-language.md §VL7.2 — three detail levels at fixed world-zoom
// thresholds. Elision only fades supplementary TEXT; the silhouette, rings,
// invalid flag, run cues, footprint and hit target are identical at every
// level (§VL7.1 / §VL12.5).
const LOD_L2_MIN = 0.8 // ≥ 0.8  → L2 detail (title + value + sub + chip)
const LOD_L1_MIN = 0.45 // ≥ 0.45 → L1 compact (title + value); < 0.45 → L0 map
type Lod = 'L2' | 'L1' | 'L0'
const lodFor = (z: number): Lod => (z >= LOD_L2_MIN ? 'L2' : z >= LOD_L1_MIN ? 'L1' : 'L0')

function useLod(): Lod {
  return useStore((s) => lodFor(s.transform[2]))
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

function useFiring(id: string): boolean {
  return useSimStore((s) => s.firedNodeIds.includes(id))
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
  sub?: string
  selected?: boolean
  firing?: boolean
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
  sub,
  selected,
  firing,
  arriving,
  invalid,
  stepKey,
}: FrameProps) {
  const lod = useLod()
  const mapOnly = lod === 'L0' // no text at all — silhouette + type dot
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

  const path = SILHOUETTE[kind]
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

      <svg className="nodef__shape" viewBox="0 0 120 64" preserveAspectRatio="none" aria-hidden="true">
        <path className="nodef__fill" d={path} />
        <path className="nodef__stroke" d={path} />
        {kind === 'end' ? (
          <line className="nodef__endbar" x1="95" y1="15" x2="95" y2="49" />
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
          <circle key={`a${stepKey}`} className="nodef__arrival" cx="60" cy="32" r="15" />
        ) : null}
        {/* L0 map: type colour collapses to one dot inside the silhouette */}
        {mapOnly ? <circle className="nodef__cdot" cx="60" cy="32" r="9" /> : null}
      </svg>

      {/* §VL4 — one persistent flag, top-right, non-colour tell for `invalid` */}
      {invalid ? (
        <span className="nodef__flag" aria-hidden="true" title="This node is invalid">
          !
        </span>
      ) : null}

      {/* The body is ALWAYS in the DOM so the node's footprint / hit target is
          byte-identical across L2 / L1 / L0 (§VL7.1). The `lod-*` class fades
          the elided text: L1 hides `sub`, L0 hides the whole body — the
          silhouette + `cdot` carry the map view. */}
      <div className="nodef__body">
        <span className="nodef__head">
          <span className="nodef__chip" />
          <span className="nodef__title">{title}</span>
        </span>
        {value != null ? (
          <span className={`nodef__value${valueDir ? ` nodef__value--${valueDir}` : ''}`}>
            {value}
          </span>
        ) : null}
        {sub ? <span className="nodef__sub">{sub}</span> : null}
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
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <NodeFrame
      nodeId={id}
      kind={kind}
      title={`unreadable ${kind}`}
      sub="data cannot be read — fix it in the file"
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
