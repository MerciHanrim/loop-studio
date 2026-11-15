import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { selectOnly, selectSelectedNodeCount, useGraphStore } from '../../store/graphStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { useT, type MessageKey } from '../../i18n'
import { isolateAuto } from '../../i18n/bidiIsolate'
import { Icon } from '../../ui/icons'
import { readParameterData } from '../../model/model'
import { connectKindOf } from '../../model/connectKind'
import type { LoopEdge, LoopEdgeData, LoopNode, PoolData } from '../../model/types'
import { CONNECT_LABEL } from '../connectKindWords'
import { usePoolAmount } from '../usePoolAmount'

// docs/mobile.md §MV5b — the phone's SELECTION PANEL (2026-11-15).
//
// A selection used to bring the whole read-only Inspector sheet up by itself.
// The sheet's scrim then lay over the top bar's More button, and the sheet
// over the canvas rail (Zoom in, Zoom out, Reset view): More took two taps and
// the first threw the selection away, and the canvas could not be zoomed or
// fitted with something selected. Now a selection brings this panel: one row
// above the run bar, no scrim, no focus move. It says what is selected (its
// name; its kind and the one value the Inspector reads out for it) and has
// two buttons: Details, which opens the read-only sheet on request, and
// Deselect. The sheet's Close comes back here with the selection kept.
//
// It is not a dialog and takes no focus: the canvas, the rail, the top bar and
// the run bar stay in use around it. A sheet opened over it covers it, so it
// is one of the elements a sheet makes inert (`data-covered-by-sheets`,
// src/ui/overlayStack.ts).

/** how far the canvas rail's bottom edge stands above the canvas pane's (issue: the rail above the panel) */
export const RAIL_LIFT_VAR = '--mob-rail-lift'
/** the rail stands this far above the panel's top edge */
const RAIL_GAP_PX = 8

/**
 * The rail is lifted clear of the panel: its bottom margin becomes the
 * distance from the canvas pane's bottom edge up to the panel's top edge, plus
 * 8 px. MEASURED, not assumed: the panel is fixed above the run bar, whose
 * height changes with the language and the width (`--mob-runbar-real`), and
 * the room the canvas leaves under itself is the layout's business. Without a
 * panel the variable is absent and the rail keeps the margin it had.
 */
function useRailLift(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!active || !el) {
      root.style.removeProperty(RAIL_LIFT_VAR)
      return
    }
    const write = () => {
      const pane = document.querySelector('.react-flow')
      if (!pane) return
      const lift = Math.max(0, pane.getBoundingClientRect().bottom - el.getBoundingClientRect().top)
      root.style.setProperty(RAIL_LIFT_VAR, `${Math.ceil(lift) + RAIL_GAP_PX}px`)
    }
    write()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(write) : null
    ro?.observe(el)
    // the panel moves without changing size when the run bar under it grows a row
    const bar = document.querySelector('.pstrip--mobile')
    if (bar) ro?.observe(bar)
    const pane = document.querySelector('.react-flow')
    if (pane) ro?.observe(pane)
    window.addEventListener('resize', write)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', write)
      root.style.removeProperty(RAIL_LIFT_VAR)
    }
  }, [ref, active])
}

/** how much of a tapped node's symbol shows above the panel after the canvas was moved for it */
const NODE_SHOWN_PX = 8

/**
 * A tapped node that the panel covers COMPLETELY is brought up (2026-11-15).
 *
 * Selecting does not move the canvas: a node partly under the panel stays
 * where it is. But a node low on the canvas can be wholly inside the strip the
 * panel takes; MEASURED on a phone held sideways after Reset view: the fitted
 * diagram's bottom row (the Risky Factory's Salvage Drain; 11 to 12 of the
 * Early MMO's 97 nodes). It was on screen, it is tapped, and it is gone. Only
 * then the canvas moves: UP only, by just enough for 8 px of the node's symbol
 * to show above the panel. The zoom and the sideways position are kept.
 *
 * Only for ONE node newly selected while the phone layout is up (a tap). Not
 * for a connection or several nodes, and not for a selection that was already
 * there when the phone layout came up (a width change, docs/mobile.md §MV3c).
 */
function useBringUpCoveredNode(ref: RefObject<HTMLElement | null>, isMobile: boolean, nodeId: string | null): void {
  const { getViewport, setViewport } = useReactFlow()
  const before = useRef<{ mobile: boolean; nodeId: string | null } | null>(null)
  useLayoutEffect(() => {
    const was = before.current
    before.current = { mobile: isMobile, nodeId }
    // a node newly selected, in a phone layout that was already up
    if (!was || !was.mobile || !isMobile || nodeId === null || nodeId === was.nodeId) return
    const panel = ref.current
    const pane = document.querySelector('.react-flow')
    const nodeEl = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    if (!panel || !pane || !nodeEl) return
    const sym = (nodeEl.querySelector('.nodef__stroke') ?? nodeEl).getBoundingClientRect()
    const top = panel.getBoundingClientRect().top
    // wholly under the panel, and on the canvas (it could be tapped)
    if (sym.top < top || sym.top >= pane.getBoundingClientRect().bottom) return
    const v = getViewport()
    setViewport({ x: v.x, y: v.y - (sym.top - (top - NODE_SHOWN_PX)), zoom: v.zoom }, { duration: 0 })
  }, [ref, isMobile, nodeId, getViewport, setViewport])
}

/** one labelled value, as the Inspector labels it. `label` is left out where
 *  the kind beside it already says the same word (a resource line's kind and
 *  its field are both "Flow" in English). */
function Fact({ label, value }: { label: string | null; value: string }) {
  return (
    <span className="selpanel__fact">
      {label !== null && <span className="selpanel__fact-label">{label}</span>}
      {/* a number, a unit, an expression: left to right in every language (§L9.3) */}
      <bdi className="selpanel__fact-value" dir="ltr">{value}</bdi>
    </span>
  )
}

/** a Pool's current amount: the Inspector's own "Current amount" reading */
function PoolFact({ id, d }: { id: string; d: PoolData }) {
  const t = useT()
  const { shownText } = usePoolAmount(id, d)
  return <Fact label={t('inspector.field.currentAmount')} value={shownText} />
}

/** the kind and, where the Inspector reads ONE value out for the kind, that
 *  value. A Pool: its current amount. A Parameter: its value (and unit). The
 *  other kinds have no single value, and none is made up for them. */
function NodeSummary({ node }: { node: LoopNode }) {
  const t = useT()
  const d = node.data as { kind?: unknown; label?: unknown } | undefined
  const kind = d && typeof d === 'object' && typeof d.kind === 'string' ? d.kind : null
  const param = kind === 'parameter' ? readParameterData(node.data) : null
  return (
    <>
      <span className="selpanel__kind" data-kind={kind ?? undefined}>
        {kind ? t(`canvas.nodeKind.${kind}` as MessageKey) : 'node'}
      </span>
      {kind === 'pool' && <PoolFact id={node.id} d={node.data as PoolData} />}
      {param?.ok && (
        <Fact
          label={t('inspector.field.value')}
          value={`${(node.data as { value: number }).value}${typeof (node.data as { unit?: unknown }).unit === 'string' && (node.data as { unit: string }).unit ? ` ${(node.data as { unit: string }).unit}` : ''}`}
        />
      )}
    </>
  )
}

/** a connection: what it does (its kind, in the Inspector's words) and, for a
 *  resource line, its Flow as written */
function EdgeSummary({ edge }: { edge: LoopEdge }) {
  const t = useT()
  const ed = (edge.data as LoopEdgeData | undefined) ?? { kind: 'resource', flow: '1' }
  const kind = connectKindOf(edge)
  const kindText = kind ? t(CONNECT_LABEL[kind]) : t('inspector.edge.kindLink', { kind: ed.kind })
  const flowLabel = t('inspector.field.flow')
  // "Flow" as the kind and "Flow" as the field's label read as one word said twice
  const sameWord = kindText.trim().toLocaleLowerCase() === flowLabel.trim().toLocaleLowerCase()
  return (
    <>
      <span className="selpanel__kind" data-connect-kind={kind ?? undefined}>
        {kindText}
      </span>
      {ed.kind === 'resource' && typeof ed.flow === 'string' && ed.flow !== '' && <Fact label={sameWord ? null : flowLabel} value={ed.flow} />}
    </>
  )
}

const labelOf = (n: LoopNode | undefined, fallback: string): string => {
  const l = (n?.data as { label?: unknown } | undefined)?.label
  return typeof l === 'string' && l.trim() ? l : fallback
}

export function MobileSelectionPanel() {
  const t = useT()
  const isMobile = useIsMobile()
  const overlay = useUiStore(selectOverlay)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const count = useGraphStore(selectSelectedNodeCount)
  const node = nodes.find((n) => n.id === selectedNodeId)
  const edge = node ? undefined : edges.find((e) => e.id === selectedEdgeId)
  const shown = isMobile && (node != null || edge != null)
  const many = node != null && count >= 2
  const ref = useRef<HTMLElement>(null)
  useRailLift(ref, shown)
  useBringUpCoveredNode(ref, isMobile, node && !many ? node.id : null)
  if (!shown) return null

  // the name line: the node's own name; a connection by its two ends; several
  // nodes by their count (the sheet behind Details shows ONE of them, named
  // on the line under it)
  const name = many
    ? t('canvas.regionSelect.count', { n: count })
    : node
      ? labelOf(node, node.id)
      : t('inspector.ends.summary', {
          // the user's own names, each in its own direction inside the sentence (§L9.4)
          from: isolateAuto(labelOf(nodes.find((n) => n.id === edge!.source), edge!.source)),
          to: isolateAuto(labelOf(nodes.find((n) => n.id === edge!.target), edge!.target)),
        })

  return (
    <section ref={ref} className="selpanel" aria-label={t('mobile.selection.label')} data-covered-by-sheets="">
      {/* said, not focused: a new selection is announced, and focus stays where it was */}
      <div className="selpanel__text" role="status">
        <b className="selpanel__name" dir="auto">{name}</b>
        <span className="selpanel__sub">
          {many ? (
            <span className="selpanel__anchor" dir="auto">{t('mobile.selection.anchor', { name: isolateAuto(labelOf(node, node!.id)) })}</span>
          ) : node ? (
            <NodeSummary node={node} />
          ) : (
            <EdgeSummary edge={edge!} />
          )}
        </span>
      </div>
      <button
        type="button"
        className="btn selpanel__details"
        aria-haspopup="dialog"
        aria-expanded={overlay === 'inspector'}
        onClick={() => openOverlay('inspector')}
      >
        {t('mobile.selection.details')}
      </button>
      <button type="button" className="btn selpanel__x" aria-label={t('mobile.selection.deselect')} title={t('mobile.selection.deselect')} onClick={() => selectOnly({})}>
        <Icon name="close" />
      </button>
    </section>
  )
}
