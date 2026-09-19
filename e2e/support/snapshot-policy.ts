// Visual snapshot tolerance policy — docs/visual-snapshot-policy.md.
//
// One `maxDiffPixelRatio` per CAPTURE KIND, not one global number. The ratio a
// screenshot is allowed to differ by is a property of what the shot frames:
// a 1280×800 page full of toolbar text moves ~0.35 % between a Windows 11
// machine and the windows-latest runner (font rasterisation), a 980×462 canvas
// clip moves 0.003 %, an element capture 0 %. A single 2 % gate hid eight
// releases of drift (audit 2026-09-18); a single 0.5 % gate would still miss
// every rail / panel / value change on a canvas clip. Measured basis and the
// per-kind headroom are in the doc.
//
// This file is PLAIN DATA + lookups (no Playwright import) so that
// scripts/check-snapshot-policy.mjs can load it under Node. The runtime helper
// that applies it is `snap()` in e2e/support/loop.ts.

export const SNAPSHOT_POLICY = {
  /** `expect(page).toHaveScreenshot` at the desktop viewport (1280×800). */
  'desktop-full-page': { maxDiffPixelRatio: 0.005, size: [1280, 800] as const },
  /** `.react-flow` clip at the desktop viewport (980×462). */
  'desktop-canvas-clip': { maxDiffPixelRatio: 0.0002, size: [980, 462] as const },
  /** `.react-flow` clip under the `mobile` project (390×735). */
  'mobile-canvas-clip': { maxDiffPixelRatio: 0.001, size: [390, 735] as const },
  /** `expect(page).toHaveScreenshot` under the `mobile` project (390×844). */
  'mobile-full-page': { maxDiffPixelRatio: 0.001, size: [390, 844] as const },
  /** A single component (Inspector, dialog, minimap, Distribution panel …). Any size that is not one of the four above. */
  element: { maxDiffPixelRatio: 0.0005, size: null },
} as const

export type SnapshotKind = keyof typeof SNAPSHOT_POLICY
export type SnapshotProject = 'chromium' | 'mobile'

/** The global `expect.toHaveScreenshot.maxDiffPixelRatio` in playwright.config.ts.
 *  It only ever applies to a shot that bypassed `snap()` — the guard forbids
 *  that — and it must never be looser than the loosest policy. */
export const SNAPSHOT_FALLBACK_RATIO: number = Math.max(
  ...Object.values(SNAPSHOT_POLICY).map((p) => p.maxDiffPixelRatio),
)

/** Every committed baseline, by file stem (`<stem>-<project>-win32.png`), with
 *  its kind under each project that captures it. This is the single source of
 *  truth: `snap()` reads it at runtime, the guard checks it against the files
 *  on disk (present ↔ listed, size ↔ kind) and against every `toHaveScreenshot`
 *  call in e2e/. Adding a snapshot = add its stem here first. */
export const SNAPSHOTS: Record<string, Partial<Record<SnapshotProject, SnapshotKind>>> = {
  // canvas-refresh-visual.spec.ts — the LOD × theme matrix, both projects
  'matrix-light-L0': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'matrix-light-L1': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'matrix-light-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'matrix-dark-L0': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'matrix-dark-L1': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'matrix-dark-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'forced-colors-L0': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'forced-colors-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  // playback-visual.spec.ts — depart beat / L0 elision, both projects
  'play-depart-light-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'play-depart-dark-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'play-depart-forced-colors-L2': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  'play-travel-L0': { chromium: 'desktop-canvas-clip', mobile: 'mobile-canvas-clip' },
  // large-graph-readability.spec.ts
  'run-distinction-states': { chromium: 'desktop-canvas-clip' },
  'frames-activity': { chromium: 'desktop-canvas-clip' },
  'auto-frames': { chromium: 'desktop-canvas-clip' },
  'auto-frames-mixed': { chromium: 'desktop-canvas-clip' },
  'frame-colours': { chromium: 'desktop-full-page' },
  'frame-colours-dark': { chromium: 'desktop-full-page' },
  'frame-colours-overlap': { chromium: 'desktop-full-page' },
  'frame-colours-forced': { chromium: 'desktop-full-page' },
  // model-nodes-visual.spec.ts
  'register-unit-row': { chromium: 'desktop-canvas-clip' },
  // i18n-visual.spec.ts — representative KO scenes
  'ko-desktop-app': { chromium: 'desktop-full-page' },
  'ko-export-menu': { chromium: 'desktop-full-page' },
  'ko-long-label-and-tip': { chromium: 'desktop-full-page' },
  'ko-mobile-app': { chromium: 'mobile-full-page' }, // a 390×844 viewport set by test.use() inside the chromium project
  'ko-inspector': { chromium: 'element' },
  // data-import-guide.spec.ts — the import dialog itself (docs/data-import.md §DI17)
  'data-import-quickstart': { chromium: 'element' },
  'data-import-inline-errors': { chromium: 'element' },
  'ko-monte-carlo': { chromium: 'element' },
  'ko-review': { chromium: 'element' },
  // state-ui.spec.ts / minimap.spec.ts / visual.spec.ts — element captures
  'state-inspector-light': { chromium: 'element' },
  'state-inspector-dark': { chromium: 'element' },
  'minimap-light': { chromium: 'element' },
  'minimap-dark': { chromium: 'element' },
  'distribution-light': { chromium: 'element' },
  'distribution-dark': { chromium: 'element' },
}

/** The kind a baseline is judged under, or a thrown error when the stem /
 *  project pair is not registered — a new shot can never fall through to the
 *  global fallback silently. */
export function snapshotKind(stem: string, project: string): SnapshotKind {
  const entry = SNAPSHOTS[stem]
  const kind = entry?.[project as SnapshotProject]
  if (!kind) {
    throw new Error(
      `snapshot "${stem}" has no tolerance policy for project "${project}" — register it in e2e/support/snapshot-policy.ts (SNAPSHOTS) with its capture kind`,
    )
  }
  return kind
}

/** Parse `<stem>-<project>-win32.png` (Playwright's `{arg}{-projectName}-{platform}{ext}`). */
export function parseBaselineName(fileName: string): { stem: string; project: string; platform: string } | null {
  const m = /^(.+)-(chromium|mobile)-(win32|linux|darwin)\.png$/.exec(fileName)
  return m ? { stem: m[1], project: m[2], platform: m[3] } : null
}
