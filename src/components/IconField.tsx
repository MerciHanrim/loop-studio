import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useT } from '../i18n'
import { NODE_ICON_IDS, NODE_ICON_KINDS, readIcon, type NodeIconId } from '../model/model'
import { accentTargets, useGraphStore } from '../store/graphStore'
import { useIsMobile } from '../ui/media'
import { NodeIcon } from './nodes/NodeIcon'
import { nodeIconNameKey } from './nodes/nodeIconMeta'

// SEMANTICS-R12.md — the Inspector's Icon field, shown for the six flow kinds.
//
// It applies to every flow node React Flow marks `selected`, or to the one node
// the Inspector shows when none is marked (`accentTargets`, the Colour
// section's own rule); a Parameter or Register in the selection is left alone.
// One choice is one `setIcon` call: one undo entry, never a simulation change.
//
// A button shows the current icon (or "None", or "Mixed" for a selection that
// differs) and opens the gallery below it. The gallery is one `role="radiogroup"`
// named "Icon": "None" first, then the icons under their group headings; each
// option is a `role="radio"` button named by the icon's localized name (ids never
// show). Keys: Enter / Space on the button opens with focus on the current
// option (a roving tabindex); arrows move (the list is linear, so Right / Down
// go on and Left / Up go back), Home / End jump; Enter / Space chooses and closes
// with focus back on the button; Escape closes without a change. The choice
// applies on selection.
//
// On the phone the Inspector is a read-only sheet (docs/mobile.md MV-D3): the
// field is one line of read-only text there, the mark and its name.

/** the picker's groups, in order (Lumi's first list of 14) */
const GROUPS: readonly { key: 'inspector.icon.group.nature' | 'inspector.icon.group.industry'; ids: readonly NodeIconId[] }[] = [
  { key: 'inspector.icon.group.nature', ids: NODE_ICON_IDS.slice(0, 9) },
  { key: 'inspector.icon.group.industry', ids: NODE_ICON_IDS.slice(9) },
]

export function IconField() {
  const t = useT()
  const ids = useId()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const setIcon = useGraphStore((s) => s.setIcon)
  const isMobile = useIsMobile()

  const targetIds = useMemo(
    () => accentTargets({ nodes, edges, selectedNodeId, selectedEdgeId }).nodeIds,
    [nodes, edges, selectedNodeId, selectedEdgeId],
  )
  const targets = useMemo(() => {
    const set = new Set(targetIds)
    return nodes.filter((n) => set.has(n.id) && NODE_ICON_KINDS.has(n.data.kind))
  }, [nodes, targetIds])

  // the selection's icon: one value (an id, or `null` for none) or mixed
  const current = useMemo(() => {
    const values = new Set<NodeIconId | null>()
    for (const n of targets) values.add(readIcon((n.data as { icon?: unknown }).icon) ?? null)
    return values.size === 1 ? { mixed: false as const, value: [...values][0] ?? null } : { mixed: true as const, value: null }
  }, [targets])

  const [open, setOpen] = useState(false)
  // the roving stop: the one option Tab reaches. It starts on the current
  // option (None for no icon or a mixed set) and then FOLLOWS focus, so an
  // arrow move, then Tab out and back, lands where the user left off
  // (Lumi's review of #481) rather than on the stored value.
  const [stop, setStop] = useState<NodeIconId | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)

  // opening puts focus on the current option
  useEffect(() => {
    if (!open) return
    const el = groupRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
    el?.focus()
  }, [open])

  if (targets.length === 0) return null

  const nameOf = (id: NodeIconId | null) => (id === null ? t('inspector.icon.none') : t(nodeIconNameKey(id)))

  if (isMobile) {
    return (
      <section className="icon-field icon-field--summary" aria-labelledby={`${ids}-title`}>
        <h3 className="field__label icon-field__title" id={`${ids}-title`}>
          {t('inspector.icon.title')}
        </h3>
        <p className="icon-field__summary">
          {current.mixed || current.value === null ? null : <NodeIcon id={current.value} big={false} className="icon-field__mark" />}
          <span>{current.mixed ? t('inspector.accent.mixed') : nameOf(current.value)}</span>
        </p>
      </section>
    )
  }

  const apply = (value: NodeIconId | null) => {
    setIcon(
      targets.map((n) => n.id),
      value,
    )
    setOpen(false)
    buttonRef.current?.focus()
  }

  const toggle = () => {
    if (!open) setStop(current.mixed ? null : current.value)
    setOpen((v) => !v)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    const options = Array.from(groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])
    const at = options.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    let to = at
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = Math.min(options.length - 1, at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = Math.max(0, at - 1)
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = options.length - 1
    else return
    e.preventDefault()
    options[to]?.focus()
  }

  const option = (id: NodeIconId | null) => {
    const checked = !current.mixed && current.value === id
    return (
      <button
        key={id ?? 'none'}
        type="button"
        role="radio"
        className="icon-option"
        aria-checked={checked}
        tabIndex={stop === id ? 0 : -1}
        title={nameOf(id)}
        data-icon-option={id ?? 'none'}
        // the stop follows focus, however it got here (an arrow, a pointer)
        onFocus={() => setStop(id)}
        onClick={() => apply(id)}
      >
        {id === null ? <span className="icon-option__none">{t('inspector.icon.none')}</span> : <NodeIcon id={id} big className="icon-option__mark" />}
        {id === null ? null : <span className="sr-only">{nameOf(id)}</span>}
      </button>
    )
  }

  return (
    <section className="icon-field" aria-labelledby={`${ids}-title`}>
      <h3 className="field__label icon-field__title" id={`${ids}-title`}>
        {t('inspector.icon.title')}
      </h3>
      {targets.length > 1 ? <p className="inspector__note icon-field__count">{t('inspector.accent.appliesTo', { n: targets.length })}</p> : null}
      <button
        ref={buttonRef}
        id={`${ids}-button`}
        type="button"
        className="icon-field__button"
        aria-expanded={open}
        aria-controls={`${ids}-gallery`}
        // heard as "Icon None" / "Icon Car": the field's title, then the choice
        aria-labelledby={`${ids}-title ${ids}-button`}
        onClick={toggle}
      >
        {current.mixed || current.value === null ? null : <NodeIcon id={current.value} big={false} className="icon-field__mark" />}
        <span>{current.mixed ? t('inspector.accent.mixed') : nameOf(current.value)}</span>
      </button>
      {open ? (
        <div
          ref={groupRef}
          id={`${ids}-gallery`}
          role="radiogroup"
          aria-label={t('inspector.icon.title')}
          className="icon-gallery"
          onKeyDown={onKeyDown}
        >
          <div className="icon-gallery__row">{option(null)}</div>
          {GROUPS.map((g) => (
            <div key={g.key} className="icon-gallery__group">
              <span className="icon-gallery__heading" aria-hidden="true">
                {t(g.key)}
              </span>
              <div className="icon-gallery__row">{g.ids.map((id) => option(id))}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
