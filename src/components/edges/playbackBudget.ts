import { useSimStore } from '../../store/simStore'
import { MAX_PLAYBACK_TOKENS_TOTAL } from './playback-caps'

/** the in-flight transition, non-null. `flowByEdge` / `events` / `stateEvents`
 *  are set once per transition and kept by reference across every τ tick, so
 *  `flowByEdge` doubles as a stable per-transition cache key. */
type Transition = NonNullable<ReturnType<typeof useSimStore.getState>['transition']>

const EMPTY: ReadonlySet<string> = new Set()

// docs/simulation-playback.md §PB4.5 — the `cueKind` half of the stable key
// `(edgeId, cueKind, originalEventIndex)`. A FIXED total order (never the
// accidental alpha order `label < resource < trigger`), so the chosen set never
// depends on the order the engine happened to emit events in.
//
// An edge emits AT MOST ONE travelling cue per step: it has one `data.kind`
// (resource XOR state) and one state `mode`, and each mode contributes at most
// one `StateEvent` (locked by src/engine/state-one-cue-per-edge.test.ts). So a
// candidate's `edgeId` alone is unique across the pool, membership is a plain
// `Set<edgeId>`, and the on-screen travelling-element count equals the picked
// edge count ≤ MAX_PLAYBACK_TOKENS_TOTAL. `cueKind` / `originalEventIndex` in the
// key are a defensive total order (a tie could only ever arise if that engine
// invariant were relaxed) — they never actually break a tie today.
const KIND_RANK = { resource: 0, trigger: 1, label: 2 } as const

// computed ONCE per transition: `t.flowByEdge` is a fresh object per
// `beginTransition` and kept by reference across every τ tick, so a frame that
// only advances τ hits this cache and never re-sorts; every one of the (up to
// hundreds of) LoopEdge consumers in a step shares the single computed set.
let cache: { key: object; set: ReadonlySet<string> } | null = null

/** The ≤ `MAX_PLAYBACK_TOKENS_TOTAL` edge-ids that get a TRAVELLING cue this
 *  step — ONE global budget across all three travelling kinds:
 *    • a flowing resource edge's merged transfer token   (rank 0)
 *    • a state `trigger` bead                            (rank 1)
 *    • a state `label` bead with a non-zero delta        (rank 2)
 *  `activator` never travels (it lands a settle-beat cue), so it is not a
 *  candidate and is never budget-gated. An edge carries at most one travelling
 *  cue (resource XOR state), so a plain `Set<edgeId>` is the whole contract:
 *  past the budget an edge keeps its committed value / label and its settle cue,
 *  it just does not animate. */
function budgetSet(t: Transition): ReadonlySet<string> {
  if (cache && cache.key === t.flowByEdge) return cache.set

  // dev-only probe (§PB perf ceiling test) — one increment == one full sort.
  // Tree-shaken from production.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __budgetComputes?: number }
    w.__budgetComputes = (w.__budgetComputes ?? 0) + 1
  }

  const firstEv: Record<string, number> = {}
  t.events.forEach((e, i) => {
    if (!(e.edgeId in firstEv)) firstEv[e.edgeId] = i
  })

  const cand: { edgeId: string; rank: number; ord: number }[] = []
  for (const edgeId of Object.keys(t.flowByEdge)) {
    if ((t.flowByEdge[edgeId] ?? 0) > 0)
      cand.push({ edgeId, rank: KIND_RANK.resource, ord: firstEv[edgeId] ?? 0 })
  }
  t.stateEvents.forEach((e, i) => {
    if (e.effect.kind === 'trigger') cand.push({ edgeId: e.edgeId, rank: KIND_RANK.trigger, ord: i })
    else if (e.effect.kind === 'label' && e.effect.delta !== 0)
      cand.push({ edgeId: e.edgeId, rank: KIND_RANK.label, ord: i })
  })

  // stable key (edgeId, cueKind, originalEventIndex) — a fixed total order
  cand.sort(
    (a, b) =>
      (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0) || a.rank - b.rank || a.ord - b.ord,
  )

  const set = new Set<string>()
  for (const c of cand) {
    if (set.size >= MAX_PLAYBACK_TOKENS_TOTAL) break
    set.add(c.edgeId)
  }
  cache = { key: t.flowByEdge, set }
  return set
}

/** For an edge that IS a travelling-cue candidate this step (a flowing resource
 *  edge, or a state edge with a `trigger` / non-zero `label` event), the global
 *  set of ≤ 60 edge-ids allowed to animate — `set.has(id)` decides whether this
 *  edge's cue travels or is elided. For any other edge the selector returns
 *  `null` both frames, so an idle edge is never re-rendered by the cap. */
export function usePlaybackTravelBudget(edgeId: string): ReadonlySet<string> {
  const t = useSimStore((s) => {
    const tr = s.transition
    if (!tr) return null
    if ((tr.flowByEdge[edgeId] ?? 0) > 0) return tr
    const se = tr.stateEvents.find((e) => e.edgeId === edgeId)
    if (se && (se.effect.kind === 'trigger' || (se.effect.kind === 'label' && se.effect.delta !== 0)))
      return tr
    return null
  })
  return t ? budgetSet(t) : EMPTY
}
