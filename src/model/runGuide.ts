// #537 (Lumi, 2026-11-10) — what auto-play tells a reader of a bundled example's run.
//
// THE PAUSE. A stage marked `data.pauseOnStop: true` is a core process of its document: the
// first time, in a run, that the run-rule group holding one is held "stopped" for lack of
// supply or of room, auto-play pauses once (simStore). The mark is explicit document data, so
// it travels wherever the node does (save, autosave, share, revisions, undo) and nothing is
// guessed: a document without it never pauses this way. The desalination Template marks its
// five water-path stages.
//
// THE CHECKED RANGE. A bundled example says how many steps it is checked over. The note past
// them holds only while the document's model is the example's: equal engine-relevant content
// (`canonicalGraphString`), with a table's name and source left out, since both follow the
// language through the Template overlay. Positions and node names are not engine content
// either, so a layout move or a language switch keeps the note, a model edit removes it, and
// a saved and reopened copy matches again. Nothing about it is written into a file.
import { canonicalGraphString } from './workspace'
import { TEMPLATES } from './templates'
import type { ModelSemanticsVersion } from './modelVersion'
import type { ResourceKindDecl } from './kinds'
import type { Timetable } from './timetable'
import type { DocTime } from './units'
import type { LoopEdge, LoopNode } from './types'

export type CheckedRange = {
  templateId: string
  /** the steps the example is checked over, and the same in days */
  steps: number
  days: number
}

/** the bundled examples that say how far they are checked; the desalination note (p9) names 90 days */
export const CHECKED_RANGES: readonly CheckedRange[] = [{ templateId: 'desalination', steps: 2160, days: 90 }]

type GraphLike = { nodes: LoopNode[]; edges: LoopEdge[]; kinds?: readonly ResourceKindDecl[]; time?: DocTime; timetables?: readonly Timetable[] }

/** the model's engine-relevant content, a table's name and source left out */
export function modelKey(g: GraphLike, modelVersion: ModelSemanticsVersion | undefined): string {
  return canonicalGraphString({ ...g, timetables: (g.timetables ?? []).map((t) => ({ ...t, label: '', source: '' })) }, modelVersion)
}

const templateKeys = new Map<string, string | null>()
function templateKeyOf(id: string): string | null {
  if (templateKeys.has(id)) return templateKeys.get(id)!
  const t = TEMPLATES.find((x) => x.id === id)
  const key = t ? modelKey({ nodes: t.graph.nodes as LoopNode[], edges: t.graph.edges as LoopEdge[], kinds: t.kinds, time: t.time, timetables: t.timetables }, t.modelVersion) : null
  templateKeys.set(id, key)
  return key
}

/** the checked range this document holds: only while its model is the example's */
export function checkedRangeOf(g: GraphLike, modelVersion: ModelSemanticsVersion | undefined): CheckedRange | null {
  let key: string | null = null
  for (const range of CHECKED_RANGES) {
    const want = templateKeyOf(range.templateId)
    if (want === null) continue
    key ??= modelKey(g, modelVersion)
    if (key === want) return range
  }
  return null
}

/** the stages marked as core processes: their first stop pauses auto-play */
export const pauseStages = (nodes: readonly LoopNode[]): string[] => nodes.filter((n) => (n.data as { pauseOnStop?: unknown } | undefined)?.pauseOnStop === true).map((n) => n.id)
