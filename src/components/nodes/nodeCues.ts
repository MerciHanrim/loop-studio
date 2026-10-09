// issue #330 PR 2 (v0.23.0) — when the cues INSIDE a node play, read from the
// playback transition (docs/simulation-playback.md §PB2.1, §PB9;
// docs/simulation-playback-ordering.md §PBO3). A presentation layer only: it
// reads the store, never writes it.
//
// - Pool arrival pulse: starts the moment the first round token reaches the
//   Pool (that connection's arrive beat), runs a fixed time, and carries on
//   across the settle under the same key; it restarts only at that Pool's next
//   arrival. The value still changes at settle. Past the 24 pairs and at L0 the
//   pulse plays at the same moment, without a token.
// - Conversion mark: shown from the Converter's own onset (its pull-in and
//   push-out share one onset) through the settle, then fades.
//
// The per-node moments are derived ONCE per transition (keyed on its
// `flowByEdge` identity, which every τ tick carries by reference) and once per
// committed step (keyed on `activeByEdge`), so a τ frame reads two map lookups.

import { useGraphStore } from '../../store/graphStore'
import { BEAT_ARRIVE, BEAT_SETTLE, useSimStore } from '../../store/simStore'

type Transition = NonNullable<ReturnType<typeof useSimStore.getState>['transition']>

/** the global τ at which a connection with onset `o` reaches its arrive beat
 *  (LoopEdge's local τ: `τ` itself at onset 0, else `(τ − o) / (SETTLE − o)`) */
export const arriveTauOf = (o: number): number => (o <= 0 ? BEAT_ARRIVE : o + BEAT_ARRIVE * (BEAT_SETTLE - o))

type StepCues = {
  /** poolId → the τ its first token arrives */
  arrive: Map<string, number>
  /** converterId → the τ its connections start (the earliest onset) */
  convert: Map<string, number>
}
const stepCues = new WeakMap<object, StepCues>()

function cuesOf(t: Transition): StepCues {
  const hit = stepCues.get(t.flowByEdge)
  if (hit) return hit
  const kind = new Map(useGraphStore.getState().nodes.map((n) => [n.id, n.data.kind]))
  const arrive = new Map<string, number>()
  const convert = new Map<string, number>()
  for (const ev of t.events) {
    if (!(ev.amount > 0)) continue
    const onset = t.onsetByEdge[ev.edgeId] ?? 0
    if (kind.get(ev.to) === 'pool') {
      const at = arriveTauOf(onset)
      const was = arrive.get(ev.to)
      if (was === undefined || at < was) arrive.set(ev.to, at)
    }
    for (const id of [ev.from, ev.to]) {
      if (kind.get(id) !== 'converter') continue
      const was = convert.get(id)
      if (was === undefined || onset < was) convert.set(id, onset)
    }
  }
  const c = { arrive, convert }
  stepCues.set(t.flowByEdge, c)
  return c
}

/** the Converters a committed step moved something into or out of */
const convertedCache = new WeakMap<object, Set<string>>()
function convertedIn(activeByEdge: Record<string, number>): Set<string> {
  const hit = convertedCache.get(activeByEdge)
  if (hit) return hit
  const { nodes, edges } = useGraphStore.getState()
  const conv = new Set(nodes.filter((n) => n.data.kind === 'converter').map((n) => n.id))
  const out = new Set<string>()
  for (const e of edges) {
    if (!((activeByEdge[e.id] ?? 0) > 0)) continue
    if (conv.has(e.source)) out.add(e.source)
    if (conv.has(e.target)) out.add(e.target)
  }
  convertedCache.set(activeByEdge, out)
  return out
}

/** The Pool arrival pulse's key — the step it belongs to — or null for none.
 *  The same number before and after the settle, so the pulse is not
 *  restarted there; a new one starts at the next arrival. */
export function usePoolPulseKey(id: string): number | null {
  return useSimStore((s) => {
    const t = s.transition
    if (t) {
      const at = cuesOf(t).arrive.get(id)
      if (at != null && t.tau >= at) return t.fromStep + 1
    }
    return s.arrivedPoolIds.includes(id) ? s.stepIndex : null
  })
}

/** The conversion mark's state: `<step>:live` while the step's tokens move,
 *  `<step>:done` once it has settled (it fades), or null. */
export function useConversionMark(id: string): string | null {
  return useSimStore((s) => {
    const t = s.transition
    if (t) {
      const at = cuesOf(t).convert.get(id)
      if (at != null && t.tau >= at) return `${t.fromStep + 1}:live`
    }
    return convertedIn(s.activeByEdge).has(id) ? `${s.stepIndex}:done` : null
  })
}
