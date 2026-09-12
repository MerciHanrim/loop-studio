import { useId, useState, type ReactNode } from 'react'
import {
  classifyLabelTiming,
  eligibleLabelPreset,
  parseActivatorExpr,
  parseDelay,
  parseFlow,
  parseLabelExpr,
  resolveParamRhs,
  type ActivatorParse,
  type ActivatorRhs,
  type LabelParse,
  type LabelPresetReasonA,
  type LabelPresetReasonB,
  type LabelTimingClass,
} from '../engine'
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
import { useRegisterOutcome } from '../store/registers'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { RegisterExprField } from './RegisterExprField'
import { useT, type MessageKey } from '../i18n'
import type {
  ConverterData,
  DrainData,
  GateData,
  LoopEdgeData,
  NodeKind,
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

/** Same shape/classes as `Field`, but a `<div>` — for a field whose content
 *  already contains its own `<label>` elements (e.g. a radiogroup): a
 *  `<label>` cannot validly contain another `<label>`. */
function FieldDiv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
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
    // shared by EdgeFlowField (`@id` in `flow`) and ActivatorField (`@id` in
    // an activator `expr`, docs/parameter-activator.md §PA7) — ONE computed
    // list, same shape, so the two `@`-reference pickers never drift.
    const paramOptions = nodes
      .filter((n) => (n.data as { kind?: string }).kind === 'parameter')
      .map((n) => {
        const v = (n.data as { value?: unknown }).value
        return {
          id: n.id,
          label: (n.data as { label?: string }).label || n.id,
          value: typeof v === 'number' && Number.isFinite(v) ? v : null,
        }
      })
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
              params={paramOptions}
              onChange={(flow) => setData({ ...ed, kind: 'resource', flow })}
            />
            <ResourceTypeField
              value={ed.resourceType}
              onChange={(v) => setData({ ...ed, kind: 'resource', resourceType: v })}
              findings={mismatches.filter((f) => f.edgeId === edge.id)}
            />
          </>
        ) : (
          <StateEdgeFields
            ed={ed}
            setData={setData}
            sourceKind={(nodes.find((n) => n.id === edge.source)?.data as { kind?: NodeKind } | undefined)?.kind}
            targetKind={(nodes.find((n) => n.id === edge.target)?.data as { kind?: NodeKind } | undefined)?.kind}
            params={paramOptions}
          />
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
  params: { id: string; label: string; value: number | null }[]
  onChange: (flow: string) => void
}) {
  const t = useT()
  // §RXA7 — the picker lists candidates in the same shape as the Register `@`
  // list (`Name · Parameter · = value`); it still writes a single `@id` and the
  // rest of the `flow` field (literal entry, status line) is unchanged.
  const paramKind = t('canvas.nodeKind.parameter')
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
              {p.label} · {paramKind} · = {p.value == null ? '—' : String(p.value)}
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
  sourceKind,
  targetKind,
  params,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
  sourceKind: NodeKind | undefined
  targetKind: NodeKind | undefined
  params: { id: string; label: string; value: number | null }[]
}) {
  const t = useT()
  if (!KNOWN_STATE_MODES.includes(ed.mode)) return <LegacyStateEdge ed={ed} setData={setData} />
  const labelClass = ed.mode === 'label' ? classifyLabelTiming(ed.timing, ed.when) : undefined
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
      {ed.mode === 'activator' && <ActivatorField ed={ed} setData={setData} params={params} />}
      {ed.mode === 'label' && <ExprField ed={ed} setData={setData} labelClass={labelClass} />}
      {ed.mode === 'label' && (
        <LabelTimingField ed={ed} setData={setData} sourceKind={sourceKind} targetKind={targetKind} />
      )}
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

/** the literal-RHS hint (`ACT_RE`, unchanged, PA1) reuses the existing
 *  `inspector.activator.describe` wording; `rhsDescribeText` also covers a
 *  symbolic `@id ± N` shape (`{n}` accepts `string | number`) for a
 *  param-term whose LIVE resolution isn't being shown (never actually
 *  reached once `ActivatorField` is wired below, which always resolves a
 *  param-term live — kept as the honest fallback if this is ever called on
 *  an unresolved `ActivatorParse` some other way). */
function rhsDescribeText(rhs: ActivatorRhs): string | number {
  if (rhs.kind === 'literal') return rhs.n
  if (rhs.offset === 0) return `@${rhs.id}`
  return `@${rhs.id} ${rhs.offset > 0 ? '+' : '−'} ${Math.abs(rhs.offset)}`
}
function describeActivator(t: TFn, p: Extract<ActivatorParse, { ok: true }>): string {
  return t('inspector.activator.describe', { op: p.op, n: rhsDescribeText(p.rhs) })
}
function describeLabel(t: TFn, p: Extract<LabelParse, { ok: true }>): string {
  const amount = p.token === 'S' ? t('inspector.label.amountSource') : String(p.n)
  if (p.op === '=') return t('inspector.label.describe.set', { amount })
  return p.op === '+'
    ? t('inspector.label.describe.add', { amount })
    : t('inspector.label.describe.subtract', { amount })
}

// ── docs/parameter-activator.md §PA7 — the activator authoring surface ────
// A Parameter picker mirroring `EdgeFlowField`'s shape (a `<select>` +
// the existing literal `<input>`, both editing the SAME `expr` string) plus
// an offset control and a LIVE resolved-value preview — the actual fix for
// §PA2's off-by-one: an author sets the offset to `-1` and immediately SEES
// the effective number (`pity ≥ 2`), rather than trusting `HARD_PITY - 1`
// arithmetic by eye. The preview calls the SAME `resolveParamRhs` the engine
// evaluates against (`stateExpr.ts`), so it can never show a number the
// engine wouldn't actually gate on.
function ActivatorField({
  ed,
  setData,
  params,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
  params: { id: string; label: string; value: number | null }[]
}) {
  const t = useT()
  // two separate hook calls (never short-circuited) — Rules of Hooks
  const isMobile = useIsMobile()
  const lockedDesktop = useUiStore((s) => s.canvasLocked)
  const readOnly = isMobile || lockedDesktop
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const uid = useId()
  // Register live-edit trap fix precedent (this session) — a controlled
  // number input that round-trips through `Number(...)` on every keystroke
  // corrupts a still-being-typed negative number (typing "-" alone would
  // instantly snap to "0"). Keep a local draft string while focused; commit
  // only once it parses as a whole number, and drop the draft on blur so the
  // field snaps back to whatever is actually stored.
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null)

  const raw = ed.expr ?? ''
  const res = parseActivatorExpr(raw, modelVersion === 2 ? 2 : 1)
  const paramKind = t('canvas.nodeKind.parameter')

  const currentOp = res.ok ? res.op : '>='
  const isParamForm = res.ok && res.rhs.kind === 'param'
  const currentParamId = res.ok && res.rhs.kind === 'param' ? res.rhs.id : ''
  const currentOffset = res.ok && res.rhs.kind === 'param' ? res.rhs.offset : 0

  let hint: string
  let hintOk: boolean
  if (!res.ok) {
    hint = t('inspector.stateExpr.noEffect', { hint: t(ACT_HINT_KEY[res.reason]) })
    hintOk = false
  } else if (res.rhs.kind === 'literal') {
    hint = describeActivator(t, res)
    hintOk = true
  } else {
    const rhs = res.rhs
    const resolution = resolveParamRhs(rhs, (id) => {
      const node = useGraphStore.getState().nodes.find((n) => n.id === id)
      if (!node) return undefined
      return { kind: (node.data as { kind?: string }).kind ?? '', value: (node.data as { value?: unknown }).value }
    })
    const offsetText = rhs.offset === 0 ? '' : ` ${rhs.offset > 0 ? '+' : '−'} ${Math.abs(rhs.offset)}`
    if (resolution.ok) {
      const target = params.find((p) => p.id === rhs.id)
      hint = t('inspector.activator.preview.resolved', {
        op: currentOp,
        threshold: resolution.threshold,
        paramLabel: target?.label ?? rhs.id,
        offsetText,
        // = resolution.threshold - rhs.offset, but reading the Parameter's
        // own current value directly (rather than back-computing) stays
        // correct even if a future rounding rule ever made the two diverge.
        paramValue: target?.value ?? resolution.threshold - rhs.offset,
      })
      hintOk = true
    } else {
      const key: MessageKey =
        resolution.reason === 'unknown'
          ? 'inspector.activator.preview.unknown'
          : resolution.reason === 'not-param'
            ? 'inspector.activator.preview.notParam'
            : resolution.reason === 'non-finite'
              ? 'inspector.activator.preview.nonFinite'
              : 'inspector.activator.preview.overflow'
      hint = t(key, { id: rhs.id, kind: resolution.kind ?? '' })
      hintOk = false
    }
  }

  if (readOnly) {
    return (
      <FieldDiv label={t('inspector.field.condition')}>
        <p className={`field__hint activatorfield__preview ${hintOk ? 'field__hint--ok' : 'field__hint--bad'}`}>
          {hint}
        </p>
      </FieldDiv>
    )
  }

  const writeOffset = (n: number) => {
    const suffix = n === 0 ? '' : ` ${n > 0 ? '+' : '-'} ${Math.abs(n)}`
    setData({ ...ed, expr: `${currentOp} @${currentParamId}${suffix}` })
  }
  const pickParam = (id: string) => {
    setOffsetDraft(null)
    if (id === '') {
      setData({ ...ed, expr: `${currentOp} 0` }) // no sensible literal to guess — a plain 0 to edit from
      return
    }
    const suffix = currentOffset === 0 ? '' : ` ${currentOffset > 0 ? '+' : '-'} ${Math.abs(currentOffset)}`
    setData({ ...ed, expr: `${currentOp} @${id}${suffix}` })
  }

  return (
    <FieldDiv label={t('inspector.field.condition')}>
      {params.length > 0 && (
        <select
          id={`activatorParam-${uid}`}
          className="activatorfield__param"
          aria-label={t('inspector.activator.paramPicker.pickLabel')}
          value={currentParamId}
          onChange={(e) => pickParam(e.target.value)}
        >
          <option value="">{t('inspector.activator.paramPicker.literalOption')}</option>
          {params.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {paramKind} · = {p.value == null ? '—' : String(p.value)}
            </option>
          ))}
        </select>
      )}
      <input
        className="activatorfield__expr"
        aria-label={t('inspector.field.condition')}
        value={raw}
        placeholder={t('inspector.expr.activatorPlaceholder')}
        aria-invalid={!hintOk}
        onChange={(e) => {
          setOffsetDraft(null)
          setData({ ...ed, expr: e.target.value })
        }}
      />
      {isParamForm && (
        <>
          <span className="inspector__subfield-label" id={`activatorOffsetLabel-${uid}`}>
            {t('inspector.activator.offsetLabel')}
          </span>
          <input
            id={`activatorOffset-${uid}`}
            className="activatorfield__offset"
            aria-labelledby={`activatorOffsetLabel-${uid}`}
            type="number"
            step={1}
            value={offsetDraft ?? String(currentOffset)}
            onChange={(e) => {
              const text = e.target.value
              setOffsetDraft(text)
              if (/^-?\d+$/.test(text)) writeOffset(Number(text))
            }}
            onBlur={() => setOffsetDraft(null)}
          />
        </>
      )}
      <p className={`field__hint activatorfield__preview ${hintOk ? 'field__hint--ok' : 'field__hint--bad'}`}>{hint}</p>
    </FieldDiv>
  )
}

function ExprField({
  ed,
  setData,
  labelClass,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
  /** docs/label-timing-authoring.md §LTA5 path 2 — when the edge is
   *  classified `afterPull` and the parsed modifier is an `S`-form, this
   *  field's own hint (not just the radiogroup) says so, per
   *  free-text-input rules (never blocks the commit). */
  labelClass?: LabelTimingClass
}) {
  const t = useT()
  const raw = ed.expr ?? ''
  const res = parseLabelExpr(raw)

  // §LTA5 path 2 — an S-form modifier under "On source fire" still commits
  // (free-text input, never blocked, RXA-INV-5 precedent) but is flagged like
  // any other no-effect state, not the normal "describes the effect" hint.
  const sFormUnderAfterPull = labelClass === 'afterPull' && res.ok && res.token === 'S'
  const hint = sFormUnderAfterPull
    ? t('inspector.labelTiming.warnSForm')
    : res.ok
      ? describeLabel(t, res)
      : t('inspector.stateExpr.noEffect', { hint: t(LABEL_HINT_KEY[res.reason]) })
  const hintOk = res.ok && !sFormUnderAfterPull

  return (
    <Field label={t('inspector.field.modifier')}>
      <input
        value={raw}
        placeholder={t('inspector.expr.labelPlaceholder')}
        aria-invalid={!res.ok || sFormUnderAfterPull}
        onChange={(e) => setData({ ...ed, expr: e.target.value })}
      />
      <p className={`field__hint ${hintOk ? 'field__hint--ok' : 'field__hint--bad'}`}>{hint}</p>
    </Field>
  )
}

// ── docs/label-timing-authoring.md — the label-timing preset control ───────
// CSU8 slice 3. Bundles `timing` / `when` into one native two-option radio
// group (LTA-D1/D10) so the control can never freshly author a
// SEMANTICS-S3.md §S3-5 fail-closed combination (LTA-INV-1/3). See
// `classifyLabelTiming` / `eligibleLabelPreset` (src/engine/stateExpr.ts) —
// the ONE shared source for what a stored value means and what the current
// graph context allows (LTA-D8/D12).

const REASON_KEY: Record<LabelPresetReasonA | LabelPresetReasonB, MessageKey> = {
  'target-not-pool': 'inspector.labelTiming.warnTargetNotPool',
  'modifier-invalid': 'inspector.labelTiming.warnModifierInvalid',
  'source-not-pool': 'inspector.labelTiming.warnSourceNotPool',
  'source-not-router': 'inspector.labelTiming.warnSourceNotRouter',
  's-form': 'inspector.labelTiming.warnSForm',
}

/** raw stored value for the §LTA4.4 unsupported message — never blank, never
 *  a non-string coerced silently; anything other than a non-empty string
 *  reads as "—" (an existing "no value" convention in this app, e.g.
 *  `panels.summary.noValue`). */
const rawOrDash = (v: unknown): string => (typeof v === 'string' && v !== '' ? v : '—')

function LabelTimingField({
  ed,
  setData,
  sourceKind,
  targetKind,
}: {
  ed: StateEdgeData
  setData: (data: LoopEdgeData) => void
  sourceKind: NodeKind | undefined
  targetKind: NodeKind | undefined
}) {
  const t = useT()
  // two separate hook calls (never short-circuited) — Rules of Hooks
  const isMobile = useIsMobile()
  const lockedDesktop = useUiStore((s) => s.canvasLocked)
  const readOnly = isMobile || lockedDesktop
  // On mobile, the hidden desktop `.inspector` and `MobileInspectorSheet`'s own
  // Inspector can both be mounted at once — a fixed id/name would duplicate in
  // the DOM (invalid HTML, an ambiguous `aria-describedby` target). `useId()`
  // gives each mounted instance its own prefix; applied in both branches below
  // (not just the editable one) so a hidden-vs-shown pair never collides
  // regardless of which rendering path either instance takes.
  const uid = useId()
  const groupLineId = `labelTiming-groupline-${uid}`
  const reasonAId = `labelTiming-reasonA-${uid}`
  const reasonBId = `labelTiming-reasonB-${uid}`
  const radioName = `labelTiming-${uid}`
  const classified = classifyLabelTiming(ed.timing, ed.when)
  const modifier = parseLabelExpr(ed.expr ?? '')
  const { eligible, reasonA, reasonB } = eligibleLabelPreset({ targetKind, sourceKind, modifier })

  const pickAlways = () => {
    const { timing: _timing, when: _when, ...rest } = ed
    setData(rest as LoopEdgeData)
  }
  const pickAfterPull = () => setData({ ...ed, timing: 'afterPull', when: 'source-fired' })

  // §LTA6.2 — the ONE line under the group: `unsupported` takes priority over
  // any eligibility reason; otherwise the CHECKED option's own reason (if it
  // has one) is reused verbatim; otherwise the normal preview for whichever
  // preset is checked.
  const checkedReason = classified === 'phase0' ? reasonA : classified === 'afterPull' ? reasonB : undefined
  const isWarningLine = classified === 'unsupported' || !!checkedReason
  const groupLine =
    classified === 'unsupported'
      ? t('inspector.labelTiming.unsupported', { timing: rawOrDash(ed.timing), when: rawOrDash(ed.when) })
      : checkedReason
        ? t(REASON_KEY[checkedReason])
        : t(classified === 'phase0' ? 'inspector.labelTiming.previewAlways' : 'inspector.labelTiming.previewAfterPull')

  if (readOnly) {
    // LTA-INV-4 — mobile / locked: plain text, same content, no radios. The
    // `unsupported` message already states the whole situation on its own
    // (§LTA4.4) — showing a preset-name line above it too would duplicate the
    // same long sentence, so that line is only rendered for phase0/afterPull.
    return (
      <FieldDiv label={t('inspector.field.labelTiming')}>
        {classified !== 'unsupported' && (
          <p className="field__hint">
            {classified === 'phase0' ? t('inspector.labelTiming.always') : t('inspector.labelTiming.afterPull')}
          </p>
        )}
        <p id={groupLineId} className={`field__hint labeltiming__groupline ${isWarningLine ? 'field__hint--bad' : 'field__hint--ok'}`}>
          {groupLine}
        </p>
      </FieldDiv>
    )
  }

  // §LTA7/LTA-D9 — the group line is a STATIC description (`aria-describedby`)
  // of the checked-and-eligible option when it's just the normal preview; it
  // becomes an `aria-live` region only while it's a warning (`unsupported`, or
  // the checked option's own eligibility reason), since only THAT case can
  // change as a side effect of an edit elsewhere (source/target/modifier)
  // without the radiogroup itself receiving focus. Avoids double-announcing
  // the same text an option's accessible name (or its own reason paragraph)
  // already carries.
  const describedByA = reasonA ? reasonAId : classified === 'phase0' && !isWarningLine ? groupLineId : undefined
  const describedByB = reasonB ? reasonBId : classified === 'afterPull' && !isWarningLine ? groupLineId : undefined

  return (
    <FieldDiv label={t('inspector.field.labelTiming')}>
      <div role="radiogroup" aria-label={t('inspector.field.labelTiming')} className="labeltiming">
        <label className="labeltiming__option">
          <input
            type="radio"
            name={radioName}
            checked={classified === 'phase0'}
            disabled={eligible !== 'A'}
            aria-describedby={describedByA}
            onChange={pickAlways}
          />
          {t('inspector.labelTiming.always')}
        </label>
        {reasonA && (
          <p id={reasonAId} className="field__hint field__hint--bad labeltiming__reason">
            {t(REASON_KEY[reasonA])}
          </p>
        )}
        <label className="labeltiming__option">
          <input
            type="radio"
            name={radioName}
            checked={classified === 'afterPull'}
            disabled={eligible !== 'B'}
            aria-describedby={describedByB}
            onChange={pickAfterPull}
          />
          {t('inspector.labelTiming.afterPull')}
        </label>
        {reasonB && (
          <p id={reasonBId} className="field__hint field__hint--bad labeltiming__reason">
            {t(REASON_KEY[reasonB])}
          </p>
        )}
      </div>
      <p
        id={groupLineId}
        {...(isWarningLine ? { 'aria-live': 'polite' as const } : {})}
        className={`field__hint labeltiming__groupline ${isWarningLine ? 'field__hint--bad' : 'field__hint--ok'}`}
      >
        {groupLine}
      </p>
    </FieldDiv>
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
  // docs/register-expression-authoring.md §RXA3 — the expression field is now
  // the reference-aware editor: `@` autocomplete + a name read-back + a live
  // value breakdown. It owns its own `draft`-until-parseable commit gate
  // (unchanged semantics — local-only until it parses, reset from `d.expr` on a
  // node switch / undo), so RegisterFields just forwards `set({ expr })`.
  const read = readRegisterData(d)
  const notices = read.ok ? read.notices : []
  const outcome = useRegisterOutcome(id)
  return (
    <>
      <RegisterExprField
        id={id}
        expr={d.expr}
        outcome={outcome}
        onCommit={(expr) => set({ expr })}
        label={t('inspector.field.expression')}
      />

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
