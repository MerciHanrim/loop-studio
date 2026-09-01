import type { MessageKey } from '../i18n'
import type { TourPlatform } from '../store/tourStore'

// docs/guided-tour.md §GT2 / §GT3 / §GT5 — the fixed six-step scripts. A step
// points at a stable region by a `sel` (a `[data-tour="…"]` attribute for
// chrome; a plain selector where the target is not chrome, e.g. a node). A step
// whose element is missing renders the centred fallback card (§GT4).

export type TourStep = {
  id: string
  /** CSS selector for the highlighted region; missing element ⇒ fallback card */
  sel: string
  titleKey: MessageKey
  bodyKey: MessageKey
}

const DESKTOP: TourStep[] = [
  { id: 'pieces', sel: '[data-tour="palette"]', titleKey: 'tour.desktop.pieces.title', bodyKey: 'tour.desktop.pieces.body' },
  { id: 'canvas', sel: '[data-tour="canvas"]', titleKey: 'tour.desktop.canvas.title', bodyKey: 'tour.desktop.canvas.body' },
  { id: 'inspector', sel: 'aside.inspector', titleKey: 'tour.desktop.inspector.title', bodyKey: 'tour.desktop.inspector.body' },
  { id: 'playback', sel: '[data-tour="playback"]', titleKey: 'tour.desktop.playback.title', bodyKey: 'tour.desktop.playback.body' },
  { id: 'timeline', sel: '[data-tour="timeline"]', titleKey: 'tour.desktop.timeline.title', bodyKey: 'tour.desktop.timeline.body' },
  { id: 'files', sel: '[data-tour="files"]', titleKey: 'tour.desktop.files.title', bodyKey: 'tour.desktop.files.body' },
]

// §GT3 — a different script, not a shrunk desktop tour. Step 6 points at the
// CLOSED `⋯` button and opens nothing (§GT3 note).
const MOBILE: TourStep[] = [
  { id: 'open', sel: '[data-tour="mobile-open"]', titleKey: 'tour.mobile.open.title', bodyKey: 'tour.mobile.open.body' },
  { id: 'canvas', sel: '[data-tour="canvas"]', titleKey: 'tour.mobile.canvas.title', bodyKey: 'tour.mobile.canvas.body' },
  { id: 'inspect', sel: '.react-flow__node', titleKey: 'tour.mobile.inspect.title', bodyKey: 'tour.mobile.inspect.body' },
  { id: 'run', sel: '[data-tour="mobile-run"]', titleKey: 'tour.mobile.run.title', bodyKey: 'tour.mobile.run.body' },
  { id: 'timeline', sel: '[data-tour="mobile-timeline"]', titleKey: 'tour.mobile.timeline.title', bodyKey: 'tour.mobile.timeline.body' },
  { id: 'more', sel: '[data-tour="mobile-more"]', titleKey: 'tour.mobile.more.title', bodyKey: 'tour.mobile.more.body' },
]

export const tourScript = (platform: TourPlatform): TourStep[] =>
  platform === 'mobile' ? MOBILE : DESKTOP
