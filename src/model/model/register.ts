// loop-model/1 (SEMANTICS-M.md §M2) — the `register` node: wire shape and
// defensive read. A Register stores no value; `expr` is a `loop-expr/1` string
// kept in §X8 canonical form (default "0"). `unit` / `format` are advisory.
//
// Per SEMANTICS-R2.md §R2-1.1: a non-string or *unparseable* `expr` is a
// malformed file (`payload-invalid`), NOT a runtime `invalid` — that mandate
// comes from §M2 ("stored in §X8 canonical form"). A parseable `expr` with a
// dangling `@id` is fine here; it becomes `invalid` only at evaluation.

import { canonicaliseExpr } from '../expr'
import { trimUnicodeWhitespace, truncateUtf8, utf8Len } from './text'
import { PARAM_UNIT_MAX_BYTES } from './parameter'

export type RegisterFormat = 'int' | 'float' | 'percent'
const FORMATS: readonly RegisterFormat[] = ['int', 'float', 'percent']

export type RegisterData = {
  kind: 'register'
  label: string
  /** loop-expr/1 §X8 canonical text; default "0". */
  expr: string
  unit?: string
  format?: RegisterFormat
}

export type RegisterNotice = 'REG_FORMAT_INVALID' | 'REG_UNIT_TOO_LONG'

export type RegReadResult =
  | { ok: true; data: RegisterData; notices: RegisterNotice[] }
  | { ok: false; reason: 'payload-invalid'; detail: string }

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

export function readRegisterData(raw: unknown): RegReadResult {
  if (!isObj(raw)) return { ok: false, reason: 'payload-invalid', detail: 'data is not an object' }

  const label = raw.label
  if (label !== undefined && typeof label !== 'string') {
    return { ok: false, reason: 'payload-invalid', detail: 'label is not a string' }
  }

  const notices: RegisterNotice[] = []

  // expr — default "0"; must be a parseable loop-expr/1 string
  const re = raw.expr
  let exprSrc: string
  if (re === undefined || re === null) {
    exprSrc = '0'
  } else if (typeof re !== 'string') {
    return { ok: false, reason: 'payload-invalid', detail: 'expr is not a string' }
  } else {
    exprSrc = re
  }
  const canonical = canonicaliseExpr(exprSrc)
  if (canonical == null) {
    return { ok: false, reason: 'payload-invalid', detail: `expr does not parse: ${JSON.stringify(exprSrc)}` }
  }

  const data: RegisterData = {
    kind: 'register',
    label: typeof label === 'string' ? label : '',
    expr: canonical,
  }

  // unit — same rule as §M1.2
  const runit = raw.unit
  if (typeof runit === 'string') {
    let u = trimUnicodeWhitespace(runit)
    if (u !== '') {
      u = u.normalize('NFC')
      if (utf8Len(u) > PARAM_UNIT_MAX_BYTES) {
        u = truncateUtf8(u, PARAM_UNIT_MAX_BYTES)
        notices.push('REG_UNIT_TOO_LONG')
      }
      if (u !== '') data.unit = u
    }
  }

  // format — one of int / float / percent; anything else is dropped + warned
  const rf = raw.format
  if (rf !== undefined) {
    if (typeof rf === 'string' && (FORMATS as readonly string[]).includes(rf)) {
      data.format = rf as RegisterFormat
    } else {
      notices.push('REG_FORMAT_INVALID')
    }
  }

  return { ok: true, data, notices }
}
