import type { ReactNode } from 'react'
import { useGraphStore } from '../store/graphStore'
import type {
  ConverterData,
  DrainData,
  GateData,
  LoopEdgeData,
  PoolData,
  SourceData,
  StateMode,
} from '../model/types'

const ACTIVATIONS = ['passive', 'automatic', 'onStart', 'interactive'] as const

type Patch = (patch: Record<string, unknown>) => void

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  )
}

export function Inspector() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const setEdgeData = useGraphStore((s) => s.setEdgeData)
  const removeNode = useGraphStore((s) => s.removeNode)
  const removeEdge = useGraphStore((s) => s.removeEdge)

  const node = nodes.find((n) => n.id === selectedNodeId) ?? null
  const edge = edges.find((e) => e.id === selectedEdgeId) ?? null

  if (node) {
    const d = node.data
    const set: Patch = (patch) => updateNodeData(node.id, patch)
    return (
      <aside className="inspector">
        <div className="inspector__head">
          <span className={`inspector__kind inspector__kind--${d.kind}`}>{d.kind}</span>
          <button type="button" className="btn btn--ghost" onClick={() => removeNode(node.id)}>
            Delete
          </button>
        </div>

        <Field label="Label">
          <input value={d.label} onChange={(e) => set({ label: e.target.value })} />
        </Field>

        {d.kind !== 'end' && (
          <Field label="Activation">
            <select value={d.activation} onChange={(e) => set({ activation: e.target.value })}>
              {ACTIVATIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
        )}

        {d.kind === 'pool' && <PoolFields d={d} set={set} />}
        {d.kind === 'source' && <SourceFields d={d} set={set} />}
        {d.kind === 'drain' && <DrainFields d={d} set={set} />}
        {d.kind === 'gate' && <GateFields d={d} set={set} />}
        {d.kind === 'converter' && <ConverterFields d={d} set={set} />}
      </aside>
    )
  }

  if (edge) {
    const ed = (edge.data as LoopEdgeData | undefined) ?? { kind: 'resource', flow: '1' }
    const setData = (data: LoopEdgeData) => setEdgeData(edge.id, data)
    return (
      <aside className="inspector">
        <div className="inspector__head">
          <span className="inspector__kind inspector__kind--edge">{ed.kind} link</span>
          <button type="button" className="btn btn--ghost" onClick={() => removeEdge(edge.id)}>
            Delete
          </button>
        </div>

        <Field label="Type">
          <select
            value={ed.kind}
            onChange={(e) =>
              setData(
                e.target.value === 'state'
                  ? { kind: 'state', mode: 'trigger', expr: '' }
                  : { kind: 'resource', flow: '1' },
              )
            }
          >
            <option value="resource">resource — carries resources</option>
            <option value="state">state — reads a value, modifies target</option>
          </select>
        </Field>

        {ed.kind === 'resource' ? (
          <Field label="Flow">
            <input
              value={ed.flow}
              onChange={(e) => setData({ kind: 'resource', flow: e.target.value })}
              placeholder="1, all, 2D6, 1-3, 25%"
            />
          </Field>
        ) : (
          <>
            <Field label="Mode">
              <select
                value={ed.mode}
                onChange={(e) => setData({ ...ed, mode: e.target.value as StateMode })}
              >
                <option value="label">label modifier (±)</option>
                <option value="node">node modifier</option>
                <option value="trigger">trigger (✳)</option>
                <option value="activator">activator (≥)</option>
              </select>
            </Field>
            {ed.mode !== 'trigger' && (
              <Field label="Expression">
                <input
                  value={ed.expr}
                  onChange={(e) => setData({ ...ed, expr: e.target.value })}
                  placeholder={ed.mode === 'activator' ? '>=5' : '+1'}
                />
              </Field>
            )}
          </>
        )}
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector__empty">
        <p>Select a node or connection to edit it.</p>
        <p className="inspector__hint">
          Drag a piece from the top bar onto the canvas, then drag between the dots on
          each side to wire them together.
        </p>
      </div>
    </aside>
  )
}

function PoolFields({ d, set }: { d: PoolData; set: Patch }) {
  return (
    <>
      <Field label="Starting amount">
        <input
          type="number"
          value={d.initial}
          onChange={(e) => set({ initial: Number(e.target.value) })}
        />
      </Field>
      <Field label="Capacity (blank = unlimited)">
        <input
          type="number"
          value={d.capacity ?? ''}
          onChange={(e) =>
            set({ capacity: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </Field>
      <Field label="Flow mode">
        <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="pullAny">pull any</option>
          <option value="pullAll">pull all</option>
          <option value="pushAny">push any</option>
          <option value="pushAll">push all</option>
        </select>
      </Field>
    </>
  )
}

function SourceFields({ d, set }: { d: SourceData; set: Patch }) {
  return (
    <Field label="Flow mode">
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pushAny">push any</option>
        <option value="pushAll">push all</option>
      </select>
    </Field>
  )
}

function DrainFields({ d, set }: { d: DrainData; set: Patch }) {
  return (
    <Field label="Flow mode">
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pullAny">pull any</option>
        <option value="pullAll">pull all</option>
      </select>
    </Field>
  )
}

function GateFields({ d, set }: { d: GateData; set: Patch }) {
  return (
    <Field label="Distribution">
      <select value={d.distribution} onChange={(e) => set({ distribution: e.target.value })}>
        <option value="deterministic">deterministic</option>
        <option value="probabilistic">probabilistic</option>
      </select>
    </Field>
  )
}

function ConverterFields({ d, set }: { d: ConverterData; set: Patch }) {
  return (
    <Field label="Flow mode">
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pullAny">pull any</option>
        <option value="pullAll">pull all</option>
      </select>
    </Field>
  )
}
