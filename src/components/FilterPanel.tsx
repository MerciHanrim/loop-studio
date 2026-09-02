import { Panel } from '@xyflow/react'
import { useT, type MessageKey } from '../i18n'
import type { NodeKind } from '../model/types'
import {
  EDGE_CLASSES,
  NODE_KINDS,
  UNTYPED,
  filtersActive,
  useFilterStore,
  type EdgeClass,
} from '../store/filterStore'
import { useUiStore } from '../store/uiStore'
import { useGraphResourceTypes, useHiddenSet } from './filterSet'

// literal MessageKey maps (dynamic `t(\`…${k}\`)` is invisible to check-i18n)
const EDGE_CLASS_LABEL: Record<EdgeClass, MessageKey> = {
  resource: 'canvas.filter.edgeClass.resource',
  state: 'canvas.filter.edgeClass.state',
}
const NODE_KIND_LABEL: Record<NodeKind, MessageKey> = {
  source: 'canvas.nodeKind.source',
  pool: 'canvas.nodeKind.pool',
  gate: 'canvas.nodeKind.gate',
  converter: 'canvas.nodeKind.converter',
  drain: 'canvas.nodeKind.drain',
  end: 'canvas.nodeKind.end',
  parameter: 'canvas.nodeKind.parameter',
  register: 'canvas.nodeKind.register',
}

// docs/large-graph-readability.md §LGR3.2 — the transient-filter controls: three
// grouped checkbox lists (checked = hidden) + Clear + a hidden count. Rendered
// inside a React Flow Panel on desktop (`FilterPanel`) and inline in the mobile
// More sheet (`FilterControls`). Ephemeral — nothing here is serialized, undone,
// or persisted (the panel open/closed state lives in `uiStore`).

function Row({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label className="lgr-filter__row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

export function FilterControls() {
  const t = useT()
  const resourceTypes = useGraphResourceTypes()
  const hidden = useHiddenSet()
  const hiddenEdgeClasses = useFilterStore((s) => s.hiddenEdgeClasses)
  const hiddenResourceTypes = useFilterStore((s) => s.hiddenResourceTypes)
  const hiddenNodeKinds = useFilterStore((s) => s.hiddenNodeKinds)
  const toggleEdgeClass = useFilterStore((s) => s.toggleEdgeClass)
  const toggleResourceType = useFilterStore((s) => s.toggleResourceType)
  const toggleNodeKind = useFilterStore((s) => s.toggleNodeKind)
  const clear = useFilterStore((s) => s.clear)
  const active = useFilterStore(filtersActive)

  const hiddenCount = (hidden?.nodes.size ?? 0) + (hidden?.edges.size ?? 0)

  return (
    <div className="lgr-filter__body">
      <p className="lgr-filter__hint">{t('canvas.filter.checkboxHint')}</p>

      <fieldset className="lgr-filter__group">
        <legend>{t('canvas.filter.groupEdgeClass')}</legend>
        {EDGE_CLASSES.map((c) => (
          <Row
            key={c}
            checked={hiddenEdgeClasses.has(c)}
            label={t(EDGE_CLASS_LABEL[c])}
            onChange={() => toggleEdgeClass(c)}
          />
        ))}
      </fieldset>

      <fieldset className="lgr-filter__group">
        <legend>{t('canvas.filter.groupResourceType')}</legend>
        {resourceTypes.map((rt) => (
          <Row
            key={rt}
            checked={hiddenResourceTypes.has(rt)}
            label={rt}
            onChange={() => toggleResourceType(rt)}
          />
        ))}
        <Row
          checked={hiddenResourceTypes.has(UNTYPED)}
          label={t('canvas.filter.untyped')}
          onChange={() => toggleResourceType(UNTYPED)}
        />
      </fieldset>

      <fieldset className="lgr-filter__group">
        <legend>{t('canvas.filter.groupNodeKind')}</legend>
        {NODE_KINDS.map((k) => (
          <Row
            key={k}
            checked={hiddenNodeKinds.has(k)}
            label={t(NODE_KIND_LABEL[k])}
            onChange={() => toggleNodeKind(k)}
          />
        ))}
      </fieldset>

      <div className="lgr-filter__foot">
        <span className="lgr-filter__count">
          {hiddenCount > 0
            ? t('canvas.filter.hiddenCount', { n: hiddenCount })
            : t('canvas.filter.none')}
        </span>
        <button
          type="button"
          className="btn lgr-filter__clear"
          onClick={clear}
          disabled={!active}
        >
          {t('canvas.filter.clear')}
        </button>
      </div>
    </div>
  )
}

/** Desktop — the filter panel as a React Flow top-left Panel. */
export function FilterPanel() {
  const t = useT()
  const setFilterPanelOpen = useUiStore((s) => s.setFilterPanelOpen)
  return (
    <Panel position="top-left" className="lgr-filter">
      <div className="lgr-filter__head">
        <span className="lgr-filter__title">{t('canvas.filter.title')}</span>
        <button
          type="button"
          className="lgr-filter__x"
          aria-label={t('canvas.filter.close')}
          onClick={() => setFilterPanelOpen(false)}
        >
          ×
        </button>
      </div>
      <FilterControls />
    </Panel>
  )
}
