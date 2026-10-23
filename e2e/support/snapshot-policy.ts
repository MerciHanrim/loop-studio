// Visual snapshot tolerance policy — docs/visual-snapshot-policy.md.
//
// One `maxDiffPixelRatio` per CAPTURE KIND, not one global number. The ratio a
// screenshot is allowed to differ by is a property of what the shot frames:
// a 1280×800 page full of toolbar text moves ~0.35 % between a Windows 11
// machine and the windows-latest runner (font rasterisation), a canvas clip
// (measured at its earlier 980×462) moves 0.003 %, an element capture 0 %. A single 2 % gate hid eight
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
  /** `.react-flow` clip at the desktop viewport (664×548: since the workbench,
   *  1280 px is the wide band, with the model list (272) and the properties
   *  panel (344) both open; it was 980×462 beside the old 300 px right column). */
  'desktop-canvas-clip': { maxDiffPixelRatio: 0.0002, size: [664, 548] as const },
  /** `.react-flow` clip at `WORKBENCH_ROOMY_VIEWPORT` (1600×940 → 984×688). A
   *  per-scene EXCEPTION, not a second desktop condition: registered only for
   *  a shot whose gesture needs the wider canvas (auto-frames-mixed: a frame
   *  drawn over a row that a 664 px pane does not hold). The canvas clip's
   *  ratio — the same capture, wider. */
  'desktop-roomy-canvas-clip': { maxDiffPixelRatio: 0.0002, size: [984, 688] as const },
  /** `.react-flow` clip under the `mobile` project (390×734: the canvas pane
   *  reserves the run bar's measured 53 px, not a 52 px constant, since issue #303). */
  'mobile-canvas-clip': { maxDiffPixelRatio: 0.001, size: [390, 734] as const },
  /** `expect(page).toHaveScreenshot` under the `mobile` project (390×844). */
  'mobile-full-page': { maxDiffPixelRatio: 0.001, size: [390, 844] as const },
  /** A single component (Inspector, dialog, Distribution panel …). Any size that is not one of the four above. */
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
  // node-structure-matrix-visual.spec.ts — the NEW node's state matrix (every
  // kind × L2 / L1 / L0 × light / dark / forced colours), desktop only
  'node-matrix-light-L2': { chromium: 'desktop-canvas-clip' },
  'node-matrix-light-L1': { chromium: 'desktop-canvas-clip' },
  'node-matrix-light-L0': { chromium: 'desktop-canvas-clip' },
  'node-matrix-dark-L2': { chromium: 'desktop-canvas-clip' },
  'node-matrix-dark-L1': { chromium: 'desktop-canvas-clip' },
  'node-matrix-dark-L0': { chromium: 'desktop-canvas-clip' },
  'node-matrix-forced-L2': { chromium: 'desktop-canvas-clip' },
  'node-matrix-forced-L1': { chromium: 'desktop-canvas-clip' },
  'node-matrix-forced-L0': { chromium: 'desktop-canvas-clip' },
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
  // auto-frames: the two suggested frames do not fit one 664 px pane at their
  // L1 zoom, so two shots (Area 1 selected + the note; Area 2 unselected)
  'auto-frames': { chromium: 'desktop-canvas-clip' },
  'auto-frames-area2': { chromium: 'desktop-canvas-clip' },
  'auto-frames-mixed': { chromium: 'desktop-roomy-canvas-clip' },
  'frame-colours': { chromium: 'desktop-full-page' },
  'frame-colours-dark': { chromium: 'desktop-full-page' },
  'frame-colours-overlap': { chromium: 'desktop-full-page' },
  'frame-colours-forced': { chromium: 'desktop-full-page' },
  // flow-colour-visual.spec.ts — docs/flow-colour-and-compact-nodes.md FC-4;
  // the canvas pane, now the canvas clip's own 664 x 548 (it was 980 x 662
  // with the timeline closed, so `element`, before the workbench)
  'flow-colour-light-L2': { chromium: 'desktop-canvas-clip' },
  'flow-colour-light-L0': { chromium: 'desktop-canvas-clip' },
  'flow-colour-dark-L2': { chromium: 'desktop-canvas-clip' },
  'flow-colour-dark-L0': { chromium: 'desktop-canvas-clip' },
  'flow-colour-states': { chromium: 'desktop-canvas-clip' },
  // flow-colour-views-visual.spec.ts — docs/flow-colour-and-compact-nodes.md
  // FC-6 (PR 2): the timeline panel (`element`; the minimap shots went with
  // the minimap, v0.30.0), and each Template's whole fit — the canvas pane, a
  // `.react-flow` clip since the workbench (664 x 548; it was the 980 x 662
  // pane with the timeline closed, so `element`, until 2026-10-23)
  'flow-views-timeline-light': { chromium: 'element' },
  'flow-views-timeline-dark': { chromium: 'element' },
  'flow-views-forced-timeline': { chromium: 'element' },
  'flow-views-template-coffee-light': { chromium: 'desktop-canvas-clip' },
  'flow-views-template-coffee-dark': { chromium: 'desktop-canvas-clip' },
  'flow-views-template-gacha-light': { chromium: 'desktop-canvas-clip' },
  'flow-views-template-gacha-dark': { chromium: 'desktop-canvas-clip' },
  // flow-colour-mobile.spec.ts — the phone's one-line Colour summary (FC-5)
  'flow-views-phone-summary': { mobile: 'element' },
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
  // forced-colors-edge-tell.spec.ts — the Activity overlay's forced-colors edge tell (§LGR9)
  'forced-active-resource-coffee-z05': { chromium: 'element' },
  'forced-four-state-mmo-z075': { chromium: 'element' },
  // mobile.spec.ts — the More sheet's two toggle rows (§MV5 boundary contrast)
  'mobile-sheet-toggles-light': { mobile: 'element' },
  'mobile-sheet-toggles-dark': { mobile: 'element' },
  'ko-monte-carlo': { chromium: 'element' },
  'ko-review': { chromium: 'element' },
  // state-ui.spec.ts / visual.spec.ts — element captures
  'state-inspector-light': { chromium: 'element' },
  'state-inspector-dark': { chromium: 'element' },
  'distribution-light': { chromium: 'element' },
  'distribution-dark': { chromium: 'element' },
  // lock-control.spec.ts (#335) — the edit-lock button itself, 26 px, both
  // states in every theme
  'lock-light-unlocked': { chromium: 'element' },
  'lock-light-locked': { chromium: 'element' },
  'lock-dark-unlocked': { chromium: 'element' },
  'lock-dark-locked': { chromium: 'element' },
  'lock-forced-unlocked': { chromium: 'element' },
  'lock-forced-locked': { chromium: 'element' },
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
