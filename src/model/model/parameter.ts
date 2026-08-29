// loop-model/1 (SEMANTICS-M.md §M1) — the `parameter` node: wire shape,
// defensive read, and read-time normalisation.
//
// `value` is the ONLY semantic field (a finite literal, default 0). A
// Parameter is NEVER `invalid` (§M1.1) — a bad `value` shape is a malformed
// *file* (`payload-invalid`, SEMANTICS-R2.md §R2-1.1), not a node state.
// `min` / `max` / `step` / `unit` are advisory hints, dropped when incoherent
// (§M1.2), and — when they survive — part of the revision content.

import { trimUnicodeWhitespace, truncateUtf8, utf8Len } from './text'

export const PARAM_UNIT_MAX_BYTES = 24

export type ParameterData = {
  kind: 'parameter'
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
}

export type ParamNotice =
  | 'PARAM_VALUE_FIXED'
  | 'PARAM_STEP_INVALID'
  | 'PARAM_RANGE_INVALID'
  | 'PARAM_UNIT_TOO_LONG'
  | 'PARAM_VALUE_OUT_OF_RANGE'

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

  return { ok: true, data, notices }
}
