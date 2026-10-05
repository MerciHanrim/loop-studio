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
