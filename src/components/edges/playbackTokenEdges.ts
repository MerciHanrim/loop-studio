import { useSimStore } from '../../store/simStore'
import { MAX_PLAYBACK_TOKENS_TOTAL } from './playback-caps'

const EMPTY: ReadonlySet<string> = new Set()
// computed once per transition (keyed on the stable `flowByEdge` reference the
// scheduler carries across τ ticks) and shared by every LoopEdge that asks.
let cache: { key: object; set: ReadonlySet<string> } | null = null

function tokenSet(flowByEdge: Record<string, number>): ReadonlySet<string> {
  if (cache && cache.key === flowByEdge) return cache.set
  const flowing = Object.keys(flowByEdge)
    .filter((id) => (flowByEdge[id] ?? 0) > 0)
    .sort()
  const set: ReadonlySet<string> =
    flowing.length <= MAX_PLAYBACK_TOKENS_TOTAL ? new Set(flowing) : new Set(flowing.slice(0, MAX_PLAYBACK_TOKENS_TOTAL))
  cache = { key: flowByEdge, set }
  return set
}

/** For a *flowing* resource edge, the ≤ MAX_PLAYBACK_TOKENS_TOTAL edge-ids that
 *  render a travelling token this step (§PB4.5) — deterministic, ascending
 *  edgeId. For a non-flowing edge this subscribes to nothing that changes, so
 *  an idle edge is never re-rendered by the cap. */
export function usePlaybackTokenEdges(edgeId: string): ReadonlySet<string> {
  const flowByEdge = useSimStore((s) => {
    const t = s.transition
    if (!t || (t.flowByEdge[edgeId] ?? 0) <= 0) return null
    return t.flowByEdge
  })
  return flowByEdge ? tokenSet(flowByEdge) : EMPTY
}
