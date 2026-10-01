import type { MessageKey } from '../i18n/locales/en'

// Issue #296 — release notes are DATA, bundled with the app.
//
// One entry per release that has something to tell the user. Nothing here is
// fetched: the list ships inside the bundle, so it reads offline in the PWA and
// in the portable build.
//
// This file is the model only. Nothing in the app reads it yet: the notice, the
// panel and the Help menu entry arrive together in a later change, with the
// first entries. `scripts/check-change-declaration.mjs` already validates
// whatever is written here (`validateReleaseNotes`), so a malformed entry never
// reaches `main`.

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

/** Newest first. Past entries are never rewritten. */
export const RELEASE_NOTES: readonly ReleaseNote[] = []

/** the entry an automatic notice would be about, if there is one */
export const newestReleaseNote = (notes: readonly ReleaseNote[] = RELEASE_NOTES): ReleaseNote | undefined => notes[0]
