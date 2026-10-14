// docs/edge-routing.md §ER18 — the Inspector's Ends group: move a connection's
// source or target end to another side of its node or to another node. The
// user picks a node and a side for either end, then Applies: ONE change (and
// one undo step), never a provisional side first and a second change after.
// The check and the change are the model's (`endMoveVerdict` through
// `moveEdgeEnds`), the same the canvas end grips use. A node that cannot take
// this end is listed disabled with its reason IN its text, so a keyboard or
// screen-reader user reads it as well as a mouse user.
//
// §ER19 — the same group's Reverse, beside the folded summary: its own button
// (it never opens or closes the group), one press, one undo step, through the
// model's `reverseVerdict` and the store's `reverseEdge`.

import { useId, useMemo, useState } from 'react'
import type { LoopEdge, LoopNode, PortFace } from '../model/types'
import { edgePortKind, faceOf, PORT_FACES, type PortEnd } from '../model/ports'
import { endMoveVerdict, movedEdge, portRefusal, type EdgeEnd, type EndMoveReason } from '../model/endMove'
import { reverseVerdict, type ReverseReason } from '../model/reverse'
import { bendRejection } from '../store/routeMap'
import { useGraphStore } from '../store/graphStore'
import { useEndGripNotice } from '../store/endGripNotice'
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
// §ER19 — a reversal's refusals: the end move's own (ports, a repeat), then
// the state rules the new direction would break
const REVERSE_REASON_KEY: Record<ReverseReason, MessageKey> = {
  missing: 'inspector.ends.reason.missing',
  noInput: 'inspector.ends.reason.noInput',
  noOutput: 'inspector.ends.reason.noOutput',
  noPorts: 'inspector.ends.reason.noPorts',
  duplicate: 'inspector.ends.reason.duplicate',
  activatorSource: 'inspector.ends.reverse.reason.activatorSource',
  labelPool: 'inspector.ends.reverse.reason.labelPool',
  labelRouterSource: 'inspector.ends.reverse.reason.labelRouterSource',
  labelTarget: 'inspector.ends.reverse.reason.labelTarget',
  stateMode: 'inspector.ends.reverse.reason.stateMode',
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
  const reverseEdge = useGraphStore((s) => s.reverseEdge)
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
  const [open, setOpen] = useState(false)
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
  // a canvas grip's refused drop on this connection says its reason here too
  const grip = useEndGripNotice((s) => (s.edgeId === edge.id ? s.verdict : null))
  const gripText = grip
    ? t(REASON_KEY[grip.reason], {
        node: isolateAuto(nameOf(byId.get(grip.node), grip.node)),
        from: isolateAuto(nameOf(byId.get(grip.end === 'source' ? grip.node : current.source.node), grip.end === 'source' ? grip.node : current.source.node)),
        to: isolateAuto(nameOf(byId.get(grip.end === 'target' ? grip.node : current.target.node), grip.end === 'target' ? grip.node : current.target.node)),
      })
    : null
  // an end the canvas has no grip for (no free spot near it): moved from here
  const noGrip = useEndGripNotice((s) => (s.noSpot?.edgeId === edge.id ? s.noSpot.ends : null))
  const noGripText = noGrip?.length ? noGrip.map((e) => t(e === 'source' ? 'inspector.ends.noGrip.source' : 'inspector.ends.noGrip.target')).join(' ') : null
  const status = verdict && !verdict.ok ? { text: reasonText(verdict)!, warn: true } : bendsAffected ? { text: t('inspector.ends.bends'), warn: true } : !changed && gripText ? { text: gripText, warn: true } : done ? { text: done, warn: false } : noGripText ? { text: noGripText, warn: false } : null
  const statusId = `${ids}-status`

  // §ER19 — Reverse, beside the summary, folded or open: one press applies it
  // (one undo step). It waits while a pick here is not applied, so it is never
  // unclear whether the pending ends or the stored ones are reversed.
  const reverse = reverseVerdict(nodes, edges, edge.id)
  // the connection a reversal from here produced: its note stays while the
  // connection is that one (an undo or another edit ends it)
  const [reversed, setReversed] = useState<LoopEdge | null>(null)
  const refusal = reverse.ok
    ? null
    : t(REVERSE_REASON_KEY[reverse.reason], {
        node: isolateAuto(nameOf(byId.get(reverse.node), reverse.node)),
        from: isolateAuto(nameOf(byId.get(current.target.node), current.target.node)),
        to: isolateAuto(nameOf(byId.get(current.source.node), current.source.node)),
      })
  const justReversed = reversed === edge
  // the note under it, folded or open: the wait; the result of the reversal
  // just made (the reading; the bends' places, only when there are bends; what
  // may be drawn differently); a refusal; else what a reversal keeps
  const reverseNote = changed
    ? t('inspector.ends.reverse.pending')
    : justReversed
      ? [t('inspector.ends.reverse.done'), waypoints.length > 0 ? t('inspector.ends.reverse.bendsKept') : null, t('inspector.ends.reverse.mayChange')].filter(Boolean).join(' ')
      : (refusal ?? t('inspector.ends.reverse.hint'))
  // a reversal that made a connection work (an activator from a Gate, say) can
  // leave one that cannot be reversed back: the result stays, and why the NEXT
  // reversal is refused is a line of its own, the one the button describes
  const againNote = !changed && justReversed && refusal ? `${t('inspector.ends.reverse.again')} ${refusal}` : null
  const reverseBlocked = changed || !reverse.ok
  const reverseNoteId = `${ids}-reverse`
  const reverseAgainId = `${ids}-reverse-again`

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

  // collapsed by default: a one-line summary (From → To) that keeps the
  // connection's other fields where they were; open, the pick and Apply. The
  // status line (a refusal, the bend warning, the result) is in the group in
  // both states, so a reason never hides behind the fold.
  const summary = t('inspector.ends.summary', {
    from: isolateAuto(nameOf(byId.get(current.source.node), current.source.node)),
    to: isolateAuto(nameOf(byId.get(current.target.node), current.target.node)),
  })
  return (
    <section className="ends" aria-labelledby={`${ids}-title`}>
      <div className="ends__head">
      <h3 className="field__label ends__title" id={`${ids}-title`}>
        <button
          type="button"
          className="ends__toggle"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          onClick={() => {
            // folding away a pick that was not applied drops it: nothing hidden stays pending
            if (open) {
              setPick(current)
              setDone(null)
            }
            setOpen(!open)
          }}
        >
          <span className="ends__toggle-name">{t('inspector.ends.title')}</span>
          <span className="ends__summary">{summary}</span>
        </button>
      </h3>
      {/* its own button: reversing never opens or closes the group */}
      <button
        type="button"
        className="btn btn--ghost ends__reverse"
        aria-label={t('inspector.ends.reverse.name')}
        aria-disabled={reverseBlocked || undefined}
        aria-describedby={againNote ? reverseAgainId : reverseNoteId}
        onClick={() => {
          if (reverseBlocked) return
          const v = reverseEdge(edge.id)
          if (v?.ok && !v.same) {
            setDone(null)
            setReversed(useGraphStore.getState().edges.find((e) => e.id === edge.id) ?? null)
          }
        }}
      >
        {t('inspector.ends.reverse')}
      </button>
      </div>
      {/* never the warning colour: a refusal says why this action is not
          available, not that the connection is wrong */}
      <p id={reverseNoteId} role="status" className="field__hint ends__reverse-note">
        {reverseNote}
      </p>
      {againNote ? (
        <p id={reverseAgainId} className="field__hint ends__reverse-note">
          {againNote}
        </p>
      ) : null}
      <p id={statusId} role="status" className={status?.warn ? 'field__hint field__hint--bad ends__status' : 'field__hint ends__status'}>
        {status?.text ?? ''}
      </p>
      <div id={`${ids}-body`} hidden={!open}>
      {endRow('source')}
      {endRow('target')}
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
      </div>
    </section>
  )
}
