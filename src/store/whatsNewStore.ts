import { create } from 'zustand'
import { newestReleaseNote, type ReleaseNote } from '../releaseNotes/releaseNotes'
import { storagePort, type StorageKey } from '../storage/storagePort'
import {
  ANNOUNCED_KEY,
  OPENED_KEY,
  RETURNING_PROFILE_KEYS,
  decideWhatsNew,
  isUnread,
  readStoredId,
  type WhatsNewDecision,
} from '../whatsNew/decide'

// Issue #296 — the state behind the update notice, the What's new panel and the
// Help menu's `New` marker. Presentation only: nothing here is serialized into
// a document, digested, undone, or seen by the engine.
//
// Two stored facts, kept apart because dismissing a notice and reading the
// notes are different things:
//
//   announced  the one-time notice for this entry has been shown. Written the
//              moment the notice is really on screen - a notice that is waiting
//              behind another overlay has announced nothing - and, silently, on
//              a first visit, as the baseline the next release is compared with.
//   opened     the person has opened the panel for this entry. Only this clears
//              the `New` marker.
//
// The decision is taken ONCE, when this module is first evaluated: before React
// mounts and before the app saves its default sample. It does not read the
// document key at all, so the order would not change the answer; it is taken
// early so that nothing the app writes later can be mistaken for history.

function write(key: StorageKey, value: string): void {
  try {
    storagePort.setItem(key, value)
  } catch {
    /* not fatal: the in-memory state still holds for this session */
  }
}

type Boot = {
  note: ReleaseNote | null
  decision: WhatsNewDecision
  unread: boolean
}

/** read storage and decide. Exported for the unit tests, which replace storage. */
export function bootWhatsNew(note: ReleaseNote | null = newestReleaseNote() ?? null): Boot {
  const newestId = note?.id ?? null
  try {
    const announced = readStoredId(storagePort.getItem(ANNOUNCED_KEY))
    const opened = readStoredId(storagePort.getItem(OPENED_KEY))
    const hasReturningTrace = RETURNING_PROFILE_KEYS.some((key) => storagePort.getItem(key) !== null)
    const decision = decideWhatsNew({ newestId, announced, opened, hasReturningTrace })
    // a first visit is told nothing, and the newest entry becomes its baseline
    if (decision.kind === 'first-visit') write(ANNOUNCED_KEY, decision.baseline)
    return { note, decision, unread: isUnread(newestId, opened) }
  } catch {
    // Storage cannot be read at all (blocked, or a file:// origin in some
    // browsers). Nothing can be remembered, so an automatic notice would come
    // back on every launch: none is shown. The panel and the marker still work
    // for this session.
    return { note, decision: { kind: 'none' }, unread: newestId !== null }
  }
}

type WhatsNewState = {
  /** the newest release note, or null when the list is empty */
  note: ReleaseNote | null
  /** an automatic notice is owed and the person has not closed it */
  noticePending: boolean
  /** the notice is on screen right now. The canvas hints wait on this. */
  noticeShowing: boolean
  /** the Help menu's `New` marker */
  unread: boolean

  /** the notice component reports that it is really rendered (or no longer is).
   *  The first `true` records `announced`. */
  setNoticeShowing: (showing: boolean) => void
  /** the person closed the notice, or went on to the panel from it */
  dismissNotice: () => void
  /** the panel was really opened: records `opened`, clears the marker, and
   *  withdraws a notice that is still owed - its entry has just been read */
  markOpened: () => void
}

const initial = bootWhatsNew()

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  note: initial.note,
  noticePending: initial.decision.kind === 'notice',
  noticeShowing: false,
  unread: initial.unread,

  setNoticeShowing: (showing) => {
    const s = get()
    if (s.noticeShowing === showing) return
    if (showing) {
      if (!s.noticePending || !s.note) return
      // written every time it comes back too; the value is the same
      write(ANNOUNCED_KEY, s.note.id)
    }
    set({ noticeShowing: showing })
  },
  dismissNotice: () => {
    if (!get().noticePending) return
    set({ noticePending: false, noticeShowing: false })
  },
  markOpened: () => {
    const s = get()
    if (!s.note) return
    if (s.unread) write(OPENED_KEY, s.note.id)
    if (s.unread || s.noticePending) set({ unread: false, noticePending: false, noticeShowing: false })
  },
}))

/** For tests: decide again from whatever storage holds now. */
export function __rebootWhatsNew(note?: ReleaseNote | null): void {
  const b = bootWhatsNew(note === undefined ? (newestReleaseNote() ?? null) : note)
  useWhatsNewStore.setState({
    note: b.note,
    noticePending: b.decision.kind === 'notice',
    noticeShowing: false,
    unread: b.unread,
  })
}
