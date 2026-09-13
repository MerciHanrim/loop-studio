// loop-model/1 (SEMANTICS-M.md §M1) — the `parameter` node: wire shape,
// defensive read, and read-time normalisation.
//
// `value` is the ONLY semantic field (a finite literal, default 0). A
// Parameter is NEVER `invalid` (§M1.1) — a bad `value` shape is a malformed
// *file* (`payload-invalid`, SEMANTICS-R2.md §R2-1.1), not a node state.
// `min` / `max` / `step` / `unit` are advisory hints, dropped when incoherent
// (§M1.2), and — when they survive — part of the revision content.
//
// docs/data-import.md §DI9 / §DI13 (`loop-revision/8`, SEMANTICS-R8.md) —
// `sourceTableId` / `sourceKey` / `sourceColumnId` are the generating triple a
// data-import Parameter carries back to the row/column it was materialized
// from; `labelAutoComposed` gates whether its label still auto-recomposes
// from that source (§DI11). All four are optional, absent on a hand-created
// Parameter, never `payload-invalid` (provenance never makes an otherwise-
// valid Parameter unreadable) — but UNLIKE `min` / `max` (a coherent-pair-or-
// drop rule), each of the four is read INDEPENDENTLY and kept VERBATIM
// whenever its own type checks out, with no cross-field coherence
// requirement. This mirrors the CSU `timing` / `when` precedent
// (SEMANTICS-S3.md — kept "whatever the string is", valid or not), not the
// `min`/`max` one: an incoherent PARTIAL triple is real, meaningful content
// (arrived corrupted), not "the same as no provenance" — dropping it would
// make it invisible to `isDataImportContent` (SEMANTICS-R8.md §R8-1), which
// must classify by storage shape, not validity.

import { trimUnicodeWhitespace, truncateUtf8, utf8Len } from './text'

export const PARAM_UNIT_MAX_BYTES = 24
/** §DI-D8 — deliberately its own limit, not a reuse of `PARAM_UNIT_MAX_BYTES`
 *  or any node-label ceiling: a `sourceTableId` / `sourceColumnId` is always
 *  our OWN `nextId()`-minted id (short, id-safe), so this is a generous
 *  defensive ceiling against a corrupted/hand-edited file, not a real limit
 *  a legitimate value ever approaches. */
export const SOURCE_ID_MAX_BYTES = 128
/** §DI-D8 — a `sourceKey` is arbitrary designer text (a spreadsheet row key),
 *  not an internal id, so it gets a materially larger ceiling than
 *  `SOURCE_ID_MAX_BYTES`. Also independent of `PARAM_UNIT_MAX_BYTES` — a unit
 *  string and a spreadsheet key serve unrelated purposes and have no reason to
 *  share a bound. Exact number is a defensive read ceiling, not the import-time
 *  validation limit §DI6 describes (that is a Phase 1B UI concern). */
export const SOURCE_KEY_MAX_BYTES = 256

export type ParameterData = {
  kind: 'parameter'
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  /** docs/data-import.md §DI9 — absent on a hand-created Parameter, or after
   *  `unlink` (Phase 2). All three present together or none — an incoherent
   *  partial triple is dropped defensively (never `payload-invalid`). */
  sourceTableId?: string
  sourceKey?: string
  sourceColumnId?: string
  /** §DI11 — meaningful only alongside the triple above; dropped whenever the
   *  triple itself is dropped. */
  labelAutoComposed?: boolean
}

export type ParamNotice =
  | 'PARAM_VALUE_FIXED'
  | 'PARAM_STEP_INVALID'
  | 'PARAM_RANGE_INVALID'
  | 'PARAM_UNIT_TOO_LONG'
  | 'PARAM_VALUE_OUT_OF_RANGE'
  | 'PARAM_SOURCE_INVALID'
  | 'PARAM_LABEL_AUTO_COMPOSED_INVALID'

export type ReadOk<T> = { ok: true; data: T; notices: ParamNotice[] }
export type ReadInvalid = { ok: false; reason: 'payload-invalid'; detail: string }
export type ParamReadResult = ReadOk<ParameterData> | ReadInvalid

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Defensive read of one `parameter` node's `data` (§M1, §R2-1.1 structural
 * gate). Returns the normalised `ParameterData` (only surviving fields) plus
 * notices, or `payload-invalid` when the shape cannot be seated.
 */
export function readParameterData(raw: unknown): ParamReadResult {
  if (!isObj(raw)) return { ok: false, reason: 'payload-invalid', detail: 'data is not an object' }

  const label = raw.label
  if (label !== undefined && typeof label !== 'string') {
    return { ok: false, reason: 'payload-invalid', detail: 'label is not a string' }
  }

  const notices: ParamNotice[] = []

  // value — the only semantic field
  let value: number
  const rv = raw.value
  if (rv === undefined || rv === null) {
    value = 0
    notices.push('PARAM_VALUE_FIXED')
  } else if (typeof rv !== 'number') {
    return { ok: false, reason: 'payload-invalid', detail: 'value is not a number' }
  } else if (!Number.isFinite(rv)) {
    return { ok: false, reason: 'payload-invalid', detail: 'value is not finite' }
  } else {
    value = Object.is(rv, -0) ? 0 : rv
  }

  const data: ParameterData = { kind: 'parameter', label: typeof label === 'string' ? label : '', value }

  // min / max — only as a coherent finite pair with min ≤ max
  const rmin = raw.min
  const rmax = raw.max
  const minMaxTouched = rmin !== undefined || rmax !== undefined
  const coherentPair =
    typeof rmin === 'number' &&
    Number.isFinite(rmin) &&
    typeof rmax === 'number' &&
    Number.isFinite(rmax) &&
    rmin <= rmax
  if (coherentPair) {
    data.min = Object.is(rmin, -0) ? 0 : (rmin as number)
    data.max = Object.is(rmax, -0) ? 0 : (rmax as number)
  } else if (minMaxTouched) {
    notices.push('PARAM_RANGE_INVALID')
  }

  // step — finite and > 0
  const rstep = raw.step
  if (rstep !== undefined) {
    if (typeof rstep === 'number' && Number.isFinite(rstep) && rstep > 0) {
      data.step = rstep
    } else {
      notices.push('PARAM_STEP_INVALID')
    }
  }

  // unit — trim (Unicode White_Space) → NFC → ≤ 24 UTF-8 bytes
  const runit = raw.unit
  if (typeof runit === 'string') {
    let u = trimUnicodeWhitespace(runit)
    if (u !== '') {
      u = u.normalize('NFC')
      if (utf8Len(u) > PARAM_UNIT_MAX_BYTES) {
        u = truncateUtf8(u, PARAM_UNIT_MAX_BYTES)
        notices.push('PARAM_UNIT_TOO_LONG')
      }
      if (u !== '') data.unit = u
    }
  }

  // value vs [min, max] — kept as stored (never clamped); advisory notice only
  if (data.min !== undefined && data.max !== undefined && (value < data.min || value > data.max)) {
    notices.push('PARAM_VALUE_OUT_OF_RANGE')
  }

  // docs/data-import.md §DI9 / SEMANTICS-R8.md §R8-1 — the generating triple +
  // `labelAutoComposed`. Each of the four is read INDEPENDENTLY and kept
  // VERBATIM whenever its OWN type checks out — deliberately NOT a
  // "coherent-pair-or-drop" rule like `min` / `max`. Reason: this project's own
  // CSU precedent (`timing` / `when`, SEMANTICS-S3.md, kept "whatever the
  // string is, valid or not") already settled this exact question — an
  // incoherent PARTIAL triple (e.g. a hand-edited file missing just
  // `sourceKey`) is real, meaningful revision content (data-import content
  // that arrived corrupted), not "the same as no provenance at all". Silently
  // dropping it would make `isDataImportContent` (SEMANTICS-R8.md §R8-1) blind
  // to exactly the corrupted-but-clearly-intended-as-R8 case the design
  // requires it to catch. A future refresh (Phase 2) is the right layer to
  // decide what a partial triple MEANS; this reader's only job is not to erase
  // it. Each field still gets its own basic type / length guard (unlike
  // `timing`/`when`'s free-form string) since these are structured ids, not a
  // closed-grammar token.
  const isNonEmptyStr = (v: unknown, maxBytes: number): v is string =>
    typeof v === 'string' && v.length > 0 && utf8Len(v) <= maxBytes
  if (raw.sourceTableId !== undefined) {
    if (isNonEmptyStr(raw.sourceTableId, SOURCE_ID_MAX_BYTES)) data.sourceTableId = raw.sourceTableId
    else notices.push('PARAM_SOURCE_INVALID')
  }
  if (raw.sourceKey !== undefined) {
    if (isNonEmptyStr(raw.sourceKey, SOURCE_KEY_MAX_BYTES)) data.sourceKey = raw.sourceKey
    else notices.push('PARAM_SOURCE_INVALID')
  }
  if (raw.sourceColumnId !== undefined) {
    if (isNonEmptyStr(raw.sourceColumnId, SOURCE_ID_MAX_BYTES)) data.sourceColumnId = raw.sourceColumnId
    else notices.push('PARAM_SOURCE_INVALID')
  }
  if (raw.labelAutoComposed !== undefined) {
    if (typeof raw.labelAutoComposed === 'boolean') data.labelAutoComposed = raw.labelAutoComposed
    else notices.push('PARAM_LABEL_AUTO_COMPOSED_INVALID')
  }

  return { ok: true, data, notices }
}
