import { readFileSync } from 'node:fs'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { RELEASE_NOTES } from '../../src/releaseNotes/releaseNotes'
import { compareVersions, parseVersion } from '../../src/releaseNotes/validate'

// Issue #296 — every spec that pre-dismisses the guided tour makes its profile a
// RETURNING one: the tour key is a trace of a person. A returning profile that
// has not been told about the newest release note gets the update notice, and
// that would put a card on the canvas of every such spec.
//
// So wherever a spec seeds the tour key, it also says "this profile has already
// been told about the newest release, and has opened it". The id is read from
// the product's own list, so the next release needs no change here.
//
// `e2e/whats-new.spec.ts` is the one spec that leaves these keys alone.

export const ANNOUNCED_KEY = 'loop-studio/whats-new/announced/1'
export const OPENED_KEY = 'loop-studio/whats-new/opened/1'

/** the release note an automatic notice would be about */
export const NEWEST_RELEASE = RELEASE_NOTES[0]!

export const WHATS_NEW_SEEN = { announcedKey: ANNOUNCED_KEY, openedKey: OPENED_KEY, id: NEWEST_RELEASE.id as string, mode: 'personal' }
export type WhatsNewSeen = typeof WHATS_NEW_SEEN

/** Runs IN THE PAGE (serialized by Playwright), so it uses only its argument.
 *  A value that is already there is kept: a spec that writes its own, or the
 *  app's own write followed by a reload, is not overwritten. */
export function seedWhatsNewSeenScript(s: WhatsNewSeen): void {
  try {
    // issue #297 - a returning profile that is also a remembered browser of
    // kind `mode` (personal unless the spec says otherwise), so the storage
    // gate does not stand in front of the spec; `gate` leaves the key alone
    if (s.mode !== 'gate' && !localStorage.getItem('loop-studio:storage-mode')) localStorage.setItem('loop-studio:storage-mode', s.mode)
    if (!localStorage.getItem(s.announcedKey)) localStorage.setItem(s.announcedKey, s.id)
    if (!localStorage.getItem(s.openedKey)) localStorage.setItem(s.openedKey, s.id)
  } catch {
    /* storage blocked or an opaque origin: the app then shows no automatic notice at all */
  }
}

/** Register the seed for every document the page or context loads. Call it
 *  AFTER an init script that clears storage. `mode` is the storage mode the
 *  profile remembers (`personal` | `temporary`), or `gate` for none. */
export async function seedWhatsNewSeen(target: Page | BrowserContext, mode: string = 'personal'): Promise<void> {
  await target.addInitScript(seedWhatsNewSeenScript, { ...WHATS_NEW_SEEN, mode })
}

// ── one build, one version ──────────────────────────────────────────────────
//
// About says which version is running and What's new says which release is the
// newest. They are two screens of the same build and nothing compared them.
// MEASURED when it went wrong: a dev server that had been left running since
// before the version was raised drew `v0.14.0` in About beside a What's new
// panel whose first entry was `v0.15.0`. `vite.config.ts` reads the version and
// the commit once, when the server or the build starts; the release notes are
// source and are read on every request.

/** the app version, from the one file a release raises it in. Read, never
 *  typed: a number written into a test restates the bump instead of checking it */
export const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version

/** said wherever a version on screen is compared with `package.json` */
export const VERSION_IS_READ_ONCE =
  'A dev server reads the version once, when it starts: one left running across a version change keeps the old number. Restart it.'

/** the version line of an OPEN About dialog: `v0.15.0 · build 61ca4a0` */
export async function readAboutVersion(page: Page): Promise<{ version: string; build: string }> {
  const line = (await page.locator('.mcdlg--about .about__version').innerText()).trim()
  const m = /^v(\d+\.\d+\.\d+)(?: · build (\S+))?$/.exec(line)
  expect(m, `the About dialog's version line reads "${line}"`).not.toBeNull()
  return { version: m![1]!, build: m![2] ?? '' }
}

/** the version of the first entry in an OPEN What's new panel */
export async function readNewestShown(page: Page): Promise<string> {
  const text = await page
    .locator('[data-whatsnew="panel"] .whatsnew__version')
    .first()
    .evaluate((el) => el.firstChild?.textContent ?? '')
  expect(text, 'the first entry of the What’s new panel names a version').toMatch(/^v\d+\.\d+\.\d+$/)
  return text.slice(1)
}

/**
 * What the two screens must say, given what the tree says.
 *
 * - About shows the version in `package.json`.
 * - The first entry on screen is the newest entry in the list.
 * - The newest entry is never ahead of the app.
 * - They are the SAME number exactly when the list has an entry for the app's
 *   version. Every user-facing change must add that entry, so that is the
 *   ordinary state. The app may be ahead only after an `internal` change that
 *   raised the version and has no note (docs/release-notes.md).
 */
export function expectOneVersionStory(about: string, newestShown: string): void {
  expect(about, `About shows v${about} and package.json says ${PACKAGE_VERSION}. ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)
  expect(newestShown, 'the first entry on screen is the newest entry in the list').toBe(NEWEST_RELEASE.version)
  expect(
    compareVersions(parseVersion(newestShown)!, parseVersion(about)!),
    `What’s new announces v${newestShown}, which is ahead of the v${about} that About shows`,
  ).toBeLessThanOrEqual(0)
  const listHasTheAppVersion = RELEASE_NOTES.some((n) => n.version === PACKAGE_VERSION)
  expect(
    newestShown === about,
    `About shows v${about} and What’s new starts at v${newestShown}; the list ${listHasTheAppVersion ? 'has' : 'has no'} entry for the app version`,
  ).toBe(listHasTheAppVersion)
}
