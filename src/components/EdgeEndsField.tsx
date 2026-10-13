// docs/edge-routing.md §ER18 — the Inspector's Ends group: move a connection's
// source or target end to another side of its node or to another node. The
// user picks a node and a side for either end, then Applies: ONE change (and
// one undo step), never a provisional side first and a second change after.
// The check and the change are the model's (`endMoveVerdict` through
// `moveEdgeEnds`), the same the canvas end grips use. A node that cannot take
// this end is listed disabled with its reason IN its text, so a keyboard or
// screen-reader user reads it as well as a mouse user.

import { useId, useMemo, useState } from 'react'
import type { LoopEdge, LoopNode, PortFace } from '../model/types'
import { edgePortKind, faceOf, PORT_FACES, type PortEnd } from '../model/ports'
import { endMoveVerdict, movedEdge, portRefusal, type EdgeEnd, type EndMoveReason } from '../model/endMove'
import { bendRejection } from '../store/routeMap'
import { useGraphStore } from '../store/graphStore'
import { useT, type MessageKey } from '../i18n'
// §L9.3 — a node's name is the user's own text, in whatever script they write it
import { isolateAuto } from '../i18n/bidiIsolate'

const SIDE_KEY: Record<PortFace, MessageKey> = {
  top: 'inspector.ends.side.top',
  right: 'inspector.ends.side.right',
  bottom: 'inspector.ends.side.bottom',
  left: 'inspector.ends.side.left',
}
const REASON_KEY: Record<EndMoveReason, MessageKey> = {
  missing: 'inspector.ends.reason.missing',
  noInput: 'inspector.ends.reason.noInput',
  noOutput: 'inspector.ends.reason.noOutput',
  noPorts: 'inspector.ends.reason.noPorts',
  duplicate: 'inspector.ends.reason.duplicate',
}
const SHORT_KEY: Partial<Record<EndMoveReason, MessageKey>> = {
  noInput: 'inspector.ends.option.noInput',
  noOutput: 'inspector.ends.option.noOutput',
  noPorts: 'inspector.ends.option.noPorts',
}

const nameOf = (n: LoopNode | undefined, id: string) => (n?.data as { label?: string } | undefined)?.label || id
const kindOf = (n: LoopNode | undefined) => (n?.data as { kind?: string } | undefined)?.kind

export function EdgeEndsField({ edge }: { edge: LoopEdge }) {
  const t = useT()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const moveEdgeEnds = useGraphStore((s) => s.moveEdgeEnds)
  const ids = useId()
  const portKind = edgePortKind(edge)

  // the ends as they are; the pending pick starts there and returns there
  // whenever the connection itself changes (another selection, undo, a move)
  const current = useMemo(
    () => ({ source: { node: edge.source, face: faceOf(edge, 'source') }, target: { node: edge.target, face: faceOf(edge, 'target') } }),
    [edge],
  )
  const [pick, setPick] = useState(current)
  const [done, setDone] = useState<string | null>(null)
  // the connection changed under the pick: start from its ends again (state
  // adjusted while rendering, as React documents for a changed input)
  const [base, setBase] = useState(current)
  if (base !== current) {
    setBase(current)
    setPick(current)
  }

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => nameOf(a, a.id).localeCompare(nameOf(b, b.id)) || (a.id < b.id ? -1 : 1)),
    [nodes],
  )

  const changed = pick.source.node !== current.source.node || pick.source.face !== current.source.face || pick.target.node !== current.target.node || pick.target.face !== current.target.face
  const move = {
    ...(pick.source.node !== current.source.node || pick.source.face !== current.source.face ? { source: pick.source } : {}),
    ...(pick.target.node !== current.target.node || pick.target.face !== current.target.face ? { target: pick.target } : {}),
  }
  const verdict = changed ? endMoveVerdict(nodes, edges, edge.id, move) : null
  // the user's bends are kept; one that the bend rule would refuse at the new
  // ends (inside a node, or on the new end's stub) is said BEFORE applying
  const waypoints = (edge.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints ?? []
  const bendsAffected =
    verdict?.ok && !verdict.same && waypoints.length > 0
      ? (() => {
          const next = movedEdge(edge, move)
          const es = edges.map((e) => (e.id === edge.id ? next : e))
          return waypoints.some((w) => bendRejection(nodes, es, edge.id, w) != null)
        })()
      : false

  const reasonText = (v: Exclude<typeof verdict, null>) => {
    if (v.ok) return null
    const other = v.end === 'source' ? pick.target.node : pick.source.node
    return t(REASON_KEY[v.reason], {
      node: isolateAuto(nameOf(byId.get(v.node), v.node)),
      from: isolateAuto(nameOf(byId.get(v.end === 'source' ? v.node : other), v.end === 'source' ? v.node : other)),
      to: isolateAuto(nameOf(byId.get(v.end === 'target' ? v.node : other), v.end === 'target' ? v.node : other)),
    })
  }
  const status = verdict && !verdict.ok ? { text: reasonText(verdict)!, warn: true } : bendsAffected ? { text: t('inspector.ends.bends'), warn: true } : done ? { text: done, warn: false } : null
  const statusId = `${ids}-status`

  const endRow = (end: PortEnd) => {
    const value = pick[end]
    const set = (v: EdgeEnd) => {
      setDone(null)
      setPick((p) => ({ ...p, [end]: v }))
    }
    return (
      <div className="ends__end" role="group" aria-labelledby={`${ids}-${end}`}>
        <span className="field__label" id={`${ids}-${end}`}>
          {t(end === 'source' ? 'inspector.ends.from' : 'inspector.ends.to')}
        </span>
        <label className="ends__node">
          <span className="sr-only">{t('inspector.ends.node')}</span>
          <select
            value={value.node}
            aria-describedby={status ? statusId : undefined}
            onChange={(e) => set({ node: e.target.value, face: value.face })}
          >
            {sorted.map((n) => {
              const refusal = n.id === current[end].node ? null : portRefusal(kindOf(n), portKind, end)
              const kind = kindOf(n)
              const short = refusal ? SHORT_KEY[refusal] : undefined
              return (
                <option key={n.id} value={n.id} disabled={refusal != null}>
                  {nameOf(n, n.id)}
                  {kind ? ` · ${t(`canvas.nodeKind.${kind}` as MessageKey)}` : ''}
                  {short ? ` — ${t(short)}` : ''}
                </option>
              )
            })}
          </select>
        </label>
        <div className="ends__sides" role="radiogroup" aria-label={t('inspector.ends.side')}>
          {PORT_FACES.map((f) => (
            <label key={f} className="ends__side">
              <input type="radio" name={`${ids}-${end}-side`} checked={value.face === f} onChange={() => set({ node: value.node, face: f })} />
              {t(SIDE_KEY[f])}
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="ends" aria-labelledby={`${ids}-title`}>
      <h3 className="field__label ends__title" id={`${ids}-title`}>
        {t('inspector.ends.title')}
      </h3>
      {endRow('source')}
      {endRow('target')}
      <p id={statusId} role="status" className={status?.warn ? 'field__hint field__hint--bad ends__status' : 'field__hint ends__status'}>
        {status?.text ?? ''}
      </p>
      <div className="ends__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!changed || !verdict?.ok}
          aria-describedby={status ? statusId : undefined}
          onClick={() => {
            const v = moveEdgeEnds(edge.id, move)
            if (v?.ok && !v.same) {
              setDone(
                t('inspector.ends.applied', {
                  from: isolateAuto(nameOf(byId.get(pick.source.node), pick.source.node)),
                  to: isolateAuto(nameOf(byId.get(pick.target.node), pick.target.node)),
                }),
              )
            }
          }}
        >
          {t('inspector.ends.apply')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!changed}
          onClick={() => {
            setDone(null)
            setPick(current)
          }}
        >
          {t('inspector.ends.revert')}
        </button>
      </div>
    </section>
  )
}
