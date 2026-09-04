import { useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { parse, parseExpr, refsOf } from '../model/expr'
import { formatRegisterValue, readParameterData, readRegisterData } from '../model/model'
import type { RegisterOutcome } from '../model/model'
import type { LoopNode } from '../model/types'
import { useGraphStore } from '../store/graphStore'
import { useRegisterOutcomes } from '../store/registers'
import { useSimStore } from '../store/simStore'
import { useUiStore } from '../store/uiStore'
import { useT, type MessageKey } from '../i18n'

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

/** select a node / edge and centre the canvas on it (read-through — §MS5.1). */
function useReveal(): (nodeId: string | null, edgeId: string | null) => void {
  const setSelection = useGraphStore((s) => s.setSelection)
  const nodes = useGraphStore((s) => s.nodes)
  const { setCenter, setNodes } = useReactFlow()
  return (nodeId, edgeId) => {
    setSelection(nodeId, edgeId)
    // mirror the click-selection ring on the canvas (same pattern as the mobile
    // Inspector sheet's dismiss)
    setNodes((ns) =>
      ns.map((n) => (n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId })),
    )
    const n = nodeId ? nodes.find((x) => x.id === nodeId) : null
    if (n) {
      const m = (n as { measured?: { width?: number; height?: number } }).measured
      void setCenter(n.position.x + (m?.width ?? 0) / 2, n.position.y + (m?.height ?? 0) / 2, {
        duration: 250,
      })
    }
  }
}

function PanelHead({
  title,
  count,
  open,
  onToggle,
  labelKey,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  labelKey: { collapse: MessageKey; expand: MessageKey }
}) {
  const t = useT()
  return (
    <h2 className="mpanel__head">
      <button
        type="button"
        className="mpanel__toggle"
        aria-expanded={open}
        aria-label={open ? t(labelKey.collapse) : t(labelKey.expand)}
        onClick={onToggle}
      >
        <span className="mpanel__caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span className="mpanel__count">{count}</span>
      </button>
    </h2>
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
                const value = read.ok ? read.data.value : typeof raw === 'number' ? raw : ''
                return (
                  <li key={n.id} className="mp-row">
                    <button
                      type="button"
                      className="mp-row__label"
                      title={t('panels.inputs.reveal')}
                      onClick={() => reveal(n.id, null)}
                    >
                      {label}
                    </button>
                    <input
                      type="number"
                      className="mp-row__val"
                      aria-label={t('panels.inputs.paramValue', { label })}
                      value={value}
                      disabled={locked}
                      onChange={(e) => updateNodeData(n.id, { value: Number(e.target.value) })}
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
                return (
                  <li key={e.id} className="mp-row mp-row--flow">
                    <button
                      type="button"
                      className="mp-row__label"
                      title={t('panels.inputs.reveal')}
                      onClick={() => reveal(null, e.id)}
                    >
                      {labelOf(nodes.find((n) => n.id === e.source))} →{' '}
                      {labelOf(nodes.find((n) => n.id === e.target))}
                    </button>
                    <span className="mp-row__via">{t('panels.inputs.flowVia', { param })}</span>
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
  onReveal,
}: {
  node: LoopNode
  outcome: RegisterOutcome | undefined
  step: number
  onReveal: () => void
}) {
  const t = useT()
  const [showCalc, setShowCalc] = useState(false)
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
        <button type="button" className="mp-row__label" title={t('panels.inputs.reveal')} onClick={onReveal}>
          {label}
        </button>
        <span className={`mp-row__val${!outcome || outcome.invalid ? ' mp-row__val--invalid' : ''}`}>
          {!outcome || outcome.invalid
            ? t('panels.summary.noValue', { step })
            : `${formatRegisterValue(outcome.value, format)}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      <div className="mp-row__calc">
        <button
          type="button"
          className="mp-row__calcbtn"
          aria-expanded={showCalc}
          onClick={() => setShowCalc((v) => !v)}
        >
          {t(showCalc ? 'panels.summary.hideCalc' : 'panels.summary.showCalc')}
        </button>
        {showCalc && <code className="mp-row__expr">{shownExpr}</code>}
      </div>
      {outcome && outcome.invalid && <span className="mp-row__code">{outcome.code}</span>}
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

  return (
    <section className="mpanel">
      <PanelHead
        title={t('panels.summary.title')}
        count={registers.length}
        open={open}
        onToggle={toggle}
        labelKey={{ collapse: 'panels.summary.collapse', expand: 'panels.summary.expand' }}
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

/** The two panels. Renders nothing when the graph has no `parameter` and no
 *  `register` node (§MS5.3). Desktop only — mounted by `DesktopInspector`. */
export function ModelPanels() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const modelVersion = useGraphStore((s) => s.modelVersion)

  const params = useMemo(() => nodes.filter((n) => kindOf(n) === 'parameter').sort(byId), [nodes])
  const registers = useMemo(() => nodes.filter((n) => kindOf(n) === 'register').sort(byId), [nodes])
  const paramFlowEdges = useMemo(() => {
    if (modelVersion !== 2) return []
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

  if (params.length === 0 && registers.length === 0) return null

  return (
    <div className="mpanels">
      <InputsSection params={params} paramFlowEdges={paramFlowEdges} nodes={nodes} />
      <SummarySection registers={registers} />
    </div>
  )
}
