import { useEffect, useRef, useState } from 'react'
import { Handle, Position, useStore, type NodeProps, type NodeTypes } from '@xyflow/react'
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
}

const COMPACT_ZOOM = 0.6

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
  kind: NodeKind
  title: string
  value?: string
  valueDir?: 'up' | 'down' | null
  sub?: string
  selected?: boolean
  firing?: boolean
  arriving?: boolean
  stepKey: number
}

function NodeFrame({
  kind,
  title,
  value,
  valueDir,
  sub,
  selected,
  firing,
  arriving,
  stepKey,
}: FrameProps) {
  const compact = useStore((s) => s.transform[2] < COMPACT_ZOOM)
  const path = SILHOUETTE[kind]
  return (
    <div className={`nodef nodef--${kind}${selected ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`}>
      {/* state ports (diamonds) — top in, bottom out */}
      <Handle type="target" position={Position.Top} id="state-target" className="h h--state" />
      <Handle type="source" position={Position.Bottom} id="state-source" className="h h--state" />

      <svg className="nodef__shape" viewBox="0 0 120 64" preserveAspectRatio="none" aria-hidden="true">
        <path className="nodef__fill" d={path} />
        <path className="nodef__stroke" d={path} />
        {kind === 'end' ? (
          <line className="nodef__endbar" x1="95" y1="15" x2="95" y2="49" />
        ) : null}
        {selected ? <path className="nodef__sel" d={path} /> : null}
        {firing ? <path key={`w${stepKey}`} className="nodef__wave" d={path} /> : null}
        {arriving ? (
          <circle key={`a${stepKey}`} className="nodef__arrival" cx="60" cy="32" r="15" />
        ) : null}
        {/* low zoom: type colour collapses to one dot inside the silhouette */}
        {compact ? <circle className="nodef__cdot" cx="60" cy="32" r="9" /> : null}
      </svg>

      {!compact ? (
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
      ) : null}
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
      <Handle type="target" position={Position.Left} className="h h--in" />
      <NodeFrame
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
      <Handle type="source" position={Position.Right} className="h h--out" />
    </>
  )
}

function SourceNode({ id, data, selected }: NodeProps) {
  const d = data as SourceData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        kind="source"
        title={d.label}
        sub={`${d.activation} · ${d.mode}`}
        selected={selected}
        firing={useFiring(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} className="h h--out" />
    </>
  )
}

function DrainNode({ id, data, selected }: NodeProps) {
  const d = data as DrainData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} className="h h--in" />
      <NodeFrame
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
      <Handle type="target" position={Position.Left} className="h h--in" />
      <NodeFrame
        kind="gate"
        title={d.label}
        sub={d.distribution}
        selected={selected}
        firing={useFiring(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} className="h h--out" />
    </>
  )
}

function ConverterNode({ id, data, selected }: NodeProps) {
  const d = data as ConverterData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} className="h h--in" />
      <NodeFrame
        kind="converter"
        title={d.label}
        sub={d.mode}
        selected={selected}
        firing={useFiring(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} className="h h--out" />
    </>
  )
}

function EndNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string }
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} className="h h--in" />
      <NodeFrame
        kind="end"
        title={d.label}
        sub="stops the run"
        selected={selected}
        firing={useFiring(id)}
        stepKey={stepKey}
      />
    </>
  )
}

export const nodeTypes: NodeTypes = {
  pool: PoolNode,
  source: SourceNode,
  drain: DrainNode,
  gate: GateNode,
  converter: ConverterNode,
  end: EndNode,
}
