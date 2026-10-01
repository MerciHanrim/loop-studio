import type { BrowserContext, Page } from '@playwright/test'
import { RELEASE_NOTES } from '../../src/releaseNotes/releaseNotes'

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

export const WHATS_NEW_SEEN = { announcedKey: ANNOUNCED_KEY, openedKey: OPENED_KEY, id: NEWEST_RELEASE.id as string }
export type WhatsNewSeen = typeof WHATS_NEW_SEEN

/** Runs IN THE PAGE (serialized by Playwright), so it uses only its argument.
 *  A value that is already there is kept: a spec that writes its own, or the
 *  app's own write followed by a reload, is not overwritten. */
export function seedWhatsNewSeenScript(s: WhatsNewSeen): void {
  try {
    if (!localStorage.getItem(s.announcedKey)) localStorage.setItem(s.announcedKey, s.id)
    if (!localStorage.getItem(s.openedKey)) localStorage.setItem(s.openedKey, s.id)
  } catch {
    /* storage blocked or an opaque origin: the app then shows no automatic notice at all */
  }
}

/** Register the seed for every document the page or context loads. Call it
 *  AFTER an init script that clears storage. */
export async function seedWhatsNewSeen(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(seedWhatsNewSeenScript, WHATS_NEW_SEEN)
}
