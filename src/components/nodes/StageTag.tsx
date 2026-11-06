import { useEffect, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { create } from 'zustand'
import { useI18n, useT } from '../../i18n'
import { graphReadBlocked, graphReadEdges } from '../../model/readEdges'
import { anyRunRule, ruleOf } from '../../model/runRule'
import type { LoopNode } from '../../model/types'
import { useGraphStore } from '../../store/graphStore'
import { chipBoxesOf, currentRouteGeneration, nameFootprintsOf, useRouteInputs } from '../../store/routeMap'
import { useSimStore } from '../../store/simStore'
import { useUiStore } from '../../store/uiStore'
import { FOLDED, stageTagText, type StageTagText } from '../../ui/stageTag'

// SEMANTICS-M6.md §M6-8 — the stage tag: what a ruled stage reads and did, in words, under
// its name. The block keeps the widest form's size whatever shows, so a fold or a new
// step moves no line and no chip. The words fold when they would sit too close to a
// chip, another node or another name, and open again when the stage is chosen or pointed
// at, so a folded tag still names its tank.

/** the least gap from a tag's words to anything near it, flow px */
export const TAG_GAP = 6

const useTagForms = create<{ forms: Record<string, number> }>(() => ({ forms: {} }))

export function useStageTag(id: string, data: unknown): StageTagText | null {
  const t = useT()
  const rule = ruleOf({ data } as LoopNode)
  const tank = useGraphStore((s) => (rule?.tank === undefined ? null : (((s.nodes.find((n) => n.id === rule.tank)?.data as { label?: string } | undefined)?.label) ?? null)))
  const table = useGraphStore((s) => (rule?.table === undefined ? null : (s.timetables.find((x) => x.id === rule.table)?.label ?? null)))
  const noLine = useGraphStore((s) => rule?.tank !== undefined && graphReadBlocked(s.nodes, s.edges).some((b) => b.stage === id))
  const report = useSimStore((s) => (rule ? (s.series[s.series.length - 1]?.runs?.find((r) => r.members.includes(id)) ?? null) : null))
  return useMemo(() => (rule ? stageTagText(t, { report, tank, table, noLine }) : null), [t, rule !== null, report, tank, table, noLine]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function StageTag({ id, tank, text }: { id: string; tank: string | undefined; text: StageTagText }) {
  const form = useTagForms((s) => Math.min(s.forms[id] ?? 0, text.forms.length))
  const lineId = useGraphStore((s) => graphReadEdges(s.nodes, s.edges).find((e) => e.target === id)?.id)
  const chosen = useGraphStore((s) => s.selectedNodeId === id || (tank !== undefined && s.selectedNodeId === tank))
  const linePointed = useUiStore((s) => lineId !== undefined && s.hoverEdgeId === lineId)
  // past the last form no words show, until the tag opens
  const { state, rest } = text.forms[form] ?? { state: '', rest: '' }
  return (
    <span className={`stage-tag${chosen || linePointed ? ' is-open' : ''}${text.noLine ? ' stage-tag--no-line' : ''}`} data-stage-tag={id} data-form={form} dir="auto">
      <span className="stage-tag__size" aria-hidden="true">
        {text.widest[0]!.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </span>
      {text.widest.flatMap((words, form) =>
        words.map((w, i) => (
          <span key={`${form}.${i}`} className="stage-tag__measure" data-measure={form} aria-hidden="true">
            {w}
          </span>
        )),
      )}
      <span className="stage-tag__shown">
        <span className="stage-tag__state">{state}</span>
        {rest === '' ? null : <span className="stage-tag__rest">{rest === FOLDED ? ` ${FOLDED}` : ` · ${rest}`}</span>}
      </span>
      <span className="stage-tag__full">{text.full}</span>
    </span>
  )
}

const gapBetween = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number =>
  Math.hypot(Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0))

/** picks each tag's form once the routes are in. It reads rectangles from the current
 *  generation and the hidden measuring words, so it runs per layout, never per step. */
export function useStageTagFold(): void {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const rev = useRouteInputs((s) => s.rev)
  const locale = useI18n((s) => s.activeLocale)
  const { getViewport } = useReactFlow()
  useEffect(() => {
    if (!anyRunRule(nodes)) return
    const frame = requestAnimationFrame(() => {
      const zoom = getViewport().zoom
      const chips = chipBoxesOf(currentRouteGeneration(nodes, edges))
      const marks = nameFootprintsOf(nodes)
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const next: Record<string, number> = {}
      for (const el of document.querySelectorAll<HTMLElement>('[data-stage-tag]')) {
        const id = el.dataset.stageTag!
        const node = byId.get(id)
        const home = el.closest('.react-flow__node')?.getBoundingClientRect()
        if (!node || !home) continue
        const others = [...chips, ...marks.filter((m) => m.id !== id).flatMap((m) => [m.body, m.name])]
        const measures = [...el.querySelectorAll<HTMLElement>('[data-measure]')]
        const last = Math.max(0, ...measures.map((m) => Number(m.dataset.measure)))
        // a form clears when every state's words do
        const clears = (form: number): boolean =>
          measures
            .filter((m) => Number(m.dataset.measure) === form)
            .every((m) => {
              const range = document.createRange()
              range.selectNodeContents(m)
              const words = [...range.getClientRects()].map((r) => ({ x: node.position.x + (r.left - home.left) / zoom, y: node.position.y + (r.top - home.top) / zoom, w: r.width / zoom, h: r.height / zoom }))
              return words.length > 0 && words.every((w) => others.every((o) => gapBetween(w, o) >= TAG_GAP))
            })
        let chosen = 0
        while (chosen <= last && !clears(chosen)) chosen++
        // words that must show stay, however close: no line says what nothing else does
        next[id] = el.classList.contains('stage-tag--no-line') ? Math.min(chosen, last) : chosen
      }
      const was = useTagForms.getState().forms
      const same = Object.keys(next).length === Object.keys(was).length && Object.keys(next).every((k) => was[k] === next[k])
      if (!same) useTagForms.setState({ forms: next })
    })
    return () => cancelAnimationFrame(frame)
  }, [nodes, edges, rev, locale, getViewport])
}
