import { create } from 'zustand'

// docs/guided-tour.md — the guided first-run tour. A UI-chrome-only overlay:
// nothing it does is serialized, digested, undone, or seen by the engine
// (§GT4 / §GT12). Its only persistent trace is one localStorage string (§GT6).

/** §GT6 — the one UI-only key. **Only** `completed | dismissed` are honoured;
 *  both suppress the auto Welcome card equally (§GT6, §GT10). Namespaced like
 *  the ui-locale key. */
export const TOUR_STORAGE_KEY = 'loop-studio/guided-tour/1'
export type TourStored = 'completed' | 'dismissed'

/** The recognised stored value, or `null`. `null` covers **all** of: absent, an
 *  unrecognised / corrupt string, and a read that threw (§GT6.3). A corrupt
 *  value must NOT lock the user out of the tour — it is treated as absent, and
 *  the in-memory `offeredThisSession` flag alone caps the card to once. */
export function readTourKey(): TourStored | null {
  try {
    const v = localStorage.getItem(TOUR_STORAGE_KEY)
    return v === 'completed' || v === 'dismissed' ? v : null
  } catch {
    return null
  }
}
function writeTourKey(v: TourStored): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, v)
  } catch {
    /* §GT6.3 — closing still works; the in-memory flag stops a session loop. */
  }
}

/** §GT6.1 / §GT6.3 — the auto Welcome card is proposed AT MOST ONCE per page
 *  session, whether or not the key can be read/written. */
let offeredThisSession = false
export const __resetTourSession = () => {
  offeredThisSession = false
}

export type TourPlatform = 'desktop' | 'mobile'
export const TOUR_TOTAL = 6

type TourPhase = 'idle' | 'welcome' | 'running'

type TourState = {
  phase: TourPhase
  step: number // 0-based; 0..TOUR_TOTAL-1 while running
  platform: TourPlatform
  /** true when launched from Help → Take a tour: exits never write the key (§GT6.4) */
  replay: boolean
  /** §GT6.1 — set once the boot sequence has settled (locale resolved + the
   *  `#g1=` share link, if any, fully consumed). Set by `ShareLoader`. */
  appSettled: boolean
  markAppSettled: () => void

  /** §GT6.1 — show the auto Welcome card, once per session, only when eligible.
   *  Returns false (and does nothing) if the key is already set or it was
   *  already offered this session. */
  offerWelcome: () => boolean
  /** Welcome → Start tour (§GT6.4: no write). */
  startFromWelcome: (platform: TourPlatform) => void
  /** Welcome → Skip / Escape (§GT6.4: dismissed). */
  skipWelcome: () => void
  /** Help → Take a tour — a replay; exits write nothing (§GT6.4). */
  startReplay: (platform: TourPlatform) => void
  next: () => void
  back: () => void
  /** Tour → Done, the pressed step-6 button (§GT6.4: completed, unless replay). */
  finish: () => void
  /** Tour → Escape / close control, any step (§GT6.4: dismissed, unless replay). */
  dismiss: () => void
}

export const useTourStore = create<TourState>((set, get) => ({
  phase: 'idle',
  step: 0,
  platform: 'desktop',
  replay: false,
  appSettled: false,

  markAppSettled: () => {
    if (!get().appSettled) set({ appSettled: true })
  },

  offerWelcome: () => {
    if (offeredThisSession) return false
    if (get().phase !== 'idle') return false
    offeredThisSession = true // once per session, whatever happens next
    if (readTourKey() != null) return false // a recognised value already decided
    set({ phase: 'welcome', step: 0, replay: false })
    return true
  },

  startFromWelcome: (platform) => set({ phase: 'running', step: 0, platform, replay: false }),

  skipWelcome: () => {
    writeTourKey('dismissed')
    set({ phase: 'idle', step: 0 })
  },

  startReplay: (platform) => set({ phase: 'running', step: 0, platform, replay: true }),

  next: () =>
    set((s) => ({ step: Math.min(s.step + 1, TOUR_TOTAL - 1) })),

  back: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),

  finish: () => {
    if (!get().replay) writeTourKey('completed')
    set({ phase: 'idle', step: 0, replay: false })
  },

  dismiss: () => {
    if (!get().replay) writeTourKey('dismissed')
    set({ phase: 'idle', step: 0, replay: false })
  },
}))
