import type { TimetableEndedNotice, TimetableUnmetNotice } from '../engine/types'
import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import type { Timetable, TimetableFinding } from '../model/timetable'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

/** loop-model/5 — a table's run message in the user's language, with its name
 *  isolated. The desktop and the mobile run bars word it here, in one place. */
export function timetableNoticeText(x: TimetableEndedNotice | TimetableUnmetNotice, t: T): string {
  if (x.kind === 'timetableEnded') return t('playbar.diag.timetableEnded', { label: isolateAuto(x.label) })
  return t('playbar.diag.timetableUnmet', { label: isolateAuto(x.label), amount: x.amount })
}

/** why a table line refuses the run, named by its table */
export function timetableRefusalText(f: TimetableFinding, timetables: readonly Timetable[], t: T): string {
  const name = timetables.find((x) => x.id === f.tableId)?.label ?? f.tableId
  switch (f.code) {
    case 'unknown-table':
      return t('playbar.refused.timetable.unknown', { label: isolateAuto(name) })
    case 'bad-line':
      return t('playbar.refused.timetable.line', { label: isolateAuto(name) })
    case 'no-step':
      return t('playbar.refused.timetable.noStep', { label: isolateAuto(name) })
    case 'no-kind':
      return t('playbar.refused.timetable.noKind', { label: isolateAuto(name) })
    case 'bad-unit':
      return t('playbar.refused.timetable.unit', { label: isolateAuto(name) })
    case 'two-kinds':
      return t('playbar.refused.timetable.twoKinds', { label: isolateAuto(name) })
  }
}
