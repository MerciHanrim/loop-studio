import { useMemo, useState, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { parse, parseExpr, refsOf } from '../model/expr'
import { formatRegisterValue, readParameterData, readRegisterData } from '../model/model'
import type { RegisterOutcome } from '../model/model'
import type { LoopNode } from '../model/types'
import { selectOnly, useGraphStore } from '../store/graphStore'
import { hasModelLayer } from '../model/modelVersion'
import { anyRunRule, ruleOf, ruleTables, runFindings } from '../model/runRule'
import { stagesNewlyStalled, stagesNewlyWarned } from '../model/runWarnings'
import { timetableLines } from '../model/timetable'
import { runRefusalText } from '../ui/runMessages'
import { useStageTag } from './nodes/StageTag'
import { convertersWhoseVerdictChanges, kindFindings, kindFindingEdgeId, kindFindingNodeId, type KindFinding, type ResourceKindDecl } from '../model/kinds'
import { fieldUnitText, readRateUnitList, readUnitList, STEP_VALUE_MAX, TIME_UNITS, type DocTime, type FieldUnit, type RateUnitDecl, type TimeUnit, type UnitDecl } from '../model/units'
import { outflowOptions, outflowReading, outflowShown } from '../model/viewUnits'
import { useViewUnitsStore } from '../store/viewUnitsStore'
import type { BoundaryOutflow } from '../engine/boundaryOutflow'
import { normalizeResourceType } from '../model/model/resourceType'
import { ConfirmDialog } from './ConfirmDialog'
import type { LoopEdge } from '../model/types'
import { useRegisterOutcomes } from '../store/registers'
import { useSimStore } from '../store/simStore'
import { useUiStore } from '../store/uiStore'
import { useT, type MessageKey } from '../i18n'
import { isolateAuto, isolateLtr } from '../i18n/bidiIsolate'
import { ArrowIcon, Icon } from '../ui/icons'
import { DraftNumberInput } from './DraftNumberInput'

// docs/module-system.md §MS5 — the Inputs and Summary panels. Two collapsible
// sections at the top of the desktop right column, above the Inspector. Pure
// reads of the live `parameter` / `register` nodes:
//  • Inputs   — every Parameter with an editable value; for a v2 graph, each
//               resource edge whose `flow` is an `@param` reference (read-only).
//  • Summary  — every Register with its R(t) value + unit and a show-calculation
//               toggle; an invalid Register shows "— no value" like the canvas.
// Every row is read-through: clicking the label selects the node / edge and
// centres the canvas on it. Nothing here is persisted, filed, or digested
// (§MS5.3); editing a Parameter value is one `updateNodeData` commit, exactly
// like the Inspector.

const kindOf = (el: { data?: unknown }): string | undefined =>
  (el.data as { kind?: unknown } | undefined)?.kind as string | undefined

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

const labelOf = (n: { id: string; data?: unknown } | undefined): string =>
  ((n?.data as { label?: unknown } | undefined)?.label as string | undefined) ?? n?.id ?? ''

/** select a node / edge from a list and bring it into view, keeping the
 *  current zoom (read-through — §MS5.1). Every list of the workbench's left
 *  panel — the Model list and the Inputs tab's panels — reveals the same way
 *  (Lumi, 2026-10-19): a node already wholly in view does not move the
 *  canvas; one outside it is brought just inside, with the smallest move.
 *  Applied with a plain (instant) `setViewport` — `fitView` / `setCenter`,
 *  and even `setViewport` with a `{ duration }` transition, silently no-op
 *  here because the pan runs from outside `<ReactFlow>`'s own subtree. */
export function useReveal(): (nodeId: string | null, edgeId: string | null) => void {
  const nodes = useGraphStore((s) => s.nodes)
  const { setViewport, getViewport } = useReactFlow()
  return (nodeId, edgeId) => {
    // the selection and each element's own `selected` mark, as a click on the
    // canvas sets them (not React Flow's `setNodes`: see `selectOnly`)
    selectOnly({ node: nodeId ?? undefined, edge: edgeId ?? undefined })
    const n = nodeId ? nodes.find((x) => x.id === nodeId) : null
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (n && pane) {
      const m = (n as { measured?: { width?: number; height?: number } }).measured
      const w = m?.width ?? 60
      const h = m?.height ?? 30
      const v = getViewport()
      // the node's box on screen, with its outside name (a published name box)
      const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`)
      const label = el?.querySelector('.nodef__label')?.getBoundingClientRect()
      const body = el?.getBoundingClientRect()
      // (no element to read: its box from the document position)
      const fromDoc = { left: pane.left + v.x + n.position.x * v.zoom, top: pane.top + v.y + n.position.y * v.zoom, right: pane.left + v.x + (n.position.x + w) * v.zoom, bottom: pane.top + v.y + (n.position.y + h) * v.zoom }
      const rect = body && label ? { left: Math.min(body.left, label.left), top: Math.min(body.top, label.top), right: Math.max(body.right, label.right), bottom: Math.max(body.bottom, label.bottom) } : (body ?? fromDoc)
      const M = 24 // keep this far inside the pane
      const dx = rect.left < pane.left + M ? pane.left + M - rect.left : rect.right > pane.right - M ? pane.right - M - rect.right : 0
      const dy = rect.top < pane.top + M ? pane.top + M - rect.top : rect.bottom > pane.bottom - M ? pane.bottom - M - rect.bottom : 0
      if (dx !== 0 || dy !== 0) void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom })
    }
  }
}

function PanelHead({
  title,
  count,
  open,
  onToggle,
  labelKey,
  aside,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  labelKey: { collapse: MessageKey; expand: MessageKey }
  /** a control that sits beside the heading, OUTSIDE the section toggle —
   *  always visible, never part of the heading's own accessible name */
  aside?: ReactNode
}) {
  const t = useT()
  // §L9.3 — only the inline-end arm follows the reader (`ArrowIcon`, issue #298);
  // a menu opens downward for every reader, so the open state is a plain icon
  return (
    <div className="mpanel__headrow">
      <h2 className="mpanel__head">
        <button
          type="button"
          className="mpanel__toggle"
          aria-expanded={open}
          aria-label={open ? t(labelKey.collapse) : t(labelKey.expand)}
          onClick={onToggle}
        >
          <span className="mpanel__caret" aria-hidden="true">
            {open ? <Icon name="chevron-down" /> : <ArrowIcon unit="submenu" />}
          </span>
          {title}
          <span className="mpanel__count" dir="ltr">{count}</span>
        </button>
      </h2>
      {aside}
    </div>
  )
}

function InputsSection({
  params,
  paramFlowEdges,
  nodes,
}: {
  params: LoopNode[]
  paramFlowEdges: { id: string; source: string; target: string; flow: string }[]
  nodes: LoopNode[]
}) {
  const t = useT()
  const open = useUiStore((s) => s.inputsPanelOpen)
  const toggle = useUiStore((s) => s.toggleInputsPanel)
  const locked = useUiStore((s) => s.canvasLocked)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const reveal = useReveal()

  return (
    <section className="mpanel">
      <PanelHead
        title={t('panels.inputs.title')}
        count={params.length + paramFlowEdges.length}
        open={open}
        onToggle={toggle}
        labelKey={{ collapse: 'panels.inputs.collapse', expand: 'panels.inputs.expand' }}
      />
      {open && (
        <div className="mpanel__body">
          {params.length === 0 && paramFlowEdges.length === 0 ? (
            <p className="mpanel__empty">{t('panels.empty.inputs')}</p>
          ) : (
            <ul className="mpanel__list">
              {params.map((n) => {
                const read = readParameterData(n.data)
                const label = labelOf(n)
                const raw = (n.data as { value?: unknown }).value
                const value =
                  read.ok ? read.data.value : typeof raw === 'number' && Number.isFinite(raw) ? raw : null
                return (
                  <li key={n.id} className="mp-row">
                    <button
                      type="button"
                      className="mp-row__label mp-row__label--name"
                      dir="auto"
                      title={label}
                      onClick={() => reveal(n.id, null)}
                    >
                      {label}
                    </button>
                    {/* #393 A — draft until a finite parse, as the Inspector's Value field */}
                    <DraftNumberInput
                      className="mp-row__val"
                      aria-label={t('panels.inputs.paramValue', { label })}
                      value={value}
                      allowEmpty={false}
                      disabled={locked}
                      onCommit={(v) => { if (v != null) updateNodeData(n.id, { value: v }) }}
                    />
                  </li>
                )
              })}
              {paramFlowEdges.map((e) => {
                const p = parse(e.flow)
                const refId = p.ok ? refsOf(p.ast)[0] : undefined
                const param = refId
                  ? labelOf(nodes.find((n) => n.id === refId)) || refId
                  : e.flow
                // §L9.3 - two INDEPENDENT user labels. Each is isolated so neither
                // can reorder the other, and the arrow between them is the
                // `graph-relation` unit: verdict KEEP, because it names the relation
                // the canvas draws and the canvas does not mirror.
                const sourceLabel = labelOf(nodes.find((n) => n.id === e.source))
                const targetLabel = labelOf(nodes.find((n) => n.id === e.target))
                // the joined form is still what the tooltip attribute needs - markup
                // cannot reach an attribute (PR C owns the 115 attribute sites)
                const flowText = `${sourceLabel} → ${targetLabel}`
                return (
                  <li key={e.id} className="mp-row mp-row--flow">
                    <button
                      type="button"
                      className="mp-row__label"
                      title={flowText}
                      onClick={() => reveal(null, e.id)}
                    >
                      <bdi dir="auto">{sourceLabel}</bdi> → <bdi dir="auto">{targetLabel}</bdi>
                    </button>
                    <span className="mp-row__via">{t('panels.inputs.flowVia', { param: isolateAuto(param) })}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function SummaryRow({
  node,
  outcome,
  step,
  showCalc,
  onReveal,
}: {
  node: LoopNode
  outcome: RegisterOutcome | undefined
  step: number
  /** the panel-wide `계산식` toggle (docs/timeline-series-contract.md §8) —
   *  every row shows or hides its expression together */
  showCalc: boolean
  onReveal: () => void
}) {
  const t = useT()
  const read = readRegisterData(node.data)
  const label = labelOf(node)
  const unit = read.ok ? read.data.unit : undefined
  const format = read.ok ? read.data.format : undefined
  const exprRaw = read.ok ? read.data.expr : String((node.data as { expr?: unknown }).expr ?? '')
  const parsed = parseExpr(exprRaw)
  const shownExpr = parsed.ok ? parsed.expr.canonical : exprRaw

  return (
    <li className="mp-row mp-row--reg">
      <div className="mp-row__main">
        <button
          type="button"
          className="mp-row__label mp-row__label--name"
          dir="auto"
          title={label}
          onClick={onReveal}
        >
          {label}
        </button>
        <span className={`mp-row__val${!outcome || outcome.invalid ? ' mp-row__val--invalid' : ''}`}>
          {!outcome || outcome.invalid
            ? t('panels.summary.noValue', { step })
            : `${formatRegisterValue(outcome.value, format)}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      {showCalc && (
        <div className="mp-row__calc">
          <code className="mp-row__expr" dir="ltr">{shownExpr}</code>
        </div>
      )}
      {outcome && outcome.invalid && <span className="mp-row__code" dir="ltr">{outcome.code}</span>}
    </li>
  )
}

function SummarySection({ registers }: { registers: LoopNode[] }) {
  const t = useT()
  const open = useUiStore((s) => s.summaryPanelOpen)
  const toggle = useUiStore((s) => s.toggleSummaryPanel)
  const outcomes = useRegisterOutcomes()
  const step = useSimStore((s) => s.stepIndex)
  const reveal = useReveal()
  // docs/timeline-series-contract.md §8 — ONE shared toggle beside the
  // heading, always visible, showing and hiding every expression at once.
  // Screen state only. (The per-row buttons it replaces were real buttons
  // too; this is a consolidation, and it gives up per-row independence.)
  const [showCalc, setShowCalc] = useState(false)

  return (
    <section className="mpanel">
      <PanelHead
        title={t('panels.summary.title')}
        count={registers.length}
        open={open}
        onToggle={toggle}
        labelKey={{ collapse: 'panels.summary.collapse', expand: 'panels.summary.expand' }}
        aside={
          <button
            type="button"
            className="mpanel__calc"
            aria-expanded={showCalc}
            onClick={() => setShowCalc((v) => !v)}
          >
            {t(showCalc ? 'panels.summary.hideCalc' : 'panels.summary.showCalc')}
          </button>
        }
      />
      {open && (
        <div className="mpanel__body">
          {registers.length === 0 ? (
            <p className="mpanel__empty">{t('panels.empty.summary')}</p>
          ) : (
            <ul className="mpanel__list">
              {registers.map((n) => (
                <SummaryRow
                  key={n.id}
                  node={n}
                  outcome={outcomes.get(n.id)}
                  step={step}
                  showCalc={showCalc}
                  onReveal={() => reveal(n.id, null)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// ── loop-model/3 (SEMANTICS-M3.md) — the Kinds panel ─────────────────────────

/** the kinds a graph names: every Pool `resourceType` and every connection
 *  annotation, normalised as §M4.1 identifies them, in ascending order */
function namedKinds(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): string[] {
  const out = new Set<string>()
  for (const n of nodes) {
    if (kindOf(n) !== 'pool') continue
    const v = normalizeResourceType((n.data as { resourceType?: unknown }).resourceType).value
    if (v !== null) out.add(v)
  }
  for (const e of edges) {
    if (kindOf(e) !== 'resource') continue
    const v = normalizeResourceType((e.data as { resourceType?: unknown } | undefined)?.resourceType).value
    if (v !== null) out.add(v)
  }
  return [...out].sort()
}

/** whether the Inputs tab has a panel to show: a Parameter or a Register, or
 *  a kind the graph names or the document declares (the Kinds panel, where
 *  the unit lists and the step length are authored — loop-model/3 and /4) */
export function hasModelPanels(nodes: readonly LoopNode[], edges: readonly LoopEdge[], kinds: readonly ResourceKindDecl[]): boolean {
  return nodes.some((n) => kindOf(n) === 'parameter' || kindOf(n) === 'register') || kinds.length > 0 || namedKinds(nodes, edges).length > 0 || anyRunRule(nodes)
}

/** One finding (§M3-4), worded in the user's language from the data. Every
 *  user label — a node's, a kind's, a rate as typed — enters as its own
 *  isolated ICU argument (docs/localization.md §L9.4). Shared with the
 *  Inspector's note, so the two say the same thing. */
export function KindFindingText({ f, nodes, edges }: { f: KindFinding; nodes: readonly LoopNode[]; edges: readonly LoopEdge[] }) {
  const t = useT()
  const label = (id: string) => labelOf(nodes.find((n) => n.id === id)) || id
  const from = (edgeId: string) => label(edges.find((e) => e.id === edgeId)?.source ?? edgeId)
  const to = (edgeId: string) => label(edges.find((e) => e.id === edgeId)?.target ?? edgeId)
  let text: string
  if (f.cls === 'conflict') {
    const c = f.conflict
    text =
      c.kind === 'poolEnds'
        ? t('kinds.finding.poolEnds', { from: isolateAuto(from(c.edgeId)), to: isolateAuto(to(c.edgeId)), a: isolateAuto(c.kinds[0]), b: isolateAuto(c.kinds[1]) })
        : c.kind === 'annotation'
          ? t('kinds.finding.annotation', { from: isolateAuto(from(c.edgeId)), to: isolateAuto(to(c.edgeId)), edgeKind: isolateAuto(c.edgeKind), poolKind: isolateAuto(c.poolKind) })
          : c.kind === 'poolNoKind'
            ? t('kinds.finding.poolNoKind', { from: isolateAuto(from(c.edgeId)), to: isolateAuto(to(c.edgeId)), kind: isolateAuto(c.edgeKind), pool: isolateAuto(label(c.nodeId)) })
            : t('kinds.finding.gateMixes', { gate: isolateAuto(label(c.nodeId)), kinds: isolateAuto(c.kinds.join(', ')) })
  } else if (f.cls === 'notComputable') {
    text =
      f.reason === 'noKind'
        ? t('kinds.finding.noKind', { from: isolateAuto(from(f.edgeId)), to: isolateAuto(to(f.edgeId)), converter: isolateAuto(label(f.converterId)) })
        : f.kind === null
          ? t('kinds.finding.rate', { from: isolateAuto(from(f.edgeId)), to: isolateAuto(to(f.edgeId)), rate: isolateAuto(f.rate) })
          : t('kinds.finding.rateConserved', { from: isolateAuto(from(f.edgeId)), to: isolateAuto(to(f.edgeId)), rate: isolateAuto(f.rate), kind: isolateAuto(f.kind), converter: isolateAuto(label(f.converterId)) })
  } else if (f.cls === 'outOfRange') {
    // loop-model/4 (§M4-2.5) — the authored value is a known-LTR token, the
    // unit a user name
    text = t('kinds.finding.outOfRange', { value: isolateLtr(f.value), unit: isolateAuto(f.unit) })
  } else {
    // loop-model/4 (§M4-5, R≈) — the two exact sums as text: the decimal when
    // it terminates, `≈` and 15 significant digits when it does not
    text = t('kinds.finding.broken', { converter: isolateAuto(label(f.converterId)), kind: isolateAuto(f.kind), out: isolateLtr(f.outText), in: isolateLtr(f.inText) })
  }
  return <>{text}</>
}

// ── loop-model/4 (SEMANTICS-M4.md §M4-1 / §M4-3) — a kind's unit lists and the
//    document's step length ─────────────────────────────────────────────────

/** the one-line form of a kind's unit lists: `L=0.001, mL=0.000001, MW=1000/h` */
function unitListText(units: readonly UnitDecl[] | undefined, rateUnits: readonly RateUnitDecl[] | undefined): string {
  return [...(units ?? []).map((u) => `${u.name}=${u.factor}`), ...(rateUnits ?? []).map((u) => `${u.name}=${u.factor}/${u.per}`)].join(', ')
}

/** the inverse: entries the §M4-1 read keeps; an entry it does not read is
 *  dropped (the committed field shows what survived) */
function parseUnitListText(text: string, baseUnit: string | undefined): { units: UnitDecl[]; rateUnits: RateUnitDecl[] } {
  const amount: unknown[] = []
  const rate: unknown[] = []
  for (const part of text.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq)
    const rest = part.slice(eq + 1).trim()
    const slash = rest.lastIndexOf('/')
    if (slash >= 0) rate.push({ name, factor: rest.slice(0, slash), per: rest.slice(slash + 1).trim() })
    else amount.push({ name, factor: rest })
  }
  const taken = new Set<string>(baseUnit !== undefined ? [baseUnit] : [])
  return { units: readUnitList(amount, taken), rateUnits: readRateUnitList(rate, taken) }
}

/** SEMANTICS-M5.md §M5-10 — the document's timetables: name, size and unit. A table
 *  comes in through Data ▸ New timetable; one no line reads can be removed. */
function TimetablesSection({ nodes, edges }: { nodes: LoopNode[]; edges: LoopEdge[] }) {
  const t = useT()
  const locked = useUiStore((s) => s.canvasLocked)
  const timetables = useGraphStore((s) => s.timetables)
  const setTimetables = useGraphStore((s) => s.setTimetables)
  const read = new Set([...timetableLines(edges).map((l) => l.tableId), ...ruleTables(nodes)])
  if (timetables.length === 0) return null
  return (
    <section className="mpanel">
      <div className="mpanel__body">
      <h3 className="mpanel__sub">{t('panels.timetables.title')}</h3>
      {timetables.map((x) => (
        <div key={x.id} className="mp-row mp-row--timetable">
          <span className="mp-row__label">{x.label}</span>
          <span className="mp-row__val">{t('panels.timetables.row', { n: x.points.length, unit: isolateAuto(x.unit) })}</span>
          {read.has(x.id) ? (
            <span className="mp-row__val">{t('panels.timetables.inUse')}</span>
          ) : (
            <button type="button" className="btn btn--ghost" disabled={locked} aria-label={t('panels.timetables.removeAria', { label: x.label })} onClick={() => setTimetables(timetables.filter((y) => y.id !== x.id))}>
              {t('panels.timetables.remove')}
            </button>
          )}
        </div>
      ))}
      </div>
    </section>
  )
}

/** one rule's row: its stage, which the row selects, and the words the stage's tag has
 *  when nothing folds them */
function RunRuleRow({ node, refusal, onShow }: { node: LoopNode; refusal: string | null; onShow: () => void }) {
  const tag = useStageTag(node.id, node.data)
  return (
    <div className="mp-row mp-row--run" data-run-row={node.id}>
      <button type="button" className="mp-row__label" onClick={onShow}>
        {labelOf(node) || node.id}
      </button>
      <span className="mp-row__val" dir="auto">{tag?.full}</span>
      {refusal !== null && <span className="mp-row__val mp-row__val--invalid">{refusal}</span>}
    </div>
  )
}

/** SEMANTICS-M6.md §M6-9 — the document's rules, next to the timetables they read: a
 *  stage's rule can be read here whatever its tag shows */
function RunRulesSection({ nodes, edges }: { nodes: LoopNode[]; edges: LoopEdge[] }) {
  const t = useT()
  const reveal = useReveal()
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const timetables = useGraphStore((s) => s.timetables)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const findings = useMemo(() => runFindings(nodes, edges, timetables, kinds, time, modelVersion), [nodes, edges, timetables, kinds, time, modelVersion])
  const stages = useMemo(() => nodes.filter((n) => ruleOf(n) !== null).sort(byId), [nodes])
  if (stages.length === 0) return null
  return (
    <section className="mpanel">
      <div className="mpanel__body">
        <h3 className="mpanel__sub">{t('panels.runRules.title')}</h3>
        {stages.map((n) => {
          const f = findings.find((x) => x.stage === n.id)
          return <RunRuleRow key={n.id} node={n} refusal={f ? runRefusalText(f, nodes, t) : null} onShow={() => reveal(n.id, null)} />
        })}
      </div>
    </section>
  )
}

/** the step-length row (§M4-3): a count and a time unit, or none. A change
 *  that would move a Converter's balance verdict (a connection authored per
 *  time changes its amount per step) is named and confirmed first (§M4-4). */
function TimeSection({ nodes, edges }: { nodes: LoopNode[]; edges: LoopEdge[] }) {
  const t = useT()
  const locked = useUiStore((s) => s.canvasLocked)
  const kinds = useGraphStore((s) => s.kinds)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const time = useGraphStore((s) => s.time)
  const timetables = useGraphStore((s) => s.timetables)
  const setTime = useGraphStore((s) => s.setTime)
  const [pending, setPending] = useState<{ body: string; next: DocTime | undefined } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const unitWord: Record<TimeUnit, MessageKey> = { s: 'panels.time.unit.s', min: 'panels.time.unit.min', h: 'panels.time.unit.h', d: 'panels.time.unit.d' }
  const propose = (next: DocTime | undefined) => {
    if (JSON.stringify(next?.step ?? null) === JSON.stringify(time?.step ?? null)) return
    const moved = convertersWhoseVerdictChanges(kindFindings(nodes, edges, kinds, modelVersion, time), kindFindings(nodes, edges, kinds, modelVersion, next))
    const warned = stagesNewlyWarned(nodes, edges, timetables, kinds, time, next)
    const stalled = stagesNewlyStalled(nodes, edges, timetables, kinds, time, next)
    if (moved.length === 0 && warned.length === 0 && stalled.length === 0) return setTime(next)
    const label = (id: string) => labelOf(nodes.find((n) => n.id === id)) || id
    const body = [
      ...(moved.length > 0 ? [t('panels.time.change.body', { converters: isolateAuto(moved.map(label).join(', ')) })] : []),
      ...(warned.length > 0 ? [t('panels.time.change.runBody', { stages: isolateAuto(warned.map(label).join(', ')) })] : []),
      ...(stalled.length > 0 ? [t('panels.time.change.startBody', { stages: isolateAuto(stalled.map(label).join(', ')) })] : []),
    ].join(' ')
    setPending({ body, next })
  }
  const commitValue = (text: string) => {
    setDraft(null)
    const v = Number(text)
    if (!Number.isInteger(v) || v < 1 || v > STEP_VALUE_MAX) return
    propose({ ...(time ?? { step: { value: v, unit: 'h' } }), step: { value: v, unit: time?.step.unit ?? 'h' } })
  }
  return (
    <>
      <h3 className="mpanel__sub">{t('panels.time.title')}</h3>
      <div className="mp-row mp-row--time">
        <span className="mp-row__label">{t('panels.time.step')}</span>
        <input
          type="number"
          className="mp-row__val mp-row__time-value"
          // §L9.3 — a count, never prose
          dir="ltr"
          inputMode="numeric"
          min={1}
          max={STEP_VALUE_MAX}
          step={1}
          aria-label={t('panels.time.value')}
          disabled={locked}
          value={draft ?? String(time?.step.value ?? 1)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commitValue(e.target.value)}
          // the Enter must end here: left to run on, it pressed the button of the dialog
          // the change had just opened, and the change was gone before it could be read
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }}
        />
        <select
          className="mp-row__val"
          aria-label={t('panels.time.title')}
          disabled={locked}
          value={time?.step.unit ?? ''}
          onChange={(e) => {
            const unit = e.target.value
            propose(unit === '' ? undefined : { ...(time ?? { step: { value: 1, unit: 'h' } }), step: { value: time?.step.value ?? 1, unit: unit as TimeUnit } })
          }}
        >
          <option value="">{t('panels.time.none')}</option>
          {TIME_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(unitWord[u])}
            </option>
          ))}
        </select>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={t('panels.time.change.title')}
        body={pending?.body ?? ''}
        confirmLabel={t('panels.time.change.confirm')}
        onConfirm={() => {
          if (pending) setTime(pending.next)
          setPending(null)
        }}
        onCancel={() => setPending(null)}
      />
    </>
  )
}

/** the base-unit field: a draft until blur / Enter, so typing a unit is one
 *  history entry, not one per keystroke */
function UnitInput({ value, label, placeholder, disabled, onCommit, maxLength = 32 }: { value: string; label: string; placeholder: string; disabled: boolean; onCommit: (v: string) => void; maxLength?: number }) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : value
  return (
    <input
      type="text"
      className="mp-row__val mp-row__unit"
      dir="auto"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      disabled={disabled}
      maxLength={maxLength}
      onFocus={() => { setDraft(value); setEditing(true) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

/** the option label of a field unit: the base unit's name (or "base unit"),
 *  a unit name, `L/min`, `MW`; a rate field says "per step" where the
 *  amount is per step */
export function unitOptionLabel(t: ReturnType<typeof useT>, fu: FieldUnit, decl: ResourceKindDecl, role: 'stock' | 'rate'): string {
  const name = fu.kind === 'base' ? (decl.baseUnit ?? t('inspector.unit.base')) : fu.kind === 'rate' ? fu.unit.name : fu.unit.name
  if (role === 'rate' && (fu.kind === 'base' || (fu.kind === 'amount' && !fu.per))) return t('inspector.unit.perStep', { unit: isolateAuto(name) })
  return fieldUnitText(fu) || name
}

/** §M4-9 — the amount of a boundary-outflow row under its kind's reading. A row
 *  with nothing to name keeps the report's number. */
function outflowAmount(t: ReturnType<typeof useT>, o: BoundaryOutflow, fu: FieldUnit, decl: ResourceKindDecl | undefined, time: DocTime | undefined): string | number {
  const shown = outflowShown(o.amount, o.raw, fu, decl, time)
  if (!shown) return o.amount
  const text = `${shown.number} ${shown.unit}`
  if (shown.perStep) return t('inspector.unit.perStep', { unit: isolateAuto(text) })
  return isolateAuto(text)
}

/** The Kinds panel (§M3-1): one row per kind the graph names or the table
 *  declares — Conserved opts it into per-kind conservation (C1), the base
 *  unit is a label (U1 stage 1). A row is in the file only while it is
 *  conserved or has a unit. Below the rows: the findings (D1), each a
 *  read-through to its node or connection, marked when it stops the run; and
 *  the committed step's boundary outflow by kind (L1), never called a loss,
 *  read in a per-kind unit that is session state (§M4-9). */
function KindsSection({ nodes, edges, named }: { nodes: LoopNode[]; edges: LoopEdge[]; named: string[] }) {
  const t = useT()
  const open = useUiStore((s) => s.kindsPanelOpen)
  const toggle = useUiStore((s) => s.toggleKindsPanel)
  const locked = useUiStore((s) => s.canvasLocked)
  const kinds = useGraphStore((s) => s.kinds)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const time = useGraphStore((s) => s.time)
  const setKinds = useGraphStore((s) => s.setKinds)
  const outflow = useSimStore((s) => s.boundaryOutflow)
  const outflowViews = useViewUnitsStore((s) => s.outflowViews)
  const setOutflowView = useViewUnitsStore((s) => s.setOutflowView)
  const reveal = useReveal()

  const rows = useMemo<ResourceKindDecl[]>(() => {
    const declared = new Set(kinds.map((k) => k.name))
    return [...kinds, ...named.filter((n) => !declared.has(n)).map((name) => ({ name, conserved: false }))]
  }, [kinds, named])
  const findings = useMemo(() => kindFindings(nodes, edges, kinds, modelVersion, time), [nodes, edges, kinds, modelVersion, time])
  const declOf = (name: string | null) => kinds.find((k) => k.name === name)
  const readingOf = (name: string | null): FieldUnit => {
    const decl = declOf(name)
    return decl ? outflowReading(outflowViews, decl, time) : { kind: 'base' }
  }
  // a select for each kind on a row that has more than one way to read it
  const outflowChoices = [...new Set(outflow.map((o) => o.kind))].flatMap((name) => {
    const decl = declOf(name)
    const options = decl ? outflowOptions(decl, time) : []
    return decl && options.length > 1 ? [{ decl, options }] : []
  })

  const update = (name: string, patch: { conserved?: boolean; baseUnit?: string; units?: UnitDecl[]; rateUnits?: RateUnitDecl[] }) => {
    const cur = kinds.find((k) => k.name === name) ?? { name, conserved: false }
    const next: ResourceKindDecl = { ...cur, ...patch }
    if (next.baseUnit !== undefined && next.baseUnit.trim() === '') delete next.baseUnit
    // loop-model/4 — an empty list is no key; a row with a unit list stays in the file
    if (next.units !== undefined && next.units.length === 0) delete next.units
    if (next.rateUnits !== undefined && next.rateUnits.length === 0) delete next.rateUnits
    const keep = next.conserved || next.baseUnit !== undefined || next.units !== undefined || next.rateUnits !== undefined
    const without = kinds.filter((k) => k.name !== name)
    if (!keep) return setKinds(without)
    setKinds(kinds.some((k) => k.name === name) ? kinds.map((k) => (k.name === name ? next : k)) : [...kinds, next])
  }

  return (
    <section className="mpanel mpanel--kinds">
      <PanelHead
        title={t('panels.kinds.title')}
        count={rows.length}
        open={open}
        onToggle={toggle}
        labelKey={{ collapse: 'panels.kinds.collapse', expand: 'panels.kinds.expand' }}
      />
      {open && (
        <div className="mpanel__body">
          {rows.length === 0 ? (
            <p className="mpanel__empty">{t('panels.empty.kinds')}</p>
          ) : (
            <ul className="mpanel__list">
              {rows.map((k) => (
                <li key={k.name} className="mp-row mp-row--kind">
                  <span className="mp-row__label mp-row__label--name mp-row__kind" dir="auto" title={k.name}>
                    {k.name}
                  </span>
                  <label className="mp-row__check">
                    <input
                      type="checkbox"
                      checked={k.conserved}
                      disabled={locked}
                      aria-label={t('panels.kinds.conservedFor', { kind: k.name })}
                      onChange={(e) => update(k.name, { conserved: e.target.checked })}
                    />
                    {t('panels.kinds.conserved')}
                  </label>
                  <UnitInput
                    value={k.baseUnit ?? ''}
                    label={t('panels.kinds.baseUnitFor', { kind: k.name })}
                    placeholder={t('panels.kinds.baseUnit')}
                    disabled={locked}
                    onCommit={(v) => update(k.name, { baseUnit: v })}
                  />
                  {/* loop-model/4 (§M4-1) — the kind's amount and rate units, as
                      one line; an entry the read drops disappears on commit */}
                  <UnitInput
                    value={unitListText(k.units, k.rateUnits)}
                    label={t('panels.kinds.unitsFor', { kind: k.name })}
                    placeholder={t('panels.kinds.units')}
                    disabled={locked}
                    onCommit={(v) => update(k.name, parseUnitListText(v, k.baseUnit))}
                  />
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && <p className="mpanel__empty">{t('panels.kinds.unitsHint')}</p>}
          {rows.length > 0 && <TimeSection nodes={nodes} edges={edges} />}
          {findings.length > 0 && (
            <>
              <h3 className="mpanel__sub">{t('panels.kinds.findings')}</h3>
              <ul className="mpanel__list mpanel__list--findings">
                {findings.map((f, i) => {
                  const nodeId = kindFindingNodeId(f)
                  const edgeId = kindFindingEdgeId(f)
                  return (
                    <li key={i} className={`mp-row mp-row--finding${f.refuses ? ' mp-row--refuses' : ''}`}>
                      <button type="button" className="mp-row__label mp-row__finding" onClick={() => reveal(nodeId, nodeId ? null : edgeId)}>
                        <KindFindingText f={f} nodes={nodes} edges={edges} />
                      </button>
                      {f.refuses && <span className="mp-row__badge">{t('panels.kinds.refuses')}</span>}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {outflow.length > 0 && (
            <>
              <h3 className="mpanel__sub">{t('panels.kinds.outflow')}</h3>
              {/* reading a number is not an edit, so the edit lock leaves this on */}
              {outflowChoices.map(({ decl, options }) => (
                <label key={decl.name} className="mp-row mp-row--reading">
                  <span className="mp-row__kind" dir="auto" title={decl.name}>
                    {decl.name}
                  </span>
                  <select
                    className="mp-row__reading"
                    aria-label={t('panels.kinds.outflow.unitFor', { kind: decl.name })}
                    value={fieldUnitText(readingOf(decl.name))}
                    onChange={(e) => setOutflowView(decl.name, e.target.value)}
                  >
                    {options.map((fu) => (
                      <option key={fieldUnitText(fu)} value={fieldUnitText(fu)}>
                        {unitOptionLabel(t, fu, decl, 'rate')}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <ul className="mpanel__list mpanel__list--outflow">
                {outflow.map((o) => (
                  <li key={`${o.kind ?? ''}\u0001${o.nodeId}`} className="mp-row mp-row--outflow">
                    <button type="button" className="mp-row__label" onClick={() => reveal(o.nodeId, null)}>
                      {t('panels.kinds.outflow.row', {
                        kind: isolateAuto(o.kind ?? t('panels.kinds.outflow.noKind')),
                        node: isolateAuto(labelOf(nodes.find((n) => n.id === o.nodeId)) || o.nodeId),
                        amount: outflowAmount(t, o, readingOf(o.kind), declOf(o.kind), time),
                      })}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** The panels. Renders nothing when the graph has no `parameter`, no
 *  `register` node (§MS5.3) and names no kind (loop-model/3). Desktop only —
 *  mounted by `DesktopInspector`. */
export function ModelPanels() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const declaredKinds = useGraphStore((s) => s.kinds)

  const params = useMemo(() => nodes.filter((n) => kindOf(n) === 'parameter').sort(byId), [nodes])
  const registers = useMemo(() => nodes.filter((n) => kindOf(n) === 'register').sort(byId), [nodes])
  const named = useMemo(() => namedKinds(nodes, edges), [nodes, edges])
  const hasKinds = named.length > 0 || declaredKinds.length > 0
  const paramFlowEdges = useMemo(() => {
    if (!hasModelLayer(modelVersion)) return []
    return edges
      .filter((e) => {
        const f = (e.data as { flow?: unknown } | undefined)?.flow
        return kindOf(e) === 'resource' && typeof f === 'string' && f.trimStart().startsWith('@')
      })
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        flow: String((e.data as { flow: string }).flow),
      }))
      .sort(byId)
  }, [edges, modelVersion])

  if (params.length === 0 && registers.length === 0 && !hasKinds && !anyRunRule(nodes)) return null

  return (
    <div className="mpanels">
      {(params.length > 0 || registers.length > 0) && <InputsSection params={params} paramFlowEdges={paramFlowEdges} nodes={nodes} />}
      {hasKinds && <KindsSection nodes={nodes} edges={edges} named={named} />}
      <TimetablesSection nodes={nodes} edges={edges} />
      <RunRulesSection nodes={nodes} edges={edges} />
      {(params.length > 0 || registers.length > 0) && <SummarySection registers={registers} />}
    </div>
  )
}
