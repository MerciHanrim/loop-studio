import { useCallback } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { useUiStore } from '../../store/uiStore'
import { useT } from '../../i18n'
import { useIsMobile } from '../../ui/media'
import { Icon } from '../../ui/icons'
import { useFitAll } from '../useFitAll'
import { connectReasonText } from '../connectReason'
import { focusInto, PANEL_ID, TOGGLE_ID, useWorkbenchPanels, type Side } from './panelLayout'
import './workbench.css'

// The workbench redesign (2026-10), step 5 — the STATUS bar under everything:
// what the document holds (node and connection counts), and the view controls
// that belong to the canvas as a whole — Focus, zoom out / the zoom / zoom in,
// and Fit (the canvas's own whole-diagram fit, ../useFitAll). At its two ends
// the side panels' open / fold (./panelLayout). Desktop only.

export function StatusBar() {
  const t = useT()
  const isMobile = useIsMobile()
  const nodes = useGraphStore((s) => s.nodes.length)
  const edges = useGraphStore((s) => s.edges.length)
  const focusMode = useUiStore((s) => s.focusMode)
  const toggleFocusMode = useUiStore((s) => s.toggleFocusMode)
  const zoom = useStore((s) => s.transform[2])
  // a drawing the chosen connection kind refused: its reason (direction B)
  const refusal = useUiStore((s) => s.connectRefusal)
  const allNodes = useGraphStore((s) => s.nodes)
  const { zoomIn, zoomOut } = useReactFlow()
  const fitAll = useFitAll(useCallback(() => document.querySelector<HTMLElement>('.canvas'), []))
  const panels = useWorkbenchPanels()
  if (isMobile) return null
  /** a side panel's open / fold — a disclosure of the panel it names */
  const toggle = (side: Side) => {
    const open = side === 'left' ? panels.leftOpen : panels.rightOpen
    return (
      <button
        type="button"
        id={TOGGLE_ID[side]}
        className={`wb-zb wb-panel-toggle${open ? ' is-on' : ''}`}
        data-panel-toggle={side}
        aria-expanded={open}
        aria-controls={PANEL_ID[side]}
        title={t(open ? (side === 'left' ? 'workbench.panel.leftHide' : 'workbench.panel.rightHide') : side === 'left' ? 'workbench.panel.leftShow' : 'workbench.panel.rightShow')}
        onClick={() => {
          panels.toggle(side)
          if (!open && panels.overlay) focusInto(side)
        }}
      >
        <span className="wb-zb__word">{t(side === 'left' ? 'workbench.panel.left' : 'workbench.panel.right')}</span>
      </button>
    )
  }
  return (
    <footer className="wb-status" aria-label={t('workbench.status.label')}>
      {toggle('left')}
      <span className="wb-sep" aria-hidden="true" />
      <span className="wb-status__counts">{t('workbench.status.counts', { nodes, edges })}</span>
      <span className="wb-status__msg" role="status">
        {refusal ? connectReasonText(t, refusal, allNodes) : ''}
      </span>
      <span className="wb-status__end">
        <button
          type="button"
          className={`wb-zb${focusMode ? ' is-on' : ''}`}
          aria-pressed={focusMode}
          title={focusMode ? t('canvas.focus.off') : t('canvas.focus.on')}
          onClick={toggleFocusMode}
        >
          <Icon name="focus" />
          <span className="wb-zb__word">{t('workbench.focus')}</span>
        </button>
        <span className="wb-sep" aria-hidden="true" />
        <button type="button" className="wb-zb" aria-label={t('workbench.zoom.out')} title={t('workbench.zoom.out')} onClick={() => void zoomOut({ duration: 0 })}>
          <Icon name="minus" />
        </button>
        <span className="wb-zoom" role="status" aria-label={t('workbench.zoom.level')} dir="ltr">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="wb-zb" aria-label={t('workbench.zoom.in')} title={t('workbench.zoom.in')} onClick={() => void zoomIn({ duration: 0 })}>
          <Icon name="plus" />
        </button>
        <button type="button" className="wb-zb" aria-label={t('workbench.zoom.fit')} title={t('workbench.zoom.fit')} onClick={() => void fitAll()}>
          <Icon name="fit" />
        </button>
        <span className="wb-sep" aria-hidden="true" />
        {toggle('right')}
      </span>
    </footer>
  )
}
