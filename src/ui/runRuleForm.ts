// SEMANTICS-M6.md §M6-9 — the Inspector's form for a rule, as pure text work. A document
// only ever holds a rule that reads: what is half made stays in the form.
import { cmp, displayRational, div, fromInt, mul, parseDecimal, toDouble } from '../model/rational'
import { decimal, readRunRule, type RunRule } from '../model/runRule'

const HUNDRED = fromInt(100)

/** a stored fraction as the percent the field shows: `0.5` reads `50`. A decimal moved
 *  two places still ends, so the text is exact. */
export function percentOfFraction(text: string | undefined): string {
  const r = text === undefined ? null : parseDecimal(text)
  return r === null ? '' : displayRational(mul(r, HUNDRED)).text
}

/** a typed percent as the stored fraction, or `null` when it is not one from 0 to 100 */
export function fractionOfPercent(text: string): string | null {
  const r = decimal(text.trim())
  return r === null || cmp(r, HUNDRED) > 0 ? null : displayRational(div(r, HUNDRED)).text
}

export const isPlainNumber = (text: string): boolean => decimal(text.trim()) !== null
export const isAboveZero = (text: string): boolean => {
  const r = decimal(text.trim())
  return r !== null && toDouble(r) > 0
}

export type RuleDraft = RunRule

/** the rule with what no longer belongs dropped. A rule keeps a level only with a tank,
 *  and a 100 % line only with a table. A new tank starts on the Fill side. A level, a
 *  band and a unit belong to the tank they were written for: the same figure on a tank
 *  in another unit is another amount, so a new tank takes none of them, and its rule
 *  waits for numbers a person has typed for it. */
export function nextDraft(form: RuleDraft, patch: Partial<RuleDraft>): RuleDraft {
  const merged: RuleDraft = { ...form, ...patch }
  const out: RuleDraft = {}
  if (merged.tank !== undefined) {
    out.tank = merged.tank
    if (merged.tank === form.tank) {
      if (merged.level !== undefined) out.level = merged.level
      if (merged.band !== undefined) out.band = merged.band
      if (merged.unit !== undefined) out.unit = merged.unit
    }
    out.side = merged.side ?? 'fill'
  }
  if (merged.table !== undefined) {
    out.table = merged.table
    if (merged.rated !== undefined) out.rated = merged.rated
  }
  if (merged.lowest !== undefined) out.lowest = merged.lowest
  return out
}

/** what the form's content is: nothing to keep, a rule to store, or a draft to hold */
export function draftState(draft: RuleDraft): { kind: 'empty' } | { kind: 'rule'; rule: RunRule } | { kind: 'draft' } {
  if (draft.tank === undefined && draft.table === undefined) return { kind: 'empty' }
  const read = readRunRule(draft)
  return read.ok ? { kind: 'rule', rule: read.rule } : { kind: 'draft' }
}
