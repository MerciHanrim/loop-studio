import type { MessageKey } from '../i18n/locales/en'

// Issue #296 — release notes are DATA, bundled with the app.
//
// One entry per release that has something to tell the user. Nothing here is
// fetched: the list ships inside the bundle, so it reads offline in the PWA and
// in the portable build.
//
// The update notice names the newest entry's version, the What's new panel
// lists every entry, and the Help menu's `New` marker stays until the newest
// one has been opened (`src/store/whatsNewStore.ts`).
// `scripts/check-change-declaration.mjs` validates whatever is written here
// (`validateReleaseNotes`), so a malformed entry never reaches `main`.

/** `release:<semver>` — what decides whether a notice is shown. Never a version
 *  comparison: an id is either the one a profile has already been told about,
 *  or it is not. */
export type ReleaseNoteId = `release:${string}`

export type ReleaseNote = {
  id: ReleaseNoteId
  /** the real app version this entry shipped in (`package.json`'s `version`) */
  version: string
  /** the release date, `YYYY-MM-DD` */
  date: string
  /** three to five things the user notices, as catalog keys, so every shipped
   *  language carries every line */
  items: readonly MessageKey[]
}

/** the id an entry for `version` must carry */
export const releaseNoteIdFor = (version: string): ReleaseNoteId => `release:${version}`

/**
 * Newest first. Past entries are never rewritten.
 *
 * An item says what a person notices, in their language: no internal
 * mechanics, no test counts, no pull-request numbers.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    // issue #330 PR 1 - playback shows the path a Gate took, every amount as a
    // `+N` badge beside its moving marker, the label rule, Focus mode on
    // connections and the 24-marker cap; the date is the day it is deployed,
    // set right before the merge
    id: 'release:0.22.0',
    version: '0.22.0',
    date: '2026-10-08',
    items: ['whatsNew.v0220.gate', 'whatsNew.v0220.badge', 'whatsNew.v0220.label', 'whatsNew.v0220.focus', 'whatsNew.v0220.cap'],
  },
  {
    // issues #338 + #340 - the Controls rail keeps its two frame buttons,
    // disabled, while the canvas is locked, so the other buttons no longer
    // move; and a phone's text fields are at least 16 px, so focusing the
    // language search no longer zooms the page in; the date is the day it is
    // deployed, set right before the merge
    id: 'release:0.21.4',
    version: '0.21.4',
    date: '2026-10-08',
    items: ['whatsNew.v0214.rail', 'whatsNew.v0214.tool', 'whatsNew.v0214.keys', 'whatsNew.v0214.zoom'],
  },
  {
    // issues #334 + #335 - a new document starts unlocked with an empty undo
    // history, the edit lock refuses every edit, and the lock button shows its
    // state; the date is the day it is deployed, set right before the merge
    id: 'release:0.21.3',
    version: '0.21.3',
    date: '2026-10-08',
    items: ['whatsNew.v0213.fresh', 'whatsNew.v0213.locked', 'whatsNew.v0213.shows'],
  },
  {
    // issue #332 - a Pool's, a Parameter's and a Register's value and detail
    // rows start at the title and stay inside the drawn outline; the date is
    // the day it is deployed, set right before the merge
    id: 'release:0.21.2',
    version: '0.21.2',
    date: '2026-10-07',
    items: ['whatsNew.v0212.aligned', 'whatsNew.v0212.wider', 'whatsNew.v0212.same'],
  },
  {
    // issue #329 - Focus mode dims the connections outside the focus set (an
    // inline opacity beat the rule); the date is the day it is deployed, set
    // right before the merge
    id: 'release:0.21.1',
    version: '0.21.1',
    date: '2026-10-07',
    items: ['whatsNew.v0211.dim', 'whatsNew.v0211.kept', 'whatsNew.v0211.contrast'],
  },
  {
    // issue #325 PR 3 - compact nodes: a 56 px floor instead of 64, less side
    // padding, content still deciding; the date is the day it is deployed, set
    // right before the merge
    id: 'release:0.21.0',
    version: '0.21.0',
    date: '2026-10-07',
    items: ['whatsNew.v0210.compact', 'whatsNew.v0210.grows', 'whatsNew.v0210.same'],
  },
  {
    // issue #325 PR 2 - flow colours in the minimap, the timeline and three
    // bundled templates, each colour offered once in the Inspector, and a
    // one-line colour summary on the phone; the date is the day it is
    // deployed, set right before the merge
    id: 'release:0.20.0',
    version: '0.20.0',
    date: '2026-10-07',
    items: ['whatsNew.v0200.views', 'whatsNew.v0200.templates', 'whatsNew.v0200.once', 'whatsNew.v0200.phone'],
  },
  {
    // issue #325 PR 1 - flow colours on nodes and edges, and a selection that
    // stays clear on any colour; the date is the day it is deployed, set right
    // before the merge
    id: 'release:0.19.0',
    version: '0.19.0',
    date: '2026-10-06',
    items: ['whatsNew.v0190.colour', 'whatsNew.v0190.keep', 'whatsNew.v0190.select', 'whatsNew.v0190.notice'],
  },
  {
    // issue #308 - the guided tour announces each step once and never drops
    // focus; the date is the day it is deployed, set right before the merge
    id: 'release:0.18.2',
    version: '0.18.2',
    date: '2026-10-06',
    items: ['whatsNew.v0182.steps', 'whatsNew.v0182.focus', 'whatsNew.v0182.end'],
  },
  {
    // issue #307 - one keyboard contract for every menu, and the phone's
    // sheets taking focus and stepping back one level; the date is the day it
    // is deployed, set right before the merge
    id: 'release:0.18.1',
    version: '0.18.1',
    date: '2026-10-06',
    items: ['whatsNew.v0181.open', 'whatsNew.v0181.move', 'whatsNew.v0181.phone'],
  },
  {
    // issue #301 - the third-party open-source licences, in the About dialog;
    // the date is the day it is deployed, set right before the merge
    id: 'release:0.18.0',
    version: '0.18.0',
    date: '2026-10-05',
    items: ['whatsNew.v0180.licenses', 'whatsNew.v0180.offline', 'whatsNew.v0180.own'],
  },
  {
    // the temporary-session chip takes the box of the toolbar's menu buttons;
    // the date is the day it is deployed, set right before the merge
    id: 'release:0.17.2',
    version: '0.17.2',
    date: '2026-10-05',
    items: ['whatsNew.v0172.size', 'whatsNew.v0172.text', 'whatsNew.v0172.same'],
  },
  {
    // issue #301 decision 1 - share links use only the browser's own compression
    id: 'release:0.17.1',
    version: '0.17.1',
    date: '2026-10-04',
    items: ['whatsNew.v0171.compression', 'whatsNew.v0171.unavailable', 'whatsNew.v0171.compatible'],
  },
  {
    // the date is the day it is deployed, set right before the merge (issue #300)
    id: 'release:0.17.0',
    version: '0.17.0',
    date: '2026-10-04',
    items: ['whatsNew.v0170.protect', 'whatsNew.v0170.open', 'whatsNew.v0170.limits', 'whatsNew.v0170.plain'],
  },
  {
    // the date is the day it is deployed, set right before the merge (issue #297)
    id: 'release:0.16.0',
    version: '0.16.0',
    date: '2026-10-04',
    items: ['whatsNew.v0160.gate', 'whatsNew.v0160.temporary', 'whatsNew.v0160.settings', 'whatsNew.v0160.share', 'whatsNew.v0160.portable'],
  },
  {
    id: 'release:0.15.3',
    version: '0.15.3',
    date: '2026-10-03',
    items: ['whatsNew.v0153.icons', 'whatsNew.v0153.names', 'whatsNew.v0153.canvas'],
  },
  {
    id: 'release:0.15.2',
    version: '0.15.2',
    date: '2026-10-03',
    items: ['whatsNew.v0152.themeBack', 'whatsNew.v0152.noFlash', 'whatsNew.v0152.unknownValue'],
  },
  {
    id: 'release:0.15.1',
    version: '0.15.1',
    date: '2026-10-03',
    items: ['whatsNew.v0151.mobileBar', 'whatsNew.v0151.desktopStrip', 'whatsNew.v0151.sheets'],
  },
  {
    id: 'release:0.15.0',
    version: '0.15.0',
    date: '2026-10-03',
    items: ['whatsNew.v0150.notes', 'whatsNew.v0150.help', 'whatsNew.v0150.timeline', 'whatsNew.v0150.look'],
  },
  {
    // history: the release that was current when this list began
    id: 'release:0.14.0',
    version: '0.14.0',
    date: '2026-09-30',
    items: ['whatsNew.v0140.languages', 'whatsNew.v0140.rtl', 'whatsNew.v0140.frames', 'whatsNew.v0140.csv'],
  },
]

/** the entry an automatic notice would be about, if there is one */
export const newestReleaseNote = (notes: readonly ReleaseNote[] = RELEASE_NOTES): ReleaseNote | undefined => notes[0]
