import type { StorageKey } from '../storage/storagePort'

// Issue #296 — who is told about an update, as pure functions.
//
// The app cannot identify a person. What it can identify is a BROWSER PROFILE
// THAT HAS BEEN USED BEFORE, and only that profile gets the one-time notice: a
// first visit has no previous version to have been updated from.
//
// Telling the two apart is the risky part, because the app writes data on its
// own. About a second and a half after a first boot the default sample document
// is saved, so "some Loop Studio key exists" is true of a brand-new profile
// almost at once. The rule is therefore an ALLOW-LIST of the keys that only a
// person's action writes.

/** the one-time notice for this entry has already been shown */
export const ANNOUNCED_KEY = 'loop-studio/whats-new/announced/1' satisfies StorageKey
/** the person has actually opened the notes for this entry */
export const OPENED_KEY = 'loop-studio/whats-new/opened/1' satisfies StorageKey

/**
 * Keys that are written only when a person does something: skips or finishes
 * the tour, picks a theme or a language, locks the canvas, types an author
 * name, and so on. One of these in storage means the profile was used before.
 *
 * The list is explicit on purpose. A key added to the registry later is NOT a
 * trace until someone says so here: `decide.test.ts` fails until every
 * registered key is in this list or in `NOT_A_TRACE`.
 */
export const RETURNING_PROFILE_KEYS = [
  'loop-studio:author',
  'loop-studio:theme',
  'loop-studio/ui-locale/1',
  'loop-studio:canvas-locked',
  'loop-studio:focus-mode',
  'loop-studio:filter-panel',
  'loop-studio:activity-overlay',
  'loop-studio:minimap-collapsed',
  'loop-studio:inputs-panel',
  'loop-studio:summary-panel',
  // docs/flow-colour-and-compact-nodes.md FC-2.7 — written only when the person
  // picks a flow colour
  'loop-studio:recent-accents',
  'loop-studio/guided-tour/1',
  'loop-studio/contextual-help/1',
  'loop-studio/import-quickstart/1',
] as const satisfies readonly StorageKey[]

/**
 * Keys that prove nothing about a person.
 *
 * - the document key: the app saves the default sample by itself at first boot
 * - the two keys of this feature: a first visit writes `announced` silently,
 *   so reading it back as a trace would turn every new profile into a
 *   returning one on its second launch
 * - the storage-mode key (issue #297): it IS written by a person, but at the
 *   gate, which a brand-new profile answers before anything else - the very
 *   first start would then look like a return and announce an update that
 *   nobody was updated from. It is also the one key a temporary session may
 *   write, and a temporary session's storage is otherwise empty by design.
 */
export const NOT_A_TRACE = ['loop-studio:graph:v1', ANNOUNCED_KEY, OPENED_KEY, 'loop-studio:storage-mode'] as const satisfies readonly StorageKey[]

/** `release:<version>`, or null for anything else. An unreadable or corrupt
 *  stored value is treated as absent, never as "already told". */
export function readStoredId(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && /^release:.+$/.test(raw) ? raw : null
}

export type WhatsNewFacts = {
  /** the id of the newest release note, or null when the list is empty */
  newestId: string | null
  /** the stored `announced` id, already passed through `readStoredId` */
  announced: string | null
  /** the stored `opened` id, already passed through `readStoredId` */
  opened: string | null
  /** is any `RETURNING_PROFILE_KEYS` key present in storage? */
  hasReturningTrace: boolean
}

export type WhatsNewDecision =
  /** there is nothing to announce */
  | { kind: 'none' }
  /** this profile has already been told about the newest entry */
  | { kind: 'up-to-date' }
  /** a profile with no history: no notice, and the newest id is recorded as the
   *  baseline so that the NEXT release is the first one it is told about */
  | { kind: 'first-visit'; baseline: string }
  /** a profile that was used before and has not been told about `id` */
  | { kind: 'notice'; id: string }

/**
 * The order matters. `announced` is looked at FIRST: once a first visit has
 * recorded its baseline, that record alone decides, and the allow-list is only
 * consulted for a profile that has never run a build with this feature.
 *
 * The comparison is equality of ids, never an ordering of versions: an id is
 * either the one this profile was told about, or it is not.
 *
 * A profile that has already OPENED the newest entry is not told about it. That
 * happens when the notice was still waiting behind another overlay and the
 * person went to Help and read the notes themselves: there is nothing left to
 * announce.
 */
export function decideWhatsNew(facts: WhatsNewFacts): WhatsNewDecision {
  const { newestId, announced, opened, hasReturningTrace } = facts
  if (newestId === null) return { kind: 'none' }
  if (opened === newestId) return { kind: 'up-to-date' }
  if (announced !== null) return announced === newestId ? { kind: 'up-to-date' } : { kind: 'notice', id: newestId }
  if (hasReturningTrace) return { kind: 'notice', id: newestId }
  return { kind: 'first-visit', baseline: newestId }
}

/** Does the Help menu's `New` marker show? Until the newest entry has been
 *  opened in the panel. Closing the notice does not clear it. */
export function isUnread(newestId: string | null, opened: string | null): boolean {
  return newestId !== null && opened !== newestId
}
