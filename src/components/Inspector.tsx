import { useState, type ReactNode } from 'react'
import {
  parseActivatorExpr,
  parseDelay,
  parseFlow,
  parseLabelExpr,
  type ActivatorParse,
  type LabelParse,
} from '../engine'
import { parseExpr } from '../model/expr'
import {
  BUILTIN_RESOURCE_TYPES,
  formatRegisterValue,
  isBuiltinResourceType,
  normalizeResourceType,
  RESOURCE_TYPE_MAX_BYTES,
  type ResourceMismatchFinding,
  readParameterData,
  readRegisterData,
  resourceTypeMismatches,
} from '../model/model'
import { useGraphStore } from '../store/graphStore'
import { useRegisterOutcome } from '../store/registers'
import { useSimStore } from '../store/simStore'
import { useT, type MessageKey } from '../i18n'
import type { ExprParseCode } from '../model/expr'
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

// docs/localization.md §L7 — a stable diagnostic CODE (shown verbatim by the
// caller) → the user-facing message key. An unknown code falls back to the
// generic `error.unknownCode`; a code that needs per-cause wording gets a new
// key here, never a mutated code string. Every value is a literal so the
// call-site scan in check-i18n.mjs sees the key as referenced.
const REG_CODE_KEY: Record<string, MessageKey> = {
  M_REG_PARSE: 'error.M_REG_PARSE.message',
  M_REG_EVAL: 'error.M_REG_EVAL.message',
  M_REG_UNKNOWN_REF: 'error.M_REG_UNKNOWN_REF.message',
  M_REG_WRONG_KIND: 'error.M_REG_WRONG_KIND.message',
  M_REG_INVALID_ID: 'error.M_REG_INVALID_ID.message',
  M_REG_CYCLE: 'error.M_REG_CYCLE.message',
  M_REG_DEPENDS_ON_INVALID: 'error.M_REG_DEPENDS_ON_INVALID.message',
}
const EXPR_CODE_KEY: Record<ExprParseCode, MessageKey> = {
  EXPR_EMPTY: 'error.EXPR_EMPTY.message',
  EXPR_SYNTAX: 'error.EXPR_SYNTAX.message',
  EXPR_UNCLOSED_PAREN: 'error.EXPR_UNCLOSED_PAREN.message',
  EXPR_UNCLOSED_REF: 'error.EXPR_UNCLOSED_REF.message',
  EXPR_BAD_ESCAPE: 'error.EXPR_BAD_ESCAPE.message',
  EXPR_NUMBER_RANGE: 'error.EXPR_NUMBER_RANGE.message',
  EXPR_BAD_TOKEN: 'error.EXPR_BAD_TOKEN.message',
}
// docs/localization.md §L3.4 (refined) — a wire enum's OPTION LABEL is localized
// UI text; the `<option value>` stays the token, so GraphDoc / digest are
// unchanged and a locale switch fires no `change`. Raw-data fallback + the
// `{code}` diagnostics keep the bare token.
const ACTIVATION_KEY = {
  passive: 'enum.activation.passive',
  automatic: 'enum.activation.automatic',
  onStart: 'enum.activation.onStart',
  interactive: 'enum.activation.interactive',
} satisfies Record<string, MessageKey>

const ACT_HINT_KEY = {
  empty: 'stateExpr.activator.hint.empty',
  'op-only': 'stateExpr.activator.hint.opOnly',
  'not-a-comparison': 'stateExpr.activator.hint.notAComparison',
  'non-finite': 'stateExpr.activator.hint.nonFinite',
} satisfies Record<string, MessageKey>
const LABEL_HINT_KEY = {
  empty: 'stateExpr.label.hint.empty',
  'not-an-assignment': 'stateExpr.label.hint.notAnAssignment',
  'non-finite': 'stateExpr.label.hint.nonFinite',
} satisfies Record<string, MessageKey>

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
  const t = useT()
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
      // `modelRead.detail` is a structural-read phrase from the dependency-free
      // model layer — passed through as a substitution atom (§L7).
      const detail =
        modelRead && !modelRead.ok ? modelRead.detail : t('inspector.unreadable.detailFallback')
      return (
        <aside className="inspector">
          <div className="inspector__head">
            <span className="inspector__kind inspector__kind--edge">{kindLabel}</span>
            <button type="button" className="btn btn--ghost" onClick={() => removeNode(node.id)}>
              {t('inspector.delete')}
            </button>
          </div>
          <p className="inspector__note inspector__note--warn">
            {t('inspector.unreadable.note', { detail })}
          </p>
          <Field label={t('inspector.field.rawData')}>
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
            {t('inspector.delete')}
          </button>
        </div>

        <Field label={t('inspector.field.label')}>
          <input value={d.label} onChange={(e) => set({ label: e.target.value })} />
        </Field>

        {d.kind === 'end' && <p className="inspector__note">{t('inspector.node.endNote')}</p>}

        {'activation' in d && d.kind !== 'end' && (
          <Field label={t('inspector.field.activation')}>
            <select value={d.activation} onChange={(e) => set({ activation: e.target.value })}>
              {ACTIVATIONS.map((a) => (
                <option key={a} value={a}>
                  {t(ACTIVATION_KEY[a])}
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
        {d.kind === 'register' && <RegisterFields id={node.id} d={d} set={set} />}
      </aside>
    )
  }

  if (edge) {
    const ed = (edge.data as LoopEdgeData | undefined) ?? { kind: 'resource', flow: '1' }
    const setData = (data: LoopEdgeData) => setEdgeData(edge.id, data)
    return (
      <aside className="inspector">
        <div className="inspector__head">
          <span className="inspector__kind inspector__kind--edge">
            {t('inspector.edge.kindLink', { kind: ed.kind })}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => removeEdge(edge.id)}>
            {t('inspector.delete')}
          </button>
        </div>

        <Field label={t('inspector.field.type')}>
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
            <option value="resource">{t('inspector.edge.type.resource')}</option>
            <option value="state">{t('inspector.edge.type.state')}</option>
          </select>
        </Field>

        {ed.kind === 'resource' ? (
          <>
            <EdgeFlowField
              flow={ed.flow}
              params={nodes
                .filter((n) => (n.data as { kind?: string }).kind === 'parameter')
                .map((n) => ({ id: n.id, label: (n.data as { label?: string }).label || n.id }))}
              onChange={(flow) => setData({ ...ed, kind: 'resource', flow })}
            />
            <ResourceTypeField
              value={ed.resourceType}
              onChange={(v) => setData({ ...ed, kind: 'resource', resourceType: v })}
              findings={mismatches.filter((f) => f.edgeId === edge.id)}
            />
          </>
        ) : (
          <StateEdgeFields ed={ed} setData={setData} />
        )}

        <RouteField
          value={ed.route === 'orthogonal' ? 'orthogonal' : 'bezier'}
          onChange={(mode) => {
            if (mode === 'orthogonal') setData({ ...ed, route: 'orthogonal' })
            else {
              // loop-revision/3 §R3-1 / ER-D16 — back to default drops BOTH keys
              const { route: _r, waypoints: _w, ...rest } = ed
              setData(rest as LoopEdgeData)
            }
          }}
        />

        <p className="inspector__note">{t('inspector.edge.note')}</p>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector__empty">
        <p>{t('inspector.empty.title')}</p>
        <p className="inspector__hint">{t('inspector.empty.hint')}</p>
      </div>
    </aside>
  )
}

// ── resource-edge flow, incl. a loop-model/2 parameter reference ─────────
// docs/parameter-inputs.md §PI9.1 — the `flow` field accepts a literal or a
// single `@id` parameter reference. A picker writes `@id`; raw entry is also
// allowed. Committing any leading-`@` value promotes a v1 document to v2 (the
// graphStore latch); a dangling / wrong-kind / malformed reference is flagged
// here without blocking save, and the connection contributes 0 at run time.
function EdgeFlowField({
  flow,
  params,
  onChange,
}: {
  flow: string
  params: { id: string; label: string }[]
  onChange: (flow: string) => void
}) {
  const t = useT()
  const trimmed = flow.trim()
  const isRef = trimmed.startsWith('@')
  const fx = isRef ? parseFlow(flow, 2) : null
  const refId = fx?.kind === 'param' ? fx.id : null
  const target = refId != null ? params.find((p) => p.id === refId) : undefined

  let status: { text: string; warn: boolean } | null = null
  if (fx?.kind === 'paramBad') {
    status = { text: t('inspector.edge.flowParam.malformed'), warn: true }
  } else if (refId != null) {
    const node = useGraphStore.getState().nodes.find((n) => n.id === refId)
    if (!node) status = { text: t('inspector.edge.flowParam.unknown', { id: refId }), warn: true }
    else if ((node.data as { kind?: string }).kind !== 'parameter')
      status = { text: t('inspector.edge.flowParam.notParam', { id: refId }), warn: true }
    else {
      const v = (node.data as { value?: unknown }).value
      status = {
        text: `${t('inspector.edge.flowParam.resolved', {
          value: typeof v === 'number' && Number.isFinite(v) ? String(v >= 0 ? v : 1) : '0',
        })}${target ? `  (${target.label})` : ''}`,
        warn: !(typeof v === 'number' && Number.isFinite(v)),
      }
    }
  }

  return (
    <Field label={t('inspector.field.flow')}>
      {params.length > 0 && (
        <select
          aria-label={t('inspector.edge.flowParam.pickLabel')}
          value={refId ?? ''}
          onChange={(e) => {
            const id = e.target.value
            if (id === '') {
              if (isRef) onChange('1')
            } else onChange(`@${id}`)
          }}
        >
          <option value="">{t('inspector.edge.flowParam.literalOption')}</option>
          {params.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <input
        value={flow}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('inspector.edge.flowPlaceholder')}
      />
      {status && (
        <span
          className={
            status.warn ? 'inspector__note inspector__note--warn' : 'inspector__note'
          }
        >
          {status.text}
        </span>
      )}
      {isRef && <span className="inspector__note">{t('inspector.edge.flowParam.hint')}</span>}
    </Field>
  )
}

// ── edge routing (loop-revision/3 / docs/edge-routing.md) ─────────────────
function RouteField({
  value,
  onChange,
}: {
  value: 'bezier' | 'orthogonal'
  onChange: (mode: 'bezier' | 'orthogonal') => void
}) {
  const t = useT()
  return (
    <Field label={t('inspector.field.route')}>
      <select value={value} onChange={(e) => onChange(e.target.value as 'bezier' | 'orthogonal')}>
        <option value="bezier">{t('inspector.edge.route.curved')}</option>
        <option value="orthogonal">{t('inspector.edge.route.orthogonal')}</option>
      </select>
    </Field>
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
  const t = useT()
  if (!KNOWN_STATE_MODES.includes(ed.mode)) return <LegacyStateEdge ed={ed} setData={setData} />
  return (
    <>
      <Field label={t('inspector.field.mode')}>
        <select
          value={ed.mode}
          onChange={(e) => setData({ ...ed, mode: e.target.value as StateMode })}
        >
          <option value="trigger">{t('inspector.edge.mode.trigger')}</option>
          <option value="activator">{t('inspector.edge.mode.activator')}</option>
          <option value="label">{t('inspector.edge.mode.label')}</option>
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
  const t = useT()
  const raw = ed.delay
  const ok = raw == null || parseDelay(raw).ok
  return (
    <Field label={t('inspector.field.delay')}>
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
        <p className="field__hint">{t('inspector.delay.ok')}</p>
      ) : (
        <p className="field__hint field__hint--bad">{t('inspector.delay.bad')}</p>
      )}
    </Field>
  )
}

type TFn = ReturnType<typeof useT>

function describeActivator(t: TFn, p: Extract<ActivatorParse, { ok: true }>): string {
  return t('inspector.activator.describe', { op: p.op, n: p.n })
}
function describeLabel(t: TFn, p: Extract<LabelParse, { ok: true }>): string {
  const amount = p.token === 'S' ? t('inspector.label.amountSource') : String(p.n)
  if (p.op === '=') return t('inspector.label.describe.set', { amount })
  return p.op === '+'
    ? t('inspector.label.describe.add', { amount })
    : t('inspector.label.describe.subtract', { amount })
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
  const t = useT()
  const raw = ed.expr ?? ''
  const res =
    kind === 'activator'
      ? ({ t: 'activator', p: parseActivatorExpr(raw) } as const)
      : ({ t: 'label', p: parseLabelExpr(raw) } as const)

  let hint: string
  if (res.t === 'activator') {
    hint = res.p.ok
      ? describeActivator(t, res.p)
      : t('inspector.stateExpr.noEffect', { hint: t(ACT_HINT_KEY[res.p.reason]) })
  } else {
    hint = res.p.ok
      ? describeLabel(t, res.p)
      : t('inspector.stateExpr.noEffect', { hint: t(LABEL_HINT_KEY[res.p.reason]) })
  }

  return (
    <Field
      label={
        kind === 'activator' ? t('inspector.field.condition') : t('inspector.field.modifier')
      }
    >
      <input
        value={raw}
        placeholder={
          kind === 'activator'
            ? t('inspector.expr.activatorPlaceholder')
            : t('inspector.expr.labelPlaceholder')
        }
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
  const t = useT()
  const [to, setTo] = useState<StateMode>('trigger')
  return (
    <div className="inspector__legacy">
      <p className="inspector__note">{t('inspector.legacy.note', { mode: ed.mode })}</p>
      <Field label={t('inspector.legacy.convertTo')}>
        <select value={to} onChange={(e) => setTo(e.target.value as StateMode)}>
          <option value="trigger">{t('enum.stateMode.trigger')}</option>
          <option value="activator">{t('enum.stateMode.activator')}</option>
          <option value="label">{t('enum.stateMode.label')}</option>
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
        {t('inspector.legacy.convertButton', { mode: to })}
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
  const t = useT()
  const norm = normalizeResourceType(value)
  const raw = value ?? ''
  return (
    <>
      <Field label={t('inspector.field.resourceType')}>
        <input
          value={raw}
          list="resource-type-builtins"
          placeholder={t('inspector.resourceType.placeholder')}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </Field>
      <datalist id="resource-type-builtins">
        {BUILTIN_RESOURCE_TYPES.map((rt) => (
          <option key={rt} value={rt} />
        ))}
      </datalist>
      {norm.value === null && raw.trim() !== '' && (
        <p className="inspector__note inspector__note--warn">
          {t('inspector.resourceType.tooLong', { max: RESOURCE_TYPE_MAX_BYTES })}
        </p>
      )}
      {norm.value !== null && norm.value !== raw && (
        <p className="inspector__note">
          {t('inspector.resourceType.normalised', { value: norm.value })}
        </p>
      )}
      {norm.value !== null && !isBuiltinResourceType(norm.value) && (
        <p className="inspector__note">{t('inspector.resourceType.custom')}</p>
      )}
      {findings.length > 0 && (
        <p className="inspector__note inspector__note--warn">
          {t('inspector.resourceType.mismatch', {
            pairs: findings.map((f) => `${f.edgeType} ↔ ${f.nodeType}`).join(', '),
          })}
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
  const t = useT()
  return (
    <>
      <Field label={t('inspector.field.startingAmount')}>
        <input
          type="number"
          value={d.initial}
          onChange={(e) => set({ initial: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('inspector.field.capacity')}>
        <input
          type="number"
          value={d.capacity ?? ''}
          onChange={(e) =>
            set({ capacity: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </Field>
      <Field label={t('inspector.field.flowMode')}>
        <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="pullAny">{t('enum.flowMode.pullAny')}</option>
          <option value="pullAll">{t('enum.flowMode.pullAll')}</option>
          <option value="pushAny">{t('enum.flowMode.pushAny')}</option>
          <option value="pushAll">{t('enum.flowMode.pushAll')}</option>
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
  const t = useT()
  return (
    <Field label={t('inspector.field.flowMode')}>
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pushAny">{t('enum.flowMode.pushAny')}</option>
        <option value="pushAll">{t('enum.flowMode.pushAll')}</option>
      </select>
    </Field>
  )
}

function DrainFields({ d, set }: { d: DrainData; set: Patch }) {
  const t = useT()
  return (
    <Field label={t('inspector.field.flowMode')}>
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pullAny">{t('enum.flowMode.pullAny')}</option>
        <option value="pullAll">{t('enum.flowMode.pullAll')}</option>
      </select>
    </Field>
  )
}

function GateFields({ d, set }: { d: GateData; set: Patch }) {
  const t = useT()
  return (
    <Field label={t('inspector.field.distribution')}>
      <select value={d.distribution} onChange={(e) => set({ distribution: e.target.value })}>
        <option value="deterministic">{t('enum.distribution.deterministic')}</option>
        <option value="probabilistic">{t('enum.distribution.probabilistic')}</option>
      </select>
    </Field>
  )
}

function ConverterFields({ d, set }: { d: ConverterData; set: Patch }) {
  const t = useT()
  return (
    <Field label={t('inspector.field.flowMode')}>
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="pullAny">{t('enum.flowMode.pullAny')}</option>
        <option value="pullAll">{t('enum.flowMode.pullAll')}</option>
      </select>
    </Field>
  )
}

// ── loop-model/1 (SEMANTICS-M.md) ────────────────────────────────────────

const numOrUndef = (s: string): number | undefined => (s === '' ? undefined : Number(s))

function ParameterFields({ d, set }: { d: ParameterData; set: Patch }) {
  const t = useT()
  // advisory notices from the defensive read (§M1.2) — value-out-of-range etc.
  const read = readParameterData(d)
  const notices = read.ok ? read.notices : []
  return (
    <>
      <Field label={t('inspector.field.value')}>
        <input type="number" value={d.value} onChange={(e) => set({ value: Number(e.target.value) })} />
      </Field>
      <Field label={t('inspector.field.unit')}>
        <input value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} />
      </Field>
      <Field label={t('inspector.field.min')}>
        <input type="number" value={d.min ?? ''} onChange={(e) => set({ min: numOrUndef(e.target.value) })} />
      </Field>
      <Field label={t('inspector.field.max')}>
        <input type="number" value={d.max ?? ''} onChange={(e) => set({ max: numOrUndef(e.target.value) })} />
      </Field>
      <Field label={t('inspector.field.step')}>
        <input type="number" value={d.step ?? ''} onChange={(e) => set({ step: numOrUndef(e.target.value) })} />
      </Field>
      {notices.includes('PARAM_VALUE_OUT_OF_RANGE') && (
        <p className="inspector__note">{t('inspector.parameter.outOfRange')}</p>
      )}
      {(notices.includes('PARAM_RANGE_INVALID') || notices.includes('PARAM_STEP_INVALID')) && (
        <p className="inspector__note">{t('inspector.parameter.hintIncoherent')}</p>
      )}
      <p className="inspector__note">{t('inspector.parameter.noPorts')}</p>
    </>
  )
}

function RegisterFields({ id, d, set }: { id: string; d: RegisterData; set: Patch }) {
  const t = useT()
  const parsed = parseExpr(d.expr)
  const read = readRegisterData(d)
  const notices = read.ok ? read.notices : []
  const outcome = useRegisterOutcome(id)
  const stepIndex = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Field label={t('inspector.field.expression')}>
        <input
          value={d.expr}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono, monospace)' }}
          onChange={(e) => set({ expr: e.target.value })}
        />
      </Field>
      {!parsed.ok ? (
        <p className="inspector__note inspector__note--warn">
          {parsed.error.code} · {t(EXPR_CODE_KEY[parsed.error.code], { column: parsed.error.column })}
        </p>
      ) : (
        parsed.expr.canonical !== d.expr && (
          <p className="inspector__note">
            {t('inspector.register.canonical', { canonical: parsed.expr.canonical })}
          </p>
        )
      )}

      {/* §M3.5 — R(currentStepIndex); §M6.2 — an invalid Register shows NO value */}
      {outcome && outcome.invalid ? (
        <p className="inspector__note inspector__note--warn">
          {t('inspector.register.invalidAtStep', {
            code: outcome.code,
            reason: t(REG_CODE_KEY[outcome.code] ?? 'error.unknownCode'),
            step: stepIndex,
          })}
        </p>
      ) : outcome ? (
        <p className="inspector__note">
          {t('inspector.register.valueAtStep', {
            step: stepIndex,
            value: formatRegisterValue(outcome.value, d.format),
          })}{' '}
          <span className="inspector__hint">{t('inspector.register.recomputed')}</span>
        </p>
      ) : null}

      <Field label={t('inspector.field.unit')}>
        <input value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} />
      </Field>
      <Field label={t('inspector.field.format')}>
        <select value={d.format ?? 'float'} onChange={(e) => set({ format: e.target.value })}>
          <option value="int">{t('enum.format.int')}</option>
          <option value="float">{t('enum.format.float')}</option>
          <option value="percent">{t('enum.format.percent')}</option>
        </select>
      </Field>
      {notices.includes('REG_FORMAT_INVALID') && (
        <p className="inspector__note">{t('inspector.register.formatInvalid')}</p>
      )}
      <p className="inspector__note">{t('inspector.register.noStore')}</p>
    </>
  )
}
