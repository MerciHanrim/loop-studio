import { useId, useMemo, useState } from 'react'
import type { NodeData, NodeKind } from '../../model/types'
import { useGraphStore } from '../../store/graphStore'
import { useSimStore } from '../../store/simStore'
import { useT, type MessageKey } from '../../i18n'
import { useIsMobile } from '../../ui/media'
import { Icon } from '../../ui/icons'
import { ModelPanels, useReveal } from '../ModelPanels'
import { KindIcon } from '../nodes/KindIcon'
import { onOverlayKey, PANEL_ID, useWorkbenchPanels } from './panelLayout'
import './workbench.css'

// The workbench redesign (2026-10), step 5 — the LEFT panel: what the model
// holds and where (share notes 75 / 94, `workbench-free3`). Two tabs:
//   • Model  — every node, grouped by kind with a count, found by name; a row
//              selects its node and, only if it is not in view, brings it in
//              by the least move at the current zoom (`useReveal` minimal),
//              and follows the canvas selection.
//   • Inputs — the Inputs and Summary panels (ModelPanels), moved here from
//              the right column, so the right panel is the selection's alone.
// Desktop only; the phone keeps its own layout.

/** the list's kind order (the mock-up's, with Drain, which it omitted) */
const KIND_ORDER: readonly NodeKind[] = ['parameter', 'source', 'pool', 'gate', 'converter', 'drain', 'end', 'register']

const labelOf = (n: { id: string; data?: unknown }): string =>
  ((n.data as { label?: unknown } | undefined)?.label as string | undefined) || n.id

/** the search's comparison: case and runs of white space ignored */
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()

/** a node kind's symbol, small: the same mark as the tool row's Add button */
function KindMark({ kind }: { kind: NodeKind }) {
  return <KindIcon kind={kind} className="wb-kindmark" />
}

/** the row's value, Parameters and Pools only (2026-10-25, Lumi's v6 study):
 *  the Parameter's value, the Pool's run value or its start — the number its
 *  node shows, in the node's format. One subscription per row, so a run step
 *  re-renders the values, not the list. */
const fmtValue = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
function RowValue({ id, data }: { id: string; data: NodeData }) {
  const live = useSimStore((s) => (data.kind === 'pool' && s.values ? s.values[id] : undefined))
  const v = data.kind === 'parameter' ? data.value : data.kind === 'pool' ? (live ?? data.initial) : undefined
  if (v === undefined || !Number.isFinite(v)) return null
  const text = fmtValue(v)
  // the comma is heard, not seen: the row's name reads "name, value", the
  // whole value even where the row shows it cut short
  return (
    <>
      <span className="sr-only">, </span>
      <span className="wb-row__val" dir="ltr" title={text}>
        {text}
      </span>
    </>
  )
}

export function LeftPanel() {
  const t = useT()
  const isMobile = useIsMobile()
  const nodes = useGraphStore((s) => s.nodes)
  const selectedId = useGraphStore((s) => s.selectedNodeId)
  // a row brings its node into view only if it is not there already, by the
  // least move at the current zoom (Lumi, 2026-10-19)
  const reveal = useReveal()
  const [tab, setTab] = useState<'model' | 'inputs'>('model')
  const [query, setQuery] = useState('')
  const ids = useId()
  // folded, it stays mounted (its search and tab are kept) and hidden
  // (./panelLayout: the width band's default, or the user's choice)
  const { leftOpen, overlay, close } = useWorkbenchPanels()

  const groups = useMemo(() => {
    const q = norm(query)
    const shown = nodes.filter((n) => !q || norm(labelOf(n)).includes(q))
    return {
      shown: shown.length,
      byKind: KIND_ORDER.map((k) => ({ kind: k, rows: shown.filter((n) => n.type === k) })).filter((g) => g.rows.length > 0),
    }
  }, [nodes, query])

  if (isMobile) return null
  const tabId = (k: 'model' | 'inputs') => `${ids}-tab-${k}`
  const panelId = (k: 'model' | 'inputs') => `${ids}-panel-${k}`
  return (
    <aside
      id={PANEL_ID.left}
      className={`wb-left${overlay ? ' is-overlay' : ''}`}
      aria-label={t('workbench.left.label')}
      data-tour="model-list"
      hidden={!leftOpen}
      onKeyDown={overlay ? (e) => onOverlayKey(e, 'left', close) : undefined}
    >
      <div className="wb-tabs" role="tablist" aria-label={t('workbench.left.label')}>
        {(['model', 'inputs'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={tabId(k)}
            aria-selected={tab === k}
            aria-controls={panelId(k)}
            tabIndex={tab === k ? 0 : -1}
            className={`wb-tab${tab === k ? ' is-on' : ''}`}
            onClick={() => setTab(k)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const next = k === 'model' ? 'inputs' : 'model'
              setTab(next)
              document.getElementById(tabId(next))?.focus()
            }}
          >
            {t(k === 'model' ? 'workbench.tab.model' : 'workbench.tab.inputs')}
          </button>
        ))}
      </div>
      {tab === 'model' ? (
        <div className="wb-left__body" role="tabpanel" id={panelId('model')} aria-labelledby={tabId('model')}>
          <label className="wb-search">
            <Icon name="search" />
            <input
              type="search"
              // a node's name in whatever script it is written
              dir="auto"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workbench.find.placeholder')}
              aria-label={t('workbench.find.label')}
              autoComplete="off"
            />
          </label>
          <div className="wb-list">
            <div className="wb-list__head">
              <span>{t('workbench.tab.model')}</span>
              <span className="wb-list__count" dir="ltr">
                {query ? `${groups.shown} / ${nodes.length}` : nodes.length}
              </span>
            </div>
            {groups.byKind.length === 0 ? (
              <p className="wb-list__none">{nodes.length === 0 ? t('workbench.list.empty') : t('workbench.find.none')}</p>
            ) : (
              groups.byKind.map((g) => (
                <div key={g.kind} className="wb-list__group" role="group" aria-label={t(`canvas.nodeKind.${g.kind}` as MessageKey)}>
                  <div className="wb-list__sub" aria-hidden="true">
                    {t(`canvas.nodeKind.${g.kind}` as MessageKey)}{' '}
                    <span className="wb-list__subcount" dir="ltr">
                      {g.rows.length}
                    </span>
                  </div>
                  {g.rows.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={`wb-row${n.id === selectedId ? ' is-sel' : ''}`}
                      data-node={n.id}
                      aria-pressed={n.id === selectedId}
                      title={labelOf(n)}
                      onClick={() => reveal(n.id, null)}
                    >
                      <KindMark kind={n.type as NodeKind} />
                      <span className="wb-row__name" dir="auto">
                        {labelOf(n)}
                      </span>
                      <RowValue id={n.id} data={n.data as NodeData} />
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="wb-left__body wb-left__body--inputs" role="tabpanel" id={panelId('inputs')} aria-labelledby={tabId('inputs')}>
          {nodes.some((n) => n.type === 'parameter' || n.type === 'register') ? (
            <ModelPanels />
          ) : (
            <p className="wb-list__none">{t('panels.empty.inputs')}</p>
          )}
        </div>
      )}
    </aside>
  )
}
