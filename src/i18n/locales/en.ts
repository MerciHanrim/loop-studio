// docs/localization.md §L3.3 — the CANONICAL catalog. `en.ts` defines the key
// set and the message shape; every other locale is `… satisfies MessageCatalog`
// so `tsc` fails on a missing or an extra key. Keys are flat, stable, ASCII IDs
// — never the English text, never derived from user data. Values are ICU
// messages (`intl-messageformat`); a `{name}` slot is a runtime value, never a
// concatenated translatable fragment (§L4.2). No rich-text tags in Slice 1
// (§L4.1).
//
// Slice 1 scope (§L13): the Toolbar + the Play bar (desktop and mobile) and the
// PlaybackAnnouncer live-region templates. Everything else stays English until
// Slice 2a / 2b.

const en = {
  // ── i18n internals ─────────────────────────────────────────────────────
  // shown only if a message fails to format even after the `en` fallback
  // (§L4.4) — a stable notice carrying the key, never the raw ICU pattern.
  'i18n.messageError': 'text unavailable ({key})',

  // ── Toolbar / brand ────────────────────────────────────────────────────
  'toolbar.preview': 'preview',
  'toolbar.buildTitle': 'Loop Studio v{version} · build {sha}',

  // node palette — the BUTTON label only. The node a click creates keeps the
  // locale-independent `defaultData()` label (§L3.4).
  'toolbar.node.pool': 'Pool',
  'toolbar.node.source': 'Source',
  'toolbar.node.drain': 'Drain',
  'toolbar.node.gate': 'Gate',
  'toolbar.node.converter': 'Converter',
  'toolbar.node.end': 'End',
  'toolbar.node.parameter': 'Parameter',
  'toolbar.node.register': 'Register',
  'toolbar.node.addTitle': 'Add {name} — drag onto the canvas, or click',

  'toolbar.undo.title': 'Undo (Ctrl/Cmd+Z)',
  'toolbar.redo.title': 'Redo (Ctrl/Cmd+Shift+Z)',
  'toolbar.new': 'New',
  'toolbar.import': 'Import',

  'toolbar.newGraph.title': 'Start a new graph?',
  'toolbar.newGraph.body': 'Your current graph will be replaced.',
  'toolbar.newGraph.confirm': 'New graph',

  // ── Theme toggle ───────────────────────────────────────────────────────
  'theme.rowLabel': 'Theme',
  'theme.title': 'Theme: system / light / dark',
  'theme.auto': '◐ Auto',
  'theme.light': '☀ Light',
  'theme.dark': '☾ Dark',

  // ── Language menu (auto-generated from the registry) ───────────────────
  'lang.rowLabel': 'Language',
  'lang.title': 'Language',
  'lang.menuLabel': 'Choose a language',
  'lang.loading': 'loading…',

  // ── Play bar (desktop `PlayBar`, mobile `MobileRunBar`) ─────────────────
  'playbar.reset.title': 'Reset to step 0',
  'playbar.step.title': 'Advance one step',
  'playbar.play': '▶ Play',
  'playbar.pause': '⏸ Pause',
  'playbar.replay': '⟳ Replay',
  'playbar.step': 'step {n}',
  'playbar.stepEnded': 'step {n} · ended',
  'playbar.speed': 'speed',
  'playbar.seed': 'seed',
  'playbar.seed.title': 'Random seed — same seed reproduces the run; changing it restarts',
  'playbar.mc': 'Monte Carlo',
  'playbar.mc.withNote': 'Monte Carlo · {note}',
  'playbar.mc.title': 'Run the diagram many times and see the distribution',
  'playbar.mc.progress': 'Monte Carlo {pct}%',
  'playbar.mc.progress.title': 'Monte-Carlo run in progress',
  'playbar.cancel': 'Cancel',
  'playbar.timeline.show': 'Show timeline',
  'playbar.timeline.hide': 'Hide timeline',
  'runbar.ariaLabel': 'Run controls',
  'runbar.mc.cancel': 'MC {pct}% · Cancel',
  'runbar.timeline': 'Timeline',

  // ── Mobile top bar ─────────────────────────────────────────────────────
  'mobile.topbar.caption': 'view & run — edit on desktop',
  'mobile.more': 'More',

  // ── Playback announcer — the a11y live region (logic unchanged) ─────────
  'a11y.playback.started': 'Playback started',
  'a11y.playback.endedAtStep': 'Ended at step {n}',
  'a11y.playback.resetToZero': 'Reset to step 0',
  'a11y.playback.stepN': 'Step {n}',
  'a11y.playback.pausedAtStep': 'Paused at step {n}',
} as const

/** the canonical key set — every catalog is `Record<MessageKey, string>` */
export type MessageKey = keyof typeof en
export type MessageCatalog = Record<MessageKey, string>

export default en
