// PROTOTYPE for #537 (not for merge) — a Template's run guide: how far it is checked, and the
// core processes whose first stop pauses auto-play.
//
// Lumi, 2026-11-10: a pause for the desalination example only; the checked-range note holds
// only while the document's model is the example's, and goes when the model is edited; it
// survives save and reopen. Nothing here is written into a file:
//   • the checked range is valid while the model's engine-relevant projection equals the
//     Template's (positions, labels and a table's name and source are not part of it, so a
//     layout move or a language switch keeps it, and a saved and reopened copy matches);
//   • the pause applies to the example and to documents edited from it, recognised by the
//     core stages (each still holding its run rule) and most of the Template's node ids.
import { canonicalGraphString } from './workspace'
import { TEMPLATES } from './templates'
import type { ModelSemanticsVersion } from './modelVersion'
import type { ResourceKindDecl } from './kinds'
import type { Timetable } from './timetable'
import type { DocTime } from './units'
import type { LoopEdge, LoopNode } from './types'

export type RunGuide = {
  templateId: string
  /** the steps the example is checked over, and the same in days */
  checkedSteps: number
  checkedDays: number
  /** the stages whose first stop for supply or room pauses auto-play */
  pauseOn: readonly string[]
}

export const RUN_GUIDES: readonly RunGuide[] = [
  // the water path's run-rule stages: from the coagulation filter to the city and the sea
  { templateId: 'desalination', checkedSteps: 2160, checkedDays: 90, pauseOn: ['filter', 'ro', 'remin', 'dpump', 'adjust'] },
]

/** the share of the Template's node ids a document must still hold to count as edited from it */
const DERIVED_SHARE = 0.8

type GraphLike = { nodes: LoopNode[]; edges: LoopEdge[]; kinds?: readonly ResourceKindDecl[]; time?: DocTime; timetables?: readonly Timetable[] }

/** the model's engine-relevant projection, a table's name and source left out (both follow
 *  the language through the Template overlay) */
export function modelKey(g: GraphLike, modelVersion: ModelSemanticsVersion | undefined): string {
  return canonicalGraphString({ ...g, timetables: (g.timetables ?? []).map((t) => ({ ...t, label: '', source: '' })) }, modelVersion)
}

const templateKeys = new Map<string, string>()
function templateKeyOf(id: string): string | null {
  const hit = templateKeys.get(id)
  if (hit !== undefined) return hit
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) return null
  const key = modelKey({ nodes: t.graph.nodes as LoopNode[], edges: t.graph.edges as LoopEdge[], kinds: t.kinds, time: t.time, timetables: t.timetables }, t.modelVersion)
  templateKeys.set(id, key)
  return key
}

export type ActiveGuide = { guide: RunGuide; isExample: boolean }

/** the guide that applies to this document: `isExample` while its model is the Template's */
export function guideFor(g: GraphLike, modelVersion: ModelSemanticsVersion | undefined): ActiveGuide | null {
  for (const guide of RUN_GUIDES) {
    const key = templateKeyOf(guide.templateId)
    if (key === null) continue
    if (modelKey(g, modelVersion) === key) return { guide, isExample: true }
    const t = TEMPLATES.find((x) => x.id === guide.templateId)!
    const ids = new Set(g.nodes.map((n) => n.id))
    const kept = t.graph.nodes.filter((n) => ids.has(n.id)).length / t.graph.nodes.length
    const cores = guide.pauseOn.every((id) => g.nodes.some((n) => n.id === id && (n.data as { run?: unknown }).run !== undefined))
    if (cores && kept >= DERIVED_SHARE) return { guide, isExample: false }
  }
  return null
}
