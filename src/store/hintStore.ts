import { create } from 'zustand'
import { useTourStore } from './tourStore'

// docs/contextual-inline-help.md — situational, dismissible hints that fill
// the gap the guided tour (docs/guided-tour.md) deliberately left (§CIH0): an
// empty canvas, Monte Carlo / Review's first open, and Focus/Filter discovery
// on a graph past WORTH_IT_FLOOR. Presentation only — nothing here is
// serialized, digested, undone, or seen by the engine (§CIH7).
//
// `seen` is recorded the INSTANT a hint's <HintNote> first renders (§CIH2.1a)
// — not gated on the ✕ click. A user who reads a hint once and simply closes
// the surrounding dialog (the normal thing to do) never sees it again; the ✕
// only ever hides that one currently-mounted instance (`closedThisInstance`,
// local to the component in HintNote.tsx).

export type HintId = 'empty-canvas' | 'mc-first-open' | 'review-first-open' | 'focus-filter-discovery'

export const HINT_STORAGE_KEY = 'loop-studio/contextual-help/1'

/** §CIH2.3a — Focus/Filter's post-tour-close breather. Not a structural
 *  decision (§CIH9) — tune freely. */
export const POST_TOUR_COOLDOWN_MS = 2000
/** §CIH3 #4 — how long a large graph waits for a real interaction before the
 *  Focus/Filter hint shows anyway. Not a structural decision (§CIH9). */
export const LARGE_GRAPH_HINT_DELAY_MS = 4000

type StoredSeen = Partial<Record<HintId, true>>

/** A missing, corrupt, or unparsable value reads as "nothing seen yet" —
 *  never as "everything permanently dismissed" (§GT6.3 precedent). */
function readSeen(): StoredSeen {
  try {
    const raw = localStorage.getItem(HINT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: StoredSeen = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k as HintId] = true
    }
    return out
  } catch {
    return {}
  }
}

function writeSeen(seen: StoredSeen): void {
  try {
    localStorage.setItem(HINT_STORAGE_KEY, JSON.stringify(seen))
  } catch {
    /* non-fatal — the in-memory state still updates for the session */
  }
}

type HintState = {
  seen: StoredSeen
  /** Record-on-render (§CIH2.1a). No-ops if already seen. */
  markSeen: (id: HintId) => void
  /** Help → "Show again next time" (§CIH4). Clears the persisted flag; does
   *  NOT force a render — the hint's own trigger/tier/cooldown gates decide
   *  when it next shows. */
  rearm: (id: HintId) => void

  /** session-only, not persisted — true once the user has made any canvas
   *  interaction (pan / zoom / selection / node move). §CIH3 #4's gate. */
  hasInteracted: boolean
  markInteracted: () => void
  /** session-only — true once `LARGE_GRAPH_HINT_DELAY_MS` has passed since
   *  the app settled, satisfying §CIH3 #4's gate without an interaction. */
  largeGraphDelayElapsed: boolean
  /** session-only — true for `POST_TOUR_COOLDOWN_MS` right after the guided
   *  tour closes (§CIH2.3a), suppressing tier-3 (discovery) hints. */
  postTourCooldownActive: boolean
}

export const useHintStore = create<HintState>((set, get) => ({
  seen: readSeen(),
  markSeen: (id) => {
    if (get().seen[id]) return
    const next = { ...get().seen, [id]: true as const }
    writeSeen(next)
    set({ seen: next })
  },
  rearm: (id) => {
    if (!get().seen[id]) return
    const next = { ...get().seen }
    delete next[id]
    writeSeen(next)
    set({ seen: next })
  },

  hasInteracted: false,
  markInteracted: () => {
    if (!get().hasInteracted) set({ hasInteracted: true })
  },
  largeGraphDelayElapsed: false,
  postTourCooldownActive: false,
}))

// §CIH3 #4 — start the delay clock once the app has settled (the same
// signal the tour itself waits on before offering the Welcome card).
let delayTimer: ReturnType<typeof setTimeout> | null = null
// §CIH2.3a — the post-tour cooldown: a tour that goes from an active phase
// (welcome / running) back to idle (finish, dismiss, or a Welcome-card skip)
// arms a short window during which tier-3 hints stay quiet.
let cooldownTimer: ReturnType<typeof setTimeout> | null = null

useTourStore.subscribe((state, prev) => {
  if (!prev.appSettled && state.appSettled && !delayTimer) {
    delayTimer = setTimeout(() => {
      useHintStore.setState({ largeGraphDelayElapsed: true })
    }, LARGE_GRAPH_HINT_DELAY_MS)
  }
  const wasActive = prev.phase !== 'idle'
  const isIdleNow = state.phase === 'idle'
  if (wasActive && isIdleNow) {
    useHintStore.setState({ postTourCooldownActive: true })
    if (cooldownTimer) clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      useHintStore.setState({ postTourCooldownActive: false })
    }, POST_TOUR_COOLDOWN_MS)
  }
})

/** §CIH2.3a — the post-tour cooldown, shared by every TIER-3 (discovery)
 *  hint: empty-canvas (#1) and Focus/Filter (#4). Tier-1 hints (#2, #3) do
 *  not use this — they only ever appear because the user just took a
 *  deliberate action, not a pile-up risk the same way a passive canvas note
 *  is right after the tour closes. */
export function useTier3Ready(): boolean {
  return !useHintStore((s) => s.postTourCooldownActive)
}

/** §CIH3 #4 only — the interaction-or-delay gate on top of §useTier3Ready:
 *  a real canvas interaction satisfies it immediately; otherwise it waits
 *  out `LARGE_GRAPH_HINT_DELAY_MS`. Not used by any other hint. */
export function useLargeGraphInteractionGate(): boolean {
  const interacted = useHintStore((s) => s.hasInteracted)
  const delayElapsed = useHintStore((s) => s.largeGraphDelayElapsed)
  return interacted || delayElapsed
}

// dev-only test hook, mirrors tourStore's __resetTourSession — lets a spec
// reset the module-level timers between runs without a full reload.
export const __resetHintTimers = (): void => {
  if (delayTimer) {
    clearTimeout(delayTimer)
    delayTimer = null
  }
  if (cooldownTimer) {
    clearTimeout(cooldownTimer)
    cooldownTimer = null
  }
}
