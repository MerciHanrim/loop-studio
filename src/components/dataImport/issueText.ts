import type { MessageKey } from '../../i18n'
import { isolateAuto } from '../../i18n/bidiIsolate'
import type { FormatParams } from '../../i18n/format'

type Translate = (key: MessageKey, params?: FormatParams) => string

/** where an import issue is, in the terms of the person's own spreadsheet:
 *  the table's name, the 1-based header row, and the issue's data row and
 *  column when it has them */
export type IssuePlace = {
  table: string
  /** 1-based, as the wizard's "Header row" field */
  headerRowIndex: number
  /** 0-based within the EFFECTIVE data rows (after the header row, before the ignored last rows) */
  rowIndex?: number
  /** 0-based position of the column in the pasted text */
  columnIndex?: number
  /** the column's header, as the issue names it */
  header?: string | null
}

/** §DI17 — the location prefix of an import issue line, shared by the first
 *  import wizard and, since review P3, the refresh wizard: each puts it in
 *  front of its description as `${location}: ${description}`.
 *
 *  `rowIndex` counts from 0 within the EFFECTIVE (post header-row, post
 *  ignore-last-N-rows) data rows — it is NOT the row's position in the raw
 *  pasted/uploaded text. The header row itself (and anything before it) is
 *  added back, so the number shown matches what the person sees by counting
 *  lines in their own source text, 1-based.
 *
 *  §L9.4 — the location and the description end up in ONE string. The
 *  description's own `{value}` is isolated by its caller; the table name and
 *  the column header are user text from the spreadsheet too, so they are
 *  isolated here, at each call. */
export function issueLocationText(t: Translate, place: IssuePlace): string {
  const header = place.header ?? null
  if (place.rowIndex !== undefined && place.columnIndex !== undefined) {
    const row = place.headerRowIndex + place.rowIndex + 1
    const column = place.columnIndex + 1
    return header
      ? t('import.loc.tableRowColumnHeader', { table: isolateAuto(place.table), row, column, header: isolateAuto(header) })
      : t('import.loc.tableRowColumn', { table: isolateAuto(place.table), row, column })
  }
  if (place.rowIndex !== undefined) return t('import.loc.tableRow', { table: isolateAuto(place.table), row: place.headerRowIndex + place.rowIndex + 1 })
  if (place.columnIndex !== undefined && header) {
    return t('import.loc.tableColumnHeader', { table: isolateAuto(place.table), column: place.columnIndex + 1, header: isolateAuto(header) })
  }
  return t('import.loc.table', { table: isolateAuto(place.table) })
}
