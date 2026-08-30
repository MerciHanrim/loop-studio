import { useState, type ReactNode } from 'react'
import {
  ACT_HINT,
  LABEL_HINT,
  parseActivatorExpr,
  parseDelay,
  parseLabelExpr,
  type ActivatorParse,
  type LabelParse,
} from '../engine'
import { parseExpr } from '../model/expr'
import {
  BUILTIN_RESOURCE_TYPES,
  isBuiltinResourceType,
  normalizeResourceType,
  RESOURCE_TYPE_MAX_BYTES,
  type ResourceMismatchFinding,
  readParameterData,
  readRegisterData,
  resourceTypeMismatches,
} from '../model/model'
import { useGraphStore } from '../store/graphStore'
import type {
  ConverterData,
  DrainData,
  GateData,
  LoopEdgeData,
  ParameterData,
  PoolData,
  RegisterData,
  SourceData,
  StateEdgeData,
  StateMode,
} from '../model/types'

const ACTIVATIONS = ['passive', 'automatic', 'onStart', 'interactive'] as const
/** modes the engine executes; `node` (and anything unknown) is inert legacy data */
const KNOWN_STATE_MODES: readonly StateMode[] = ['trigger', 'activator', 'label']

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

  // loop-model/1 §M4.3 — advisory mismatch findings for the whole graph, then
  // filtered to whatever is selected. Deterministic, computation-neutral.
  const mismatches = resourceTypeMismatches({
    resourceEdges: edges
      .filter((e) => (e.data as { kind?: string } | undefined)?.kind !== 'state')
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        resourceType: (e.data as { resourceType?: unknown } | undefined)?.resourceType,
      })),
    nodeKind: (id) => (nodes.find((n) => n.id === id)?.data as { kind?: string } | undefined)?.kind,
    nodeResourceType: (id) =>
      (nodes.find((n) => n.id === id)?.data as { resourceType?: unknown } | undefined)?.resourceType,
  })

  if (node) {
    const d = node.data
    const set: Patch = (patch) => updateNodeData(node.id, patch)

    // A node whose `data` can't be read at all (non-object, unknown kind), or a
    // `parameter` / `register` that fails the §R2-1.1 structural gate. Show a
    // fallback that never touches the unreadable fields (no `0`, no `"0"`).
    const kindStr = d && typeof d === 'object' ? (d as { kind?: unknown }).kind : undefined
    const modelRead =
      kindStr === 'parameter'
        ? readParameterData(d)
        : kindStr === 'register'
          ? readRegisterData(d)
          : null
    const unreadable =
      !d || typeof d !== 'object' || typeof kindStr !== 'string' || (modelRead != null && !modelRead.ok)
    if (unreadable) {
      const kindLabel = typeof kindStr === 'string' ? kindStr : 'node'
      const detail = modelRead && !modelRead.ok ? modelRead.detail : 'the data is not a readable object'
      return (
        <aside className="inspector">
          <div className="inspector__head">
            <span className="inspector__kind inspector__kind--edge">{kindLabel}</span>
            <button type="button" className="btn btn--ghost" onClick={() => removeNode(node.id)}>
              Delete
            </button>
          </div>
          <p className="inspector__note inspector__note--warn">
            This node's data can't be read ({detail}). It is loaded as-is and left out of the model —
            fix it in the file, or delete the node.
          </p>
          <Field label="Raw data">
            <textarea readOnly rows={5} value={JSON.stringify(node.data, null, 2)} />
          </Field>
        </aside>
      )
    }

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

        {d.kind === 'end' && (
          <p className="inspector__note">Stops the run the moment a resource reaches it.</p>
        )}

        {'activation' in d && d.kind !== 'end' && (
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

        {d.kind === 'pool' && (
          <PoolFields d={d} set={set} findings={mismatches.filter((f) => f.nodeId === node.id)} />
        )}
        {d.kind === 'source' && <SourceFields d={d} set={set} />}
        {d.kind === 'drain' && <DrainFields d={d} set={set} />}
        {d.kind === 'gate' && <GateFields d={d} set={set} />}
        {d.kind === 'converter' && <ConverterFields d={d} set={set} />}
        {d.kind === 'parameter' && <ParameterFields d={d} set={set} />}
        {d.kind === 'register' && <RegisterFields d={d} set={set} />}
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
          <>
            <Field label="Flow">
              <input
                value={ed.flow}
                onChange={(e) => setData({ ...ed, kind: 'resource', flow: e.target.value })}
                placeholder="1, all, 2D6, 1-3, 25%"
              />
            </Field>
            <ResourceTypeField
              value={ed.resourceType}
              onChange={(v) => setData({ ...ed, kind: 'resource', resourceType: v })}
              findings={mismatches.filter((f) => f.edgeId === edge.id)}
            />
          </>
        ) : (
          <StateEdgeFields ed={ed} setData={setData} />
        )}

        <p className="inspector__note">
          Editing a connection restarts the run at step 0 and clears any pending triggers; a
          finished Monte-Carlo result is marked stale.
        </p>
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

// ── state-edge editing ────────────────────────────────────────────────────

function StateEdgeFields({
  ed,
  setData,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
}) {
  if (!KNOWN_STATE_MODES.includes(ed.mode)) return <LegacyStateEdge ed={ed} setData={setData} />
  return (
    <>
      <Field label="Mode">
        <select
          value={ed.mode}
          onChange={(e) => setData({ ...ed, mode: e.target.value as StateMode })}
        >
          <option value="trigger">trigger — pulse the target to fire</option>
          <option value="activator">activator — enable / disable the target</option>
          <option value="label">label — add to / set the target Pool</option>
        </select>
      </Field>

      {ed.mode === 'trigger' && <TriggerFields ed={ed} setData={setData} />}
      {ed.mode === 'activator' && <ExprField ed={ed} setData={setData} kind="activator" />}
      {ed.mode === 'label' && <ExprField ed={ed} setData={setData} kind="label" />}
    </>
  )
}

function TriggerFields({
  ed,
  setData,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
}) {
  const raw = ed.delay
  const ok = raw == null || parseDelay(raw).ok
  return (
    <Field label="Delay — steps before the pulse is delivered">
      <input
        type="number"
        min={0}
        step={1}
        value={raw ?? ''}
        aria-invalid={!ok}
        onChange={(e) => {
          const v = e.target.value
          setData({ ...ed, delay: v === '' ? undefined : Number(v) })
        }}
      />
      {ok ? (
        <p className="field__hint">
          delivered at <code>fired + delay + 1</code>; <code>0</code> means the next step.
        </p>
      ) : (
        <p className="field__hint field__hint--bad">
          use a whole number ≥ 0 — the engine runs any other value as <code>0</code> and leaves
          what you typed untouched.
        </p>
      )}
    </Field>
  )
}

function describeActivator(p: Extract<ActivatorParse, { ok: true }>): string {
  return `target is enabled while the source ${p.op} ${p.n}`
}
function describeLabel(p: Extract<LabelParse, { ok: true }>): string {
  const amount = p.token === 'S' ? "the source Pool's value" : String(p.n)
  if (p.op === '=') return `sets the target Pool to ${amount} each step`
  return p.op === '+'
    ? `adds ${amount} to the target Pool each step`
    : `subtracts ${amount} from the target Pool each step`
}

function ExprField({
  ed,
  setData,
  kind,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
  kind: 'activator' | 'label'
}) {
  const raw = ed.expr ?? ''
  const res =
    kind === 'activator'
      ? ({ t: 'activator', p: parseActivatorExpr(raw) } as const)
      : ({ t: 'label', p: parseLabelExpr(raw) } as const)

  let hint: string
  if (res.t === 'activator') {
    hint = res.p.ok ? describeActivator(res.p) : `${ACT_HINT[res.p.reason]} — until it parses, this connection has no effect.`
  } else {
    hint = res.p.ok ? describeLabel(res.p) : `${LABEL_HINT[res.p.reason]} — until it parses, this connection has no effect.`
  }

  return (
    <Field label={kind === 'activator' ? 'Condition — comparison against the source' : 'Modifier — change applied each step'}>
      <input
        value={raw}
        placeholder={kind === 'activator' ? '>= 5' : '+1   ·   -2   ·   =S'}
        aria-invalid={!res.p.ok}
        onChange={(e) => setData({ ...ed, expr: e.target.value })}
      />
      <p className={`field__hint ${res.p.ok ? 'field__hint--ok' : 'field__hint--bad'}`}>{hint}</p>
    </Field>
  )
}

function LegacyStateEdge({
  ed,
  setData,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
}) {
  const [to, setTo] = useState<StateMode>('trigger')
  return (
    <div className="inspector__legacy">
      <p className="inspector__note">
        <strong>Unsupported connection.</strong> Mode <code>{ed.mode}</code> is not executed —
        this link has no effect on the simulation. Loop Studio never converts it automatically;
        pick what it should become, then convert it explicitly.
      </p>
      <Field label="Convert to">
        <select value={to} onChange={(e) => setTo(e.target.value as StateMode)}>
          <option value="trigger">trigger</option>
          <option value="activator">activator</option>
          <option value="label">label</option>
        </select>
      </Field>
      <button
        type="button"
        className="btn"
        onClick={() =>
          setData({
            kind: 'state',
            mode: to,
            expr: ed.expr ?? '',
            ...(ed.delay != null ? { delay: ed.delay } : {}),
          })
        }
      >
        Convert to {to}
      </button>
    </div>
  )
}

// ── node field groups (unchanged) ────────────────────────────────────────

// ── loop-model/1 §M4 — advisory resource-type tag ────────────────────────

function ResourceTypeField({
  value,
  onChange,
  findings,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
  findings: ResourceMismatchFinding[]
}) {
  const norm = normalizeResourceType(value)
  const raw = value ?? ''
  return (
    <>
      <Field label="Resource type (advisory)">
        <input
          value={raw}
          list="resource-type-builtins"
          placeholder="Gold, Energy, XP, Player, Item, or a custom name"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </Field>
      <datalist id="resource-type-builtins">
        {BUILTIN_RESOURCE_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {norm.value === null && raw.trim() !== '' && (
        <p className="inspector__note inspector__note--warn">
          Over {RESOURCE_TYPE_MAX_BYTES} bytes — this tag will be dropped on export.
        </p>
      )}
      {norm.value !== null && norm.value !== raw && (
        <p className="inspector__note">Normalised to “{norm.value}”.</p>
      )}
      {norm.value !== null && !isBuiltinResourceType(norm.value) && (
        <p className="inspector__note">Custom type — generic swatch; no built-in colour.</p>
      )}
      {findings.length > 0 && (
        <p className="inspector__note inspector__note--warn">
          Type mismatch: {findings.map((f) => `${f.edgeType} ↔ ${f.nodeType}`).join(', ')}. Advisory
          only — it changes no amount and blocks no run.
        </p>
      )}
    </>
  )
}

function PoolFields({
  d,
  set,
  findings,
}: {
  d: PoolData
  set: Patch
  findings: ResourceMismatchFinding[]
}) {
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
      <ResourceTypeField
        value={d.resourceType}
        onChange={(v) => set({ resourceType: v })}
        findings={findings}
      />
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

// ── loop-model/1 (SEMANTICS-M.md) ────────────────────────────────────────

const numOrUndef = (s: string): number | undefined => (s === '' ? undefined : Number(s))

function ParameterFields({ d, set }: { d: ParameterData; set: Patch }) {
  // advisory notices from the defensive read (§M1.2) — value-out-of-range etc.
  const read = readParameterData(d)
  const notices = read.ok ? read.notices : []
  return (
    <>
      <Field label="Value">
        <input type="number" value={d.value} onChange={(e) => set({ value: Number(e.target.value) })} />
      </Field>
      <Field label="Unit (advisory)">
        <input value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} />
      </Field>
      <Field label="Min (advisory)">
        <input type="number" value={d.min ?? ''} onChange={(e) => set({ min: numOrUndef(e.target.value) })} />
      </Field>
      <Field label="Max (advisory)">
        <input type="number" value={d.max ?? ''} onChange={(e) => set({ max: numOrUndef(e.target.value) })} />
      </Field>
      <Field label="Step (advisory)">
        <input type="number" value={d.step ?? ''} onChange={(e) => set({ step: numOrUndef(e.target.value) })} />
      </Field>
      {notices.includes('PARAM_VALUE_OUT_OF_RANGE') && (
        <p className="inspector__note">The value is outside the advisory min/max — kept as-is, not clamped.</p>
      )}
      {(notices.includes('PARAM_RANGE_INVALID') || notices.includes('PARAM_STEP_INVALID')) && (
        <p className="inspector__note">An advisory hint is incoherent and will be dropped on export.</p>
      )}
      <p className="inspector__note">A Parameter has no ports — reference it by id from an expression.</p>
    </>
  )
}

function RegisterFields({ d, set }: { d: RegisterData; set: Patch }) {
  const parsed = parseExpr(d.expr)
  const read = readRegisterData(d)
  const notices = read.ok ? read.notices : []
  return (
    <>
      <Field label="Expression">
        <input
          value={d.expr}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono, monospace)' }}
          onChange={(e) => set({ expr: e.target.value })}
        />
      </Field>
      {!parsed.ok ? (
        <p className="inspector__note inspector__note--warn">
          {parsed.error.code} · {parsed.error.message}
        </p>
      ) : (
        parsed.expr.canonical !== d.expr && (
          <p className="inspector__note">Canonical form: <code>{parsed.expr.canonical}</code> (saved on export)</p>
        )
      )}
      <Field label="Unit (advisory)">
        <input value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} />
      </Field>
      <Field label="Format (advisory)">
        <select value={d.format ?? 'float'} onChange={(e) => set({ format: e.target.value })}>
          <option value="int">int</option>
          <option value="float">float</option>
          <option value="percent">percent</option>
        </select>
      </Field>
      {notices.includes('REG_FORMAT_INVALID') && (
        <p className="inspector__note">Unrecognised format — will fall back to float on export.</p>
      )}
      <p className="inspector__note">
        A Register stores nothing and has no ports. The expression above is a <strong>parse
        preview only</strong> — the computed value appears once the run observes it (a later
        slice); no value is shown until then.
      </p>
    </>
  )
}
