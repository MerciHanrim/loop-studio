import { useEffect, useMemo, useRef } from 'react'
import { connectKindOf, type ConnectKind } from '../../model/connectKind'
import { findReferences } from '../../model/dataImportReferences'
import type { LoopEdge, LoopNode } from '../../model/types'
import { classifyLabelTiming, parseActivatorExpr, parseLabelExpr } from '../../engine/stateExpr'
import { gateChances, type GateChances } from '../../engine/gateChance'
import { selectOnly, useGraphStore } from '../../store/graphStore'
import { useUiStore } from '../../store/uiStore'
import { useT, type MessageKey } from '../../i18n'
import { isolateAuto } from '../../i18n/bidiIsolate'

// The workbench (2026-10, step 5) — the right panel's FIRST layer: what the
// selection IS in the model, said before anything is edited (share notes
// 75 / 94, the mock-up's properties panel). For a node: its connections,
// grouped by what they do to it and what it does to others, each a row that
// selects that connection; pointing at a row identifies its line on the
// canvas. For a connection: one sentence — when, and what happens. The
// expressions are read by the engine's own parsers (../../engine/stateExpr);
// nothing here changes the document.

const nameOf = (nodes: LoopNode[], id: string): string => {
  const n = nodes.find((x) => x.id === id)
  return ((n?.data as { label?: unknown } | undefined)?.label as string | undefined) || id
}

/** the line sample of a connection kind (the tool row's Connect marks) */
export function KindSample({ kind }: { kind: ConnectKind | null }) {
  const dash = kind === 'condition' ? '5 2.5' : kind === 'change' ? '0.1 3.5' : kind === 'trigger' ? '1.5 2.5' : undefined
  return (
    <svg className="wb-rel__sample" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      <path d="M1 5h20" fill="none" stroke="currentColor" strokeWidth={kind === 'change' ? 2 : 1.6} strokeDasharray={dash} strokeLinecap={kind === 'change' ? 'round' : undefined} />
    </svg>
  )
}

const OP_KEY: Record<string, MessageKey> = {
  '>=': 'rel.op.ge',
  '<=': 'rel.op.le',
  '>': 'rel.op.gt',
  '<': 'rel.op.lt',
  '==': 'rel.op.eq',
  '!=': 'rel.op.ne',
}

type Tr = ReturnType<typeof useT>

/** a connection's effect in a few words: an amount, a comparison, a change */
function effectText(t: Tr, e: LoopEdge, nodes: LoopNode[], modelVersion: 1 | 2): string {
  const d = (e.data ?? {}) as { flow?: unknown; expr?: unknown }
  const k = connectKindOf(e)
  if (k === 'flow') {
    const f = typeof d.flow === 'string' ? d.flow : String(d.flow ?? '')
    return f.startsWith('@') ? `◇ ${nameOf(nodes, f.slice(1))}` : f
  }
  if (k === 'condition') {
    const p = parseActivatorExpr(String(d.expr ?? ''), modelVersion)
    if (!p.ok) return t('rel.unset')
    // against a number, or a Parameter: its name (the user's text) and any
    // offset — one run, isolated either way
    const off = p.rhs.kind === 'param' && p.rhs.offset ? (p.rhs.offset > 0 ? ` + ${p.rhs.offset}` : ` − ${-p.rhs.offset}`) : ''
    const rhs = p.rhs.kind === 'literal' ? String(p.rhs.n) : `◇ ${nameOf(nodes, p.rhs.id)}${off}`
    return t(OP_KEY[p.op] ?? 'rel.op.eq', { n: isolateAuto(rhs) })
  }
  if (k === 'change') {
    const p = parseLabelExpr(String(d.expr ?? ''))
    if (!p.ok) return t('rel.unset')
    const n = p.token === 'S' ? t('rel.sourceValue') : String(p.n)
    return p.op === '+' ? `+${n}` : p.op === '-' ? `−${n}` : `= ${n}`
  }
  return t('rel.fires')
}

function useSelectEdge(): (id: string) => void {
  return (id) => selectOnly({ edge: id })
}

type Section = { key: MessageKey; rows: LoopEdge[]; other: (e: LoopEdge) => string }

// A probabilistic Gate's outgoing rows carry each branch's weight and chance,
// read by the engine's own rules (../../engine/gateChance: the same flow
// reading, the same lines; nothing drawn, nothing changed) — Lumi,
// 2026-10-20, note 94's chance table made general. What a static reading
// cannot fix (a random weight, a router-only cycle) is said to be decided at
// run time, never estimated.

/** a chance as a percentage, one decimal; a chance above 0 that rounds to 0
 *  reads "< 0.1%" rather than "0%" */
function chanceText(t: Tr, chance: number): string {
  if (chance > 0 && chance < 0.0005) return t('rel.gate.chanceBelow', { min: 0.001 })
  return t('rel.gate.chance', { chance })
}

/** the weight the engine reads, beside the line's own text where they differ
 *  (`@id` ⇒ the Parameter's value, `all` ⇒ 1, `n%` ⇒ n / 100) */
function weightText(t: Tr, e: LoopEdge, nodes: LoopNode[], modelVersion: 1 | 2, weight: number | null): string {
  const own = effectText(t, e, nodes, modelVersion)
  if (weight == null) return own
  const w = t('rel.gate.weight', { w: weight })
  return own === w ? own : `${own} · ${w}`
}

/** the note under a probabilistic Gate's outgoing rows */
function chanceNote(t: Tr, c: GateChances): string | null {
  if (c.status === 'fixed') return t('rel.gate.sum', { sum: c.sum ?? 0 })
  if (c.status === 'inert') return t('rel.gate.inert')
  if (c.status === 'runtime') return t(c.reason === 'cycle' ? 'rel.gate.runtime.cycle' : 'rel.gate.runtime.random')
  return null
}

export function NodeRelations({ node }: { node: LoopNode }) {
  const t = useT()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const modelVersion = useGraphStore((s) => (s.modelVersion === 2 ? 2 : 1))
  const setHover = useUiStore((s) => s.setHoverEdgeId)
  const selectEdge = useSelectEdge()
  const id = node.id
  // the line a row of this panel is pointing at. A row's click selects its
  // line and the panel then shows that line instead, so the row goes away
  // under the pointer with no mouseleave or blur: its pointing ends with it
  // (the selection stays)
  const pointed = useRef<string | null>(null)
  const point = (edgeId: string | null) => {
    pointed.current = edgeId
    setHover(edgeId)
  }
  useEffect(
    () => () => {
      const ui = useUiStore.getState()
      if (pointed.current != null && ui.hoverEdgeId === pointed.current) ui.setHoverEdgeId(null)
      pointed.current = null
    },
    [id],
  )
  const kindOf = (e: LoopEdge) => connectKindOf(e)
  const into = (k: ConnectKind) => edges.filter((e) => e.target === id && kindOf(e) === k)
  const outOf = (k: ConnectKind) => edges.filter((e) => e.source === id && kindOf(e) === k)
  // a Parameter is read by reference (`@id` in an amount or a condition) —
  // found by the parsers, not by text (#393 C): a substring test matched `@a`
  // inside `@ab` and never matched the `@{a}` spelling; `findReferences` reads
  // a v2 `flow` with `parseFlow` and an activator `expr` with
  // `parseActivatorExpr`, under the document's model version
  const refEdgeIds = useMemo(
    () => new Set(findReferences(nodes, edges, modelVersion, id).flatMap((r) => (r.via === 'resource-flow' || r.via === 'activator' ? [r.edgeId] : []))),
    [nodes, edges, modelVersion, id],
  )
  const refs = edges.filter((e) => refEdgeIds.has(e.id))
  const all: Section[] = [
    { key: 'rel.in.flow', rows: into('flow'), other: (e) => e.source },
    { key: 'rel.in.condition', rows: into('condition'), other: (e) => e.source },
    { key: 'rel.in.change', rows: into('change'), other: (e) => e.source },
    { key: 'rel.in.trigger', rows: into('trigger'), other: (e) => e.source },
    { key: 'rel.out.flow', rows: outOf('flow'), other: (e) => e.target },
    { key: 'rel.out.condition', rows: outOf('condition'), other: (e) => e.target },
    { key: 'rel.out.change', rows: outOf('change'), other: (e) => e.target },
    { key: 'rel.out.trigger', rows: outOf('trigger'), other: (e) => e.target },
    { key: 'rel.refs', rows: refs, other: (e) => `${nameOf(nodes, e.source)} → ${nameOf(nodes, e.target)}` },
  ]
  const sections = all.filter((s) => s.rows.length > 0)
  // a probabilistic Gate: its outgoing rows read result · weight · chance
  const chances = useMemo(() => gateChances(nodes, edges, id, modelVersion), [nodes, edges, id, modelVersion])
  const branchOf = new Map((chances?.branches ?? []).map((b) => [b.edgeId, b]))

  if (sections.length === 0) return <p className="wb-rel__none">{t('rel.none')}</p>
  return (
    <div className="wb-rel">
      {sections.map((s) => {
        const withChance = s.key === 'rel.out.flow' && chances != null && chances.status !== 'none'
        const note = withChance ? chanceNote(t, chances) : null
        return (
          <section key={s.key} className="wb-rel__sec" aria-label={t(s.key)}>
            <h3 className="wb-rel__head">
              {t(s.key)} <span dir="ltr">{s.rows.length}</span>
            </h3>
            {withChance ? (
              <>
                <p className="wb-rel__lead">{t('rel.gate.lead')}</p>
                <p className="wb-rel__cols" aria-hidden="true">
                  {t('rel.gate.cols')}
                </p>
              </>
            ) : null}
            {s.rows.map((e) => {
              const other = s.key === 'rel.refs' ? s.other(e) : nameOf(nodes, s.other(e))
              const b = withChance ? branchOf.get(e.id) : undefined
              const chance = !withChance
                ? null
                : chances.status === 'runtime'
                  ? t('rel.gate.runtime')
                  : b?.chance != null
                    ? chanceText(t, b.chance)
                    : '—'
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`wb-rel__row${withChance ? ' wb-rel__row--chance' : ''}`}
                  data-edge={e.id}
                  onClick={() => selectEdge(e.id)}
                  onMouseEnter={() => point(e.id)}
                  onMouseLeave={() => point(null)}
                  onFocus={() => point(e.id)}
                  onBlur={() => point(null)}
                >
                  <KindSample kind={connectKindOf(e)} />
                  <span className="wb-rel__name" dir="auto">
                    {other}
                  </span>
                  <span className="wb-rel__effect" dir="ltr">
                    {withChance ? weightText(t, e, nodes, modelVersion, b?.weight ?? null) : effectText(t, e, nodes, modelVersion)}
                  </span>
                  {chance != null ? (
                    <span className="wb-rel__chance" dir="ltr">
                      {chance}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {note ? <p className="wb-rel__sum">{note}</p> : null}
          </section>
        )
      })}
      <p className="wb-rel__note">{t('rel.rowNote')}</p>
    </div>
  )
}

/** a connection in one sentence: when, and what happens */
export function EdgeRelation({ edge }: { edge: LoopEdge }) {
  const t = useT()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const modelVersion = useGraphStore((s) => (s.modelVersion === 2 ? 2 : 1))
  const k = connectKindOf(edge)
  // a line out of a probabilistic Gate: the same chance its Gate's row shows
  const chances = useMemo(() => (k === 'flow' ? gateChances(nodes, edges, edge.source, modelVersion) : null), [k, nodes, edges, edge.source, modelVersion])
  const srcName = nameOf(nodes, edge.source)
  const tgtName = nameOf(nodes, edge.target)
  const d = (edge.data ?? {}) as { expr?: unknown; timing?: unknown; when?: unknown }
  // every node name enters its sentence isolated, at the argument itself
  // (docs/localization.md §L9.4; scripts/isolate-obligations.json)
  let when = ''
  let effect = ''
  if (k === 'flow') {
    when = t('rel.flow.when', { from: isolateAuto(srcName), to: isolateAuto(tgtName) })
    effect = t('rel.flow.effect')
  } else if (k === 'condition') {
    when = t('rel.condition.when', { source: isolateAuto(srcName), cond: isolateAuto(effectText(t, edge, nodes, modelVersion)) })
    effect = t('rel.condition.effect', { target: isolateAuto(tgtName) })
  } else if (k === 'change') {
    const timing = classifyLabelTiming(d.timing, d.when)
    when = timing === 'afterPull' ? t('rel.change.whenFires', { source: isolateAuto(srcName) }) : t('rel.change.everyStep')
    const p = parseLabelExpr(String(d.expr ?? ''))
    if (!p.ok) effect = t('rel.unset')
    else if (p.token === 'S') effect = t(p.op === '+' ? 'rel.change.addSource' : p.op === '-' ? 'rel.change.subSource' : 'rel.change.setSource', { target: isolateAuto(tgtName), source: isolateAuto(srcName) })
    else effect = t(p.op === '+' ? 'rel.change.add' : p.op === '-' ? 'rel.change.sub' : 'rel.change.set', { target: isolateAuto(tgtName), n: p.n })
  } else {
    when = t('rel.trigger.when', { source: isolateAuto(srcName) })
    effect = t('rel.trigger.effect', { target: isolateAuto(tgtName) })
  }
  const goTo = (id: string) => selectOnly({ node: id })
  const branch = chances?.branches.find((b) => b.edgeId === edge.id)
  // the Gate's name enters each sentence isolated, at the argument itself
  const chanceLine = !chances || !branch
    ? null
    : chances.status === 'fixed' && branch.chance != null && branch.weight != null
      ? t('rel.gate.edgeChance', { w: branch.weight, sum: chances.sum ?? 0, chance: chanceText(t, branch.chance), gate: isolateAuto(srcName) })
      : chances.status === 'inert'
        ? t('rel.gate.edgeInert', { gate: isolateAuto(srcName) })
        : chances.status === 'runtime'
          ? t('rel.gate.edgeRuntime', { gate: isolateAuto(srcName) })
          : null
  return (
    <div className="wb-rel__sentence">
      <p className="wb-rel__when">{when}</p>
      <p className="wb-rel__eff">{effect}</p>
      {chanceLine ? <p className="wb-rel__chanceline">{chanceLine}</p> : null}
      <p className="wb-rel__ends">
        <button type="button" className="wb-rel__link" dir="auto" onClick={() => goTo(edge.source)}>
          {nameOf(nodes, edge.source)}
        </button>
        <span aria-hidden="true"> → </span>
        <button type="button" className="wb-rel__link" dir="auto" onClick={() => goTo(edge.target)}>
          {nameOf(nodes, edge.target)}
        </button>
      </p>
    </div>
  )
}
